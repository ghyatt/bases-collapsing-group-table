import {
  AbstractInputSuggest,
  App,
  BasesEntry,
  BasesEntryGroup,
  BasesPropertyId,
  BasesViewConfig,
  BooleanValue,
  DateValue,
  DurationValue,
  FileValue,
  ListValue,
  NumberValue,
  StringValue,
  Value,
  setIcon,
} from 'obsidian'
import type { TableSettings } from './types'
import { buildGroupTree, cleanLabel, groupByNames, nodeTotal, type TreeNode } from './group-tree'
import { formatDate } from './format-date'

// Inline-editable note-property types (written back to frontmatter).
type EditType = 'bool' | 'number' | 'date' | 'text' | 'list'
// How a list column's items behave for autocomplete.
type ListKind = 'tag' | 'link' | 'plain'

// Visible line count per row-height preset (mirrors --bcgt-lines in styles.css);
// used to size the multi-line text editor.
const rowLines = (rowHeight: string): number =>
  ({ short: 1, medium: 3, tall: 6, extra: 12, dynamic: 4 }[rowHeight] ?? 1)

// metadataCache.getTags() exists at runtime but isn't in the public typings.
interface MetadataCacheWithTags {
  getTags?: () => Record<string, number>
}

// Autocomplete popover for a list cell's add-input: vault tags or page links,
// filtered as you type. Selecting a suggestion adds it via onPick.
class ListSuggest extends AbstractInputSuggest<string> {
  // Page list cached for the lifetime of this suggester (one edit session), so
  // the vault is enumerated once rather than on every keystroke.
  private pages: { name: string; link: string }[] | null = null

  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly mode: 'tag' | 'link',
    private readonly tags: string[],
    private readonly getExisting: () => Set<string>,
    private readonly onPick: (text: string) => void,
  ) {
    super(app, inputEl)
  }

  protected getSuggestions(query: string): string[] {
    const q = query.replace(/^#/, '').replace(/^\[\[/, '').trim().toLowerCase()
    const existing = this.getExisting()
    if (this.mode === 'tag') {
      return this.tags.filter((t) => t.toLowerCase().includes(q) && !existing.has(t)).slice(0, 50)
    }
    if (!this.pages) {
      this.pages = this.app.vault
        .getMarkdownFiles()
        .map((f) => ({ name: f.basename.toLowerCase(), link: `[[${f.basename}]]` }))
    }
    const out: string[] = []
    for (const p of this.pages) {
      if (p.name.includes(q) && !existing.has(p.link)) out.push(p.link)
      if (out.length >= 50) break
    }
    return out
  }

  renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(this.mode === 'tag' ? `#${value}` : value.replace(/^\[\[|\]\]$/g, ''))
  }

  selectSuggestion(value: string): void {
    this.onPick(value)
    this.setValue('')
    this.close()
  }
}

export interface BuildTableArgs {
  app: App
  groups: BasesEntryGroup[]
  columns: BasesPropertyId[]
  config: BasesViewConfig
  isGrouped: boolean
  settings: TableSettings
  // One stable key per group (same index order as `groups`), computed once by
  // the view so it matches the collapsed set exactly.
  keys: string[]
  // Collapse state, mutated in place by this builder. The view owns the Set.
  collapsed: Set<string>
  // When true, the fold state is the option-driven default (no saved folds), so
  // sub-groups are initialised per the "when opening a group" setting.
  applyOpenDefault: boolean
  // Called when the user manually folds/unfolds, so the view stops auto-applying
  // the start-collapsed default and preserves the user's choice.
  markTouched: () => void
}

const buildTable = (container: HTMLElement, args: BuildTableArgs): void => {
  const { app, groups, columns, config, isGrouped, settings, keys, collapsed, applyOpenDefault, markTouched } =
    args

  const allKeys = keys
  // Top-level fold keys for accordion (reassigned to the tree roots in Option X).
  let topLevelKeys: string[] = allKeys
  // Path separator: splits group values into a hierarchy and joins fold-key
  // prefixes (a fold key is the full path prefix, e.g. "ai/llm_wiki").
  const SEP = '/'
  // Every fold target's key (top groups + sub-groups), for Collapse all + prune.
  const allFoldKeys = new Set<string>()
  // Each rendered row + the fold keys above it: a row is hidden when any
  // ancestor fold key is collapsed.
  const rowMeta: { el: HTMLElement; ancestors: string[] }[] = []
  // Each header's chevron, keyed by its own fold key, for rotation.
  const chevrons: { key: string; el: HTMLElement }[] = []
  // Tree relationships (populated during render): a fold key → all its descendant
  // fold keys, and → its ordered direct-child fold keys.
  const descendants = new Map<string, string[]>()
  const directChildren = new Map<string, string[]>()

  // Sync all rows' visibility and chevrons to the `collapsed` set.
  const applyAll = (): void => {
    for (const { el, ancestors } of rowMeta) {
      el.toggleClass('bcgt-hidden', ancestors.some((k) => collapsed.has(k)))
    }
    for (const { key, el } of chevrons) {
      el.toggleClass('bcgt-chev-collapsed', collapsed.has(key))
    }
  }

  // Apply the "when opening a group" setting to a key's sub-groups.
  const applyOpenBehavior = (key: string): void => {
    const desc = descendants.get(key) ?? []
    if (settings.openBehavior === 'all') {
      for (const d of desc) collapsed.delete(d) // open everything below
    } else if (settings.openBehavior === 'none') {
      for (const d of desc) collapsed.add(d) // keep all sub-groups collapsed
    } else {
      // 'first' — collapse all sub-groups, then open just the first child
      for (const d of desc) collapsed.add(d)
      const kids = directChildren.get(key) ?? []
      if (kids.length > 0) collapsed.delete(kids[0])
    }
  }

  // Open/close a fold. Closing also collapses every descendant sub-group;
  // opening applies the open-behavior to the sub-groups.
  const setFold = (key: string, open: boolean): void => {
    if (open) {
      collapsed.delete(key)
      applyOpenBehavior(key)
    } else {
      collapsed.add(key)
      for (const d of descendants.get(key) ?? []) collapsed.add(d)
    }
  }

  // Top-level group toggle (accordion-aware).
  const toggleTop = (key: string): void => {
    markTouched()
    const opening = collapsed.has(key)
    if (settings.accordion && opening) {
      // collapse every other top group (and their sub-groups) first
      for (const k of topLevelKeys) {
        collapsed.add(k)
        for (const d of descendants.get(k) ?? []) collapsed.add(d)
      }
    }
    setFold(key, opening)
    applyAll()
  }

  // Sub-group toggle (accordion-aware: opening collapses sibling sub-groups).
  const toggleFold = (key: string): void => {
    markTouched()
    const opening = collapsed.has(key)
    if (settings.accordion && opening) {
      // A fold key is its path prefix, so the parent is everything before the
      // last separator; siblings are the parent's other direct children.
      const parent = key.slice(0, key.lastIndexOf(SEP))
      for (const sib of directChildren.get(parent) ?? []) {
        if (sib === key) continue
        collapsed.add(sib)
        for (const d of descendants.get(sib) ?? []) collapsed.add(d)
      }
    }
    setFold(key, opening)
    applyAll()
  }

  // ---- control bar (only meaningful when grouped) ----
  if (isGrouped) {
    const bar = container.createDiv('bcgt-controls')
    const makeBtn = (label: string, icon: string): HTMLElement => {
      const btn = bar.createEl('button', { cls: 'bcgt-control-btn' })
      setIcon(btn.createSpan('bcgt-btn-icon'), icon)
      btn.createSpan({ text: label })
      return btn
    }
    const expandBtn = makeBtn('Expand all', 'chevrons-up-down')
    const collapseBtn = makeBtn('Collapse all', 'chevrons-down-up')
    expandBtn.addEventListener('click', () => {
      markTouched()
      collapsed.clear()
      applyAll()
    })
    collapseBtn.addEventListener('click', () => {
      markTouched()
      for (const key of allFoldKeys) collapsed.add(key)
      applyAll()
    })

    const noteCount = groups.reduce((sum, g) => sum + g.entries.length, 0)
    // When nested, the top groups are the distinct first path segments, not the
    // raw Bases groups (full path values).
    const groupCount = settings.subGroup
      ? new Set(keys.map((k) => k.split(SEP)[0])).size
      : groups.length

    const statsEl = bar.createSpan('bcgt-stats')
    const addStat = (label: string, value: string, sep: string): void => {
      if (sep) statsEl.createSpan({ text: sep })
      statsEl.createSpan({ cls: 'bcgt-stat-label', text: `${label} ` })
      statsEl.createSpan({ text: value })
    }
    addStat('Groups:', String(groupCount), '')
    addStat('Notes:', String(noteCount), ' · ')

    // GroupBy: always shown when grouped — the Base's groupBy column plus any
    // sub-group columns chosen in the dialog.
    const gbNames = groupByNames(config, settings.subCols)
    addStat('GroupBy:', gbNames.join(', ') || '—', ' - ')
    if (settings.subGroup) {
      statsEl.createSpan({ cls: 'bcgt-nested-tag', text: ' [nested]' })
    }
  }

  // ---- table head (column names) ----
  const rowHeightClass: Record<string, string> = {
    short: 'bcgt-rows-short',
    medium: 'bcgt-rows-medium',
    tall: 'bcgt-rows-tall',
    extra: 'bcgt-rows-xtall',
    dynamic: 'bcgt-rows-dynamic',
  }
  const table = container.createEl('table', {
    cls: `bcgt-table ${rowHeightClass[settings.rowHeight] ?? 'bcgt-rows-short'}`,
  })

  // ---- column widths (shares the native table's `columnSize` map) ----
  const readColumnSize = (): Record<string, number> => {
    const raw = config.get('columnSize')
    const out: Record<string, number> = {}
    if (raw && typeof raw === 'object') {
      // Index access needs the record shape (plain `object` has no index
      // signature), so this assertion is load-bearing, not redundant.
      const obj = raw as Record<string, unknown>
      for (const key of Object.keys(obj)) {
        const val = obj[key]
        if (typeof val === 'number' && Number.isFinite(val)) out[key] = val
      }
    }
    return out
  }
  const widths = readColumnSize()

  // ---- drag-to-resize ----
  // table-layout:fixed takes column widths from the header row, but only engages
  // when the table has a definite width — so we set the table width to the sum of
  // the columns and each column width on its <th>. All via CSS custom properties
  // (no static style assignment). max-width on cells is ignored by tables, which
  // is why the earlier per-cell approach didn't render.
  const MIN_COL_WIDTH = 40
  const MAX_AUTOFIT_WIDTH = 800
  const DEFAULT_COL_WIDTH = 150
  const thEls: HTMLElement[] = []
  const curWidths: number[] = columns.map((col) => {
    const w = widths[col]
    return typeof w === 'number' ? w : DEFAULT_COL_WIDTH
  })
  const applyTableWidth = (): void => {
    const total = curWidths.reduce((sum, w) => sum + w, 0)
    table.style.setProperty('--bcgt-table-w', `${total}px`)
  }
  const setColumnWidth = (colIndex: number, px: number): void => {
    curWidths[colIndex] = px
    thEls[colIndex]?.style.setProperty('--bcgt-w', `${px}px`)
    applyTableWidth()
  }
  const persistWidth = (col: BasesPropertyId, px: number): void => {
    // Only write while this table is on-screen, to avoid a write landing on
    // another base's config during a view/base switch.
    if (!table.isConnected) return
    const map = readColumnSize()
    map[col] = Math.round(px)
    config.set('columnSize', map)
  }

  // Double-click auto-fit: measure the natural (unclamped, single-line) width of
  // the header and each cell in the column by cloning them into an off-screen
  // measuring box. Cloning avoids mutating live element styles (the review gate).
  const autoFit = (colIndex: number, col: BasesPropertyId, th: HTMLElement): void => {
    const measure = table.ownerDocument.body.createDiv('bcgt-measure')
    let max = 0
    const measureClone = (source: Element | null): void => {
      if (!source) return
      const clone = source.cloneNode(true) as HTMLElement
      measure.empty()
      measure.appendChild(clone)
      max = Math.max(max, clone.getBoundingClientRect().width)
    }
    measureClone(th.querySelector('.bcgt-col-inner'))
    const rows = table.querySelectorAll('.bcgt-row')
    const limit = Math.min(rows.length, 300)
    for (let r = 0; r < limit; r++) {
      const cell = rows[r].children[colIndex]
      measureClone(cell ? cell.querySelector('.bcgt-cell-content') : null)
    }
    measure.remove()
    if (max <= 0) return
    const width = Math.min(MAX_AUTOFIT_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(max + 24)))
    setColumnWidth(colIndex, width)
    persistWidth(col, width)
  }

  const attachResize = (
    handle: HTMLElement,
    th: HTMLElement,
    col: BasesPropertyId,
    colIndex: number,
  ): void => {
    // Pointer capture keeps move/up events flowing even when the cursor leaves
    // the thin handle, and avoids reaching for a window-level event target.
    handle.addEventListener('pointerdown', (evt) => {
      evt.preventDefault()
      evt.stopPropagation()
      handle.setPointerCapture(evt.pointerId)
      const startX = evt.clientX
      const startW = th.getBoundingClientRect().width
      let finalW = startW
      table.addClass('bcgt-is-resizing')
      handle.addClass('is-active')
      const onMove = (move: PointerEvent): void => {
        finalW = Math.max(MIN_COL_WIDTH, startW + (move.clientX - startX))
        setColumnWidth(colIndex, finalW)
      }
      const onUp = (): void => {
        handle.releasePointerCapture(evt.pointerId)
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        table.removeClass('bcgt-is-resizing')
        handle.removeClass('is-active')
        if (Math.abs(finalW - startW) > 0.5) persistWidth(col, finalW)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
    })
    handle.addEventListener('dblclick', (evt) => {
      evt.preventDefault()
      evt.stopPropagation()
      autoFit(colIndex, col, th)
    })
  }

  // Current sort direction per property (read-only — the Bases API has no
  // public setSort, so we can show the arrow but not change sort on click).
  const sortMap = new Map<string, 'ASC' | 'DESC'>()
  for (const sort of config.getSort()) sortMap.set(sort.property, sort.direction)

  // Sample a handful of entries to infer each column's icon from its value type
  // (there's no property-type API, so we read it off a concrete Value subclass).
  const sampleEntries: BasesEntry[] = []
  for (const group of groups) {
    for (const entry of group.entries) {
      sampleEntries.push(entry)
      if (sampleEntries.length >= 30) break
    }
    if (sampleEntries.length >= 30) break
  }
  const iconFor = (col: BasesPropertyId): string => {
    let sample: Value | null = null
    for (const entry of sampleEntries) {
      let value: Value | null = null
      try {
        value = entry.getValue(col)
      } catch {
        value = null
      }
      if (value !== null) {
        sample = value
        break
      }
    }
    if (sample instanceof BooleanValue) return 'check-square'
    if (sample instanceof NumberValue) return 'hash'
    if (sample instanceof DateValue) return 'calendar'
    if (sample instanceof ListValue) return 'list'
    if (sample instanceof FileValue) return 'file'
    if (sample instanceof DurationValue) return 'clock'
    if (col.startsWith('formula.')) return 'sigma'
    if (col.startsWith('file.')) return 'file'
    return 'text'
  }

  // Inline-editable type per note-source column (frontmatter-backed). Sampled
  // from the data since the API doesn't expose declared property types.
  const editTypeOf = new Map<string, EditType>()
  const listKindOf = new Map<string, ListKind>()
  for (const col of columns) {
    if (!col.startsWith('note.')) continue
    for (const entry of sampleEntries) {
      let v: Value | null = null
      try {
        v = entry.getValue(col)
      } catch {
        v = null
      }
      if (v === null) continue
      if (v instanceof BooleanValue) editTypeOf.set(col, 'bool')
      else if (v instanceof NumberValue) editTypeOf.set(col, 'number')
      else if (v instanceof DateValue) editTypeOf.set(col, 'date')
      else if (v instanceof StringValue) editTypeOf.set(col, 'text')
      else if (v instanceof ListValue) {
        editTypeOf.set(col, 'list')
        // Tags by key; link-list if items look like file links; else plain.
        const key = col.slice('note.'.length)
        let kind: ListKind = 'plain'
        if (key === 'tags' || col.endsWith('.tags')) kind = 'tag'
        else if (v.length() > 0) {
          const e0 = v.get(0)
          if (e0 instanceof FileValue || /^\[\[.*\]\]$/.test(e0.toString())) kind = 'link'
        }
        listKindOf.set(col, kind)
      }
      // objects/etc. stay read-only
      break
    }
  }

  // Vault tags for the tag autocomplete (computed once, on demand).
  let cachedTags: string[] | null = null
  const allTags = (): string[] => {
    if (cachedTags) return cachedTags
    const mc = app.metadataCache as MetadataCacheWithTags
    if (typeof mc.getTags === 'function') {
      cachedTags = Object.keys(mc.getTags()).map((t) => t.replace(/^#/, ''))
    } else {
      const set = new Set<string>()
      for (const f of app.vault.getMarkdownFiles()) {
        app.metadataCache.getFileCache(f)?.tags?.forEach((t) => set.add(t.tag.replace(/^#/, '')))
      }
      cachedTags = Array.from(set)
    }
    return cachedTags
  }

  const headRow = table.createEl('thead').createEl('tr')
  columns.forEach((col, i) => {
    const th = headRow.createEl('th', { cls: 'bcgt-col-header' })
    thEls[i] = th
    th.style.setProperty('--bcgt-w', `${curWidths[i]}px`)
    const inner = th.createDiv('bcgt-col-inner')
    // Defensive: a single bad property must not crash the whole table render
    // (some Obsidian calls throw internally on certain property ids).
    try {
      setIcon(inner.createSpan('bcgt-col-icon'), iconFor(col))
    } catch {
      /* skip icon */
    }
    let displayName: string = col
    try {
      displayName = config.getDisplayName(col)
    } catch {
      /* fall back to the raw id */
    }
    inner.createSpan({ cls: 'bcgt-col-name', text: displayName })
    const dir = sortMap.get(col)
    if (dir) {
      try {
        setIcon(inner.createSpan('bcgt-col-sort'), dir === 'ASC' ? 'arrow-up' : 'arrow-down')
      } catch {
        /* skip sort icon */
      }
    }
    attachResize(th.createDiv('bcgt-resize-handle'), th, col, i)
  })
  applyTableWidth()
  const colCount = Math.max(columns.length, 1)

  const valueOf = (entry: BasesEntry, col: BasesPropertyId): Value | null => {
    try {
      return entry.getValue(col)
    } catch {
      return null
    }
  }

  // Outline the enclosing cell while it's being edited.
  const setEditing = (el: HTMLElement, on: boolean): void => {
    const cell = el.closest('.bcgt-cell')
    cell?.toggleClass('bcgt-editing', on)
  }

  // Read-only render of a value into `el` (honours the date-format option).
  const renderValue = (el: HTMLElement, entry: BasesEntry, col: BasesPropertyId): void => {
    const value = valueOf(entry, col)
    if (value === null) return
    try {
      if (settings.dateFormat && value instanceof DateValue) {
        const formatted = formatDate(value.toString(), settings.dateFormat)
        if (formatted !== null) {
          el.setText(formatted)
          return
        }
      }
      value.renderTo(el, app.renderContext)
    } catch {
      el.setText(value.toString())
    }
  }

  // Current value as an editable input string.
  const editString = (entry: BasesEntry, col: BasesPropertyId, type: EditType): string => {
    const value = valueOf(entry, col)
    if (value === null) return ''
    if (type === 'date') {
      return formatDate(value.toString(), 'YYYY-MM-DD') ?? ''
    }
    return value.toString()
  }

  // Parse a comma/newline-separated edit string into a tag/list array.
  const parseList = (raw: string): string[] =>
    raw
      .split(/[,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)


  // Click-to-edit cell for text/number/date note properties; commits to
  // frontmatter on Enter/blur, cancels on Escape.
  const renderEditable = (
    inner: HTMLElement,
    entry: BasesEntry,
    col: BasesPropertyId,
    type: EditType,
  ): void => {
    const file = entry.file
    if (!file) {
      renderValue(inner, entry, col)
      return
    }
    const cell = inner.closest('.bcgt-cell')

    const showRead = (): void => {
      setEditing(inner, false)
      inner.empty()
      const display = inner.createDiv('bcgt-editable')
      renderValue(display, entry, col)
    }

    const showEdit = (): void => {
      if (inner.querySelector('.bcgt-edit-input')) return // already editing
      inner.empty()
      setEditing(inner, true)

      // Text columns use a multi-line textarea sized to the row height; number
      // and date keep a single-line input.
      let field: HTMLInputElement | HTMLTextAreaElement
      if (type === 'text') {
        const ta = inner.createEl('textarea', { cls: 'bcgt-edit-input bcgt-edit-textarea' })
        ta.rows = rowLines(settings.rowHeight)
        ta.value = editString(entry, col, type)
        field = ta
      } else {
        const input = inner.createEl('input', { cls: 'bcgt-edit-input' })
        input.type = type === 'number' ? 'number' : 'date'
        input.value = editString(entry, col, type)
        field = input
      }
      field.focus()
      try {
        field.select()
      } catch {
        /* select() not supported for this input type */
      }
      let done = false
      const commit = (): void => {
        if (done) return
        done = true
        const key = col.slice('note.'.length)
        const raw = field.value
        void app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          if (raw.trim() === '') delete fm[key]
          else if (type === 'number') {
            const n = Number(raw)
            if (!Number.isNaN(n)) fm[key] = n
          } else fm[key] = raw
        })
        showRead()
      }
      field.addEventListener('blur', commit)
      field.addEventListener('keydown', (evt: KeyboardEvent) => {
        // In the textarea, Enter inserts a newline; commit on blur instead.
        if (evt.key === 'Enter' && type !== 'text') {
          evt.preventDefault()
          field.blur()
        } else if (evt.key === 'Escape') {
          evt.preventDefault()
          done = true
          showRead()
        }
      })
    }

    showRead()
    // Clicking anywhere in the cell starts editing.
    cell?.addEventListener('click', (evt) => {
      if ((evt.target as HTMLElement).closest('a, input, textarea, button')) return
      showEdit()
    })
  }

  // Strip a leading '#' so tags persist in clean frontmatter form.
  const cleanTag = (s: string): string => s.replace(/^#/, '').trim()

  // Always-interactive list (tags) cell: items render natively (clickable tag
  // pills / links) each with a hover-×; a trailing input adds new items. Writes
  // to frontmatter only on focus-out, and only if something changed — so
  // clicking a tag/link to navigate doesn't trigger a write.
  const renderListEditable = (inner: HTMLElement, entry: BasesEntry, col: BasesPropertyId): void => {
    const file = entry.file
    if (!file) {
      renderValue(inner, entry, col)
      return
    }
    const key = col.slice('note.'.length)
    // Opt this cell out of the -webkit-line-clamp box (it mis-measures wrapped
    // flex content); clamp by max-height instead — see styles.css.
    inner.addClass('bcgt-content-list')
    const wrap = inner.createDiv('bcgt-list')
    const kind = listKindOf.get(col) ?? 'plain'
    let dirty = false
    // The add-input only exists while editing (created on cell click).
    let input: HTMLInputElement | null = null
    let suggest: ListSuggest | null = null

    // Each item is a .bcgt-litem carrying its text in data-text (the DOM is the
    // source of truth, so add/remove never needs index bookkeeping). The × is
    // always visible. `before` lets new items insert ahead of the add-input.
    const addItemNode = (value: Value | null, text: string, before: Node | null): void => {
      const li = createSpan('bcgt-litem')
      li.setAttribute('data-text', text)
      const content = li.createSpan('bcgt-litem-content')
      let rendered = false
      if (value) {
        try {
          value.renderTo(content, app.renderContext)
          rendered = true
        } catch {
          rendered = false
        }
      }
      if (!rendered) content.setText(text)
      const x = li.createSpan({ cls: 'bcgt-litem-x', text: '×' })
      x.addEventListener('mousedown', (e) => {
        e.preventDefault() // don't trigger navigation / blur the input
        li.remove()
        dirty = true
        if (input) input.focus()
        else commitIfDirty()
      })
      wrap.insertBefore(li, before)
    }

    const itemTexts = (): string[] =>
      Array.from(wrap.querySelectorAll('.bcgt-litem')).map((n) => n.getAttribute('data-text') ?? '')

    const commitIfDirty = (): void => {
      if (!dirty) return
      dirty = false
      const items = itemTexts()
      void app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (items.length === 0) delete fm[key]
        else fm[key] = items
      })
    }

    // Render existing items natively (per element, so tags/links keep behaviour).
    const value = valueOf(entry, col)
    if (value instanceof ListValue) {
      for (let i = 0; i < value.length(); i++) {
        const el = value.get(i)
        addItemNode(el, cleanTag(el.toString()), null)
      }
    }

    const openInput = (): void => {
      if (input) {
        input.focus()
        return
      }
      setEditing(wrap, true)
      input = wrap.createEl('input', { cls: 'bcgt-list-input', attr: { type: 'text' } })

      // Add one item if it isn't already present.
      const addItem = (text: string): void => {
        if (!text || itemTexts().includes(text)) return
        addItemNode(null, text, input)
        dirty = true
      }

      // Tag / page-link autocomplete popover (plain lists get none).
      if (kind === 'tag' || kind === 'link') {
        suggest = new ListSuggest(
          app,
          input,
          kind,
          kind === 'tag' ? allTags() : [],
          () => new Set(itemTexts()),
          (picked) => {
            addItem(picked)
            if (input) input.focus()
          },
        )
      }

      input.addEventListener('keydown', (evt) => {
        if (!input) return
        if (evt.key === 'Enter' || evt.key === ',') {
          evt.preventDefault()
          for (const t of parseList(input.value).map(cleanTag)) addItem(t)
          input.value = ''
        } else if (evt.key === 'Backspace' && input.value === '') {
          const items = wrap.querySelectorAll('.bcgt-litem')
          if (items.length > 0) {
            evt.preventDefault()
            items[items.length - 1].remove()
            dirty = true
          }
        } else if (evt.key === 'Escape') {
          evt.preventDefault()
          closeInput()
        }
      })
      input.focus()
    }

    const closeInput = (): void => {
      if (!input) return
      suggest?.close()
      suggest = null
      input.remove()
      input = null
      setEditing(wrap, false)
      commitIfDirty()
    }

    // Clicking anywhere in the cell (except a tag/link/×) starts adding.
    const cell = inner.closest('.bcgt-cell')
    cell?.addEventListener('click', (evt) => {
      if ((evt.target as HTMLElement).closest('a, input, button, .bcgt-litem-x')) return
      openInput()
    })

    // Leaving the cell closes the input and commits any change.
    wrap.addEventListener('focusout', (evt) => {
      const next = evt.relatedTarget as Node | null
      if (next && wrap.contains(next)) return
      closeInput()
    })
  }

  // Renders a cell's content into `host` (normally the <td>, but a flex wrapper
  // for indented first cells). `cellTd` is the owning <td> for editable styling.
  const renderCell = (
    host: HTMLElement,
    cellTd: HTMLElement,
    entry: BasesEntry,
    col: BasesPropertyId,
  ): void => {
    const inner = host.createDiv('bcgt-cell-content')

    // The file-name column renders as a clickable internal link to the note.
    if (col === 'file.name') {
      const file = entry.file
      if (!file) return
      const link = inner.createEl('a', { cls: 'internal-link bcgt-file-link', text: file.basename })
      link.addEventListener('click', (evt) => {
        evt.preventDefault()
        const newLeaf = evt.ctrlKey || evt.metaKey
        void app.workspace.openLinkText(file.path, file.path, newLeaf)
      })
      return
    }

    const editType = editTypeOf.get(col)

    // Editable checkbox for note-source boolean columns.
    if (editType === 'bool') {
      const file = entry.file
      if (!file) return
      const checkbox = inner.createEl('input', { cls: 'bcgt-checkbox', attr: { type: 'checkbox' } })
      const cur = valueOf(entry, col)
      checkbox.checked = cur instanceof BooleanValue && cur.isTruthy()
      const key = col.slice('note.'.length)
      checkbox.addEventListener('change', () => {
        void app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm[key] = checkbox.checked
        })
      })
      return
    }

    // Chip editor for list (tags) note columns.
    if (editType === 'list') {
      cellTd.addClass('bcgt-cell-editable')
      renderListEditable(inner, entry, col)
      return
    }

    // Click-to-edit for text/number/date note columns.
    if (editType === 'text' || editType === 'number' || editType === 'date') {
      cellTd.addClass('bcgt-cell-editable')
      renderEditable(inner, entry, col, editType)
      return
    }

    // Everything else is read-only (lists, formulas, file properties, ...).
    renderValue(inner, entry, col)
  }

  const renderDataRow = (
    tbody: HTMLElement,
    entry: BasesEntry,
    ancestors: string[],
    treePrefix: string,
  ): void => {
    const row = tbody.createEl('tr', { cls: 'bcgt-row' })
    rowMeta.push({ el: row, ancestors })
    columns.forEach((col, ci) => {
      const td = row.createEl('td', { cls: 'bcgt-cell' })
      if (ci === 0 && treePrefix) {
        // Nested row first cell: the rail is an absolutely-positioned full-height
        // layer (so it fills the row height regardless of this cell's content),
        // and the content is shifted right past it by --segs * one indent step.
        td.addClass('bcgt-rail')
        td.style.setProperty('--segs', String(treePrefix.length / 4))
        renderTreeRail(td, treePrefix)
        renderCell(td, td, entry, col)
      } else {
        renderCell(td, td, entry, col)
      }
    })
  }

  // Build the tree connector rail from a prefix string (4-char units: "│   ",
  // "    ", "├── ", "└── ") as full-height CSS segments — so verticals span the
  // whole row height and headers/rows align identically. Returns nothing.
  const renderTreeRail = (container: HTMLElement, prefix: string): void => {
    if (!prefix) return
    const rail = container.createDiv('bcgt-tree')
    for (let i = 0; i < prefix.length; i += 4) {
      const unit = prefix.slice(i, i + 4)
      const seg = rail.createDiv('bcgt-seg')
      if (unit === '│   ') seg.addClass('bcgt-seg-v')
      else if (unit === '├── ') seg.addClass('bcgt-seg-tee')
      else if (unit === '└── ') seg.addClass('bcgt-seg-ell')
      // "    " → blank segment (just spacing)
    }
  }

  // A collapsible header row (top group or, when depth > 0, a sub-group). Single
  // spanning cell; sub-groups are indented by depth and show a "A → B" breadcrumb.
  const renderHeader = (
    tbody: HTMLElement,
    depth: number,
    foldKey: string,
    ancestors: string[],
    labelText: string,
    count: number,
    subCount: number,
    treePrefix: string,
    labelValue?: Value | null,
  ): void => {
    allFoldKeys.add(foldKey)
    const isTop = depth === 0
    const tr = tbody.createEl('tr', { cls: isTop ? 'bcgt-group-header' : 'bcgt-subgroup-header' })
    rowMeta.push({ el: tr, ancestors })
    const cell = tr.createEl('td', { cls: isTop ? 'bcgt-group-cell' : 'bcgt-subgroup-cell' })
    cell.colSpan = colCount
    const inner = cell.createDiv('bcgt-group-inner')
    // Tree connector rail (├──/└──/│) as full-height CSS segments.
    renderTreeRail(inner, treePrefix)
    const chevron = inner.createSpan('bcgt-chevron')
    setIcon(chevron, 'chevron-down')
    chevrons.push({ key: foldKey, el: chevron })
    if (settings.showCount) {
      inner.createSpan({ cls: 'bcgt-group-count', text: String(count) })
    }
    const label = inner.createSpan('bcgt-group-label')
    if (labelValue) {
      try {
        labelValue.renderTo(label, app.renderContext)
      } catch {
        label.setText(labelText)
      }
    } else {
      label.setText(labelText)
    }
    if (labelText === '(none)') label.addClass('bcgt-group-none')
    if (subCount > 1) {
      inner.createSpan({ cls: 'bcgt-subgroup-tally', text: String(subCount) })
    }
    tr.addEventListener('click', () => (isTop ? toggleTop(foldKey) : toggleFold(foldKey)))
  }

  // ---- Option X: split each group value on '/' into a nested tree ----
  // Standard tree-prefix recursion: `prefix` is the accumulated "│  "/"   "
  // segments for the ancestors; `isLast` marks this node as its parent's last
  // child (└── vs ├──). Connectors are drawn only below the top band (depth>0).
  const renderNode = (
    tbody: HTMLElement,
    node: TreeNode,
    depth: number,
    ancestors: string[],
    labelPath: string[],
    prefix: string,
    isLast: boolean,
  ): void => {
    const segLabel = node.label === '__bcgt_none__' ? '(none)' : cleanLabel(node.label)
    const breadcrumb = [...labelPath, segLabel]
    const treePrefix = depth === 0 ? '' : prefix + (isLast ? '└── ' : '├── ')
    renderHeader(
      tbody,
      depth,
      node.key,
      ancestors,
      breadcrumb.join(' → '),
      nodeTotal(node),
      node.children.size,
      treePrefix,
    )
    const childAncestors = [...ancestors, node.key]
    const childPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ')
    const kids = [...node.children.values()]
    const total = kids.length + node.entries.length
    kids.forEach((child, i) => {
      renderNode(tbody, child, depth + 1, childAncestors, breadcrumb, childPrefix, i === total - 1)
    })
    node.entries.forEach((entry, j) => {
      const last = kids.length + j === total - 1
      renderDataRow(tbody, entry, childAncestors, childPrefix + (last ? '└── ' : '├── '))
    })
  }

  if (isGrouped && (settings.subGroup || settings.subCols.length > 0)) {
    // Build the grouped tree + relationship maps (shared, view-agnostic core).
    const { roots, topLevelKeys: tlk, rootEntries } = buildGroupTree({
      groups,
      keys,
      settings,
      sep: SEP,
      valueOf,
      directChildren,
      descendants,
    })
    topLevelKeys = tlk
    // Entries whose stripped group value is empty (files in the base's own
    // folder) render at the top, un-railed, with no group header.
    if (rootEntries.length > 0) {
      const tbody = table.createEl('tbody', { cls: 'bcgt-group' })
      for (const entry of rootEntries) renderDataRow(tbody, entry, [], '')
    }
    // Initialise sub-group folds per "when opening a group" for the default
    // (unsaved) state: open top groups get the open-behavior applied; collapsed
    // ones have their descendants collapsed too.
    if (applyOpenDefault) {
      for (const topKey of topLevelKeys) {
        if (collapsed.has(topKey)) {
          for (const d of descendants.get(topKey) ?? []) collapsed.add(d)
        } else {
          applyOpenBehavior(topKey)
        }
      }
    }
    for (const root of roots) {
      const tbody = table.createEl('tbody', { cls: 'bcgt-group' })
      renderNode(tbody, root, 0, [], [], '', true)
    }
  } else {
    // Flat: one tbody per Bases group (sub-grouping off, or no groupBy). No tree
    // connectors here — the empty prefix keeps rows un-railed.
    groups.forEach((group, gi) => {
      const topKey = keys[gi]
      const tbody = table.createEl('tbody', { cls: 'bcgt-group' })
      let baseAncestors: string[] = []
      if (isGrouped) {
        const hasKey = group.hasKey() && group.key
        const labelStr = hasKey ? cleanLabel(group.key!.toString()) : '(none)'
        renderHeader(tbody, 0, topKey, [], labelStr, group.entries.length, 0, '')
        baseAncestors = [topKey]
      }
      for (const entry of group.entries) renderDataRow(tbody, entry, baseAncestors, '')
    })
  }

  // Forget any collapsed keys whose group/sub-group no longer exists.
  for (const k of [...collapsed]) {
    if (!allFoldKeys.has(k)) collapsed.delete(k)
  }

  applyAll()

  // Tag pills (rendered via renderTo) finish sizing just after the first layout
  // pass, leaving list cells collapsed to one line until something forces a
  // reflow. Nudge a layout flush on the next frame so they wrap immediately.
  const win = table.ownerDocument.defaultView
  if (win) {
    win.requestAnimationFrame(() => {
      void table.offsetHeight
    })
  }
}

export default buildTable
