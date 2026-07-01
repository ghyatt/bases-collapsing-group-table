import { BasesEntry, BasesPropertyId, DateValue, moment, setIcon, TFile, Value } from 'obsidian'
import { buildGroupTree, cleanLabel, groupByNames, nodeTotal, type TreeNode } from './group-tree'
import type { BuildTableArgs } from './build-table'

// Card-specific config — our own options (config.get/getAsPropertyId) plus the
// built-in Cards view's top-level fields (image/cardSize/imageAspectRatio) so a
// `type: cards` view can be switched to ours and keep its image/size settings.
// None are in the public typings — read via a minimal cast.
interface CardConfig {
  getAsPropertyId(key: string): BasesPropertyId | null
  get(key: string): unknown
  image?: string
  cardSize?: number
  imageAspectRatio?: number
  imageFit?: string
}

const SEP = '/'

// Renders the grouped data as collapsible card sections. Shares buildGroupTree
// (tree + relationship maps) with the table; the fold engine mirrors the table's
// logic so collapse/accordion/open-behavior behave identically.
const buildCards = (container: HTMLElement, args: BuildTableArgs): void => {
  const { app, groups, columns, config, isGrouped, settings, keys, collapsed, applyOpenDefault, markTouched } =
    args

  let topLevelKeys: string[] = keys
  const allFoldKeys = new Set<string>()
  const rowMeta: { el: HTMLElement; ancestors: string[] }[] = []
  const chevrons: { key: string; el: HTMLElement }[] = []
  const descendants = new Map<string, string[]>()
  const directChildren = new Map<string, string[]>()

  // ---- card config ----
  const cardCfg = config as unknown as CardConfig
  // Image: our picker, else the built-in `image` field (drop-in from cards view).
  const imageProp =
    cardCfg.getAsPropertyId('cardImage') ??
    (typeof cardCfg.image === 'string' && cardCfg.image ? (cardCfg.image as BasesPropertyId) : null)
  // Width: the built-in `cardSize` if present (drop-in), else our `cardWidth`.
  const builtinSize = Number(cardCfg.cardSize)
  const optWidth = Number(cardCfg.get('cardWidth'))
  const cardWidth =
    Number.isFinite(builtinSize) && builtinSize > 0
      ? builtinSize
      : Number.isFinite(optWidth) && optWidth > 0
        ? optWidth
        : 240
  // Image aspect ratio (height ÷ width) for uniform cover boxes; 0 = natural.
  // Our `cardAspect` option wins; else the built-in `imageAspectRatio` field.
  const arOpt = Number(cardCfg.get('cardAspect'))
  const arBuiltin = Number(cardCfg.imageAspectRatio)
  const aspect =
    Number.isFinite(arOpt) && arOpt > 0 ? arOpt : Number.isFinite(arBuiltin) && arBuiltin > 0 ? arBuiltin : 0
  // How the image fills its box: 'cover' (default, crop to fill) or 'contain'
  // (whole image, letterboxed). The built-in `imageFit` field wins (drop-in),
  // else our `cardFit` option.
  const fitRaw =
    cardCfg.imageFit === 'contain' || cardCfg.imageFit === 'cover' ? cardCfg.imageFit : cardCfg.get('cardFit')
  const imageFit = fitRaw === 'contain' ? 'contain' : 'cover'
  // Filename display: 'show' (default, below image), 'hide', or 'overlay'.
  const tm = cardCfg.get('cardTitle')
  const titleMode = tm === 'hide' || tm === 'overlay' ? tm : 'show'
  const df = cardCfg.get('dateFormat')
  const dateFormat = typeof df === 'string' ? df.trim() : ''
  container.style.setProperty('--bcgt-card-w', `${cardWidth}px`)
  container.style.setProperty('--bcgt-fit', imageFit)

  const valueOf = (entry: BasesEntry, col: BasesPropertyId): Value | null => {
    try {
      return entry.getValue(col)
    } catch {
      return null
    }
  }

  // Resolve the image property's value to an <img> src. The value renders as a
  // link via renderTo, so instead we parse it to a linkpath/URL and resolve it
  // to a vault resource (external URLs pass through).
  const cardImageSrc = (entry: BasesEntry): string | null => {
    if (!imageProp) return null
    const v = valueOf(entry, imageProp)
    if (!v) return null
    let raw = v.toString().trim()
    if (!raw) return null
    if (/^https?:\/\//i.test(raw)) return raw
    // strip ![[...]] / [[...]] / [text](url) / ![alt](url) wrappers
    const md = raw.match(/^!?\[[^\]]*\]\(([^)]+)\)$/)
    if (md) raw = md[1]
    raw = raw.replace(/^!?\[\[/, '').replace(/\]\]$/, '')
    raw = raw.split('|')[0].split('#')[0].trim()
    if (/^https?:\/\//i.test(raw)) return raw
    const dest = app.metadataCache.getFirstLinkpathDest(raw, entry.file?.path ?? '')
    if (dest) return app.vault.getResourcePath(dest)
    const af = app.vault.getAbstractFileByPath(raw)
    if (af instanceof TFile) return app.vault.getResourcePath(af)
    return null
  }

  // Read-only value render (honours the date-format option).
  const renderValue = (el: HTMLElement, entry: BasesEntry, col: BasesPropertyId): void => {
    const value = valueOf(entry, col)
    if (value === null) return
    try {
      if (dateFormat && value instanceof DateValue) {
        const m = moment(value.toString())
        if (m.isValid()) {
          el.setText(m.format(dateFormat))
          return
        }
      }
      value.renderTo(el, app.renderContext)
    } catch {
      el.setText(value.toString())
    }
  }

  // ---- fold engine (mirrors build-table) ----
  const applyAll = (): void => {
    for (const { el, ancestors } of rowMeta) {
      el.toggleClass('bcgt-hidden', ancestors.some((k) => collapsed.has(k)))
    }
    for (const { key, el } of chevrons) {
      el.toggleClass('bcgt-chev-collapsed', collapsed.has(key))
    }
  }
  const applyOpenBehavior = (key: string): void => {
    const desc = descendants.get(key) ?? []
    if (settings.openBehavior === 'all') {
      for (const d of desc) collapsed.delete(d)
    } else if (settings.openBehavior === 'none') {
      for (const d of desc) collapsed.add(d)
    } else {
      for (const d of desc) collapsed.add(d)
      const kids = directChildren.get(key) ?? []
      if (kids.length > 0) collapsed.delete(kids[0])
    }
  }
  const setFold = (key: string, open: boolean): void => {
    if (open) {
      collapsed.delete(key)
      applyOpenBehavior(key)
    } else {
      collapsed.add(key)
      for (const d of descendants.get(key) ?? []) collapsed.add(d)
    }
  }
  const toggleTop = (key: string): void => {
    markTouched()
    const opening = collapsed.has(key)
    if (settings.accordion && opening) {
      for (const k of topLevelKeys) {
        collapsed.add(k)
        for (const d of descendants.get(k) ?? []) collapsed.add(d)
      }
    }
    setFold(key, opening)
    applyAll()
  }
  const toggleFold = (key: string): void => {
    markTouched()
    const opening = collapsed.has(key)
    if (settings.accordion && opening) {
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

  // ---- control bar ----
  if (isGrouped) {
    const bar = container.createDiv('bcgt-controls')
    const makeBtn = (label: string, icon: string): HTMLElement => {
      const btn = bar.createEl('button', { cls: 'bcgt-control-btn' })
      setIcon(btn.createSpan('bcgt-btn-icon'), icon)
      btn.createSpan({ text: label })
      return btn
    }
    makeBtn('Expand all', 'chevrons-up-down').addEventListener('click', () => {
      markTouched()
      collapsed.clear()
      applyAll()
    })
    makeBtn('Collapse all', 'chevrons-down-up').addEventListener('click', () => {
      markTouched()
      for (const key of allFoldKeys) collapsed.add(key)
      applyAll()
    })
    const noteCount = groups.reduce((sum, g) => sum + g.entries.length, 0)
    const groupCount = settings.subGroup ? new Set(keys.map((k) => k.split(SEP)[0])).size : groups.length
    const statsEl = bar.createSpan('bcgt-stats')
    const addStat = (label: string, value: string, sep: string): void => {
      if (sep) statsEl.createSpan({ text: sep })
      statsEl.createSpan({ cls: 'bcgt-stat-label', text: `${label} ` })
      statsEl.createSpan({ text: value })
    }
    addStat('Groups:', String(groupCount), '')
    addStat('Notes:', String(noteCount), ' · ')
    const gbNames = groupByNames(config, settings.subCols)
    addStat('GroupBy:', gbNames.join(', ') || '—', ' - ')
    if (settings.subGroup) {
      statsEl.createSpan({ cls: 'bcgt-nested-tag', text: ' [nested]' })
    }
  }

  // ---- a single card ----
  const renderCard = (grid: HTMLElement, entry: BasesEntry): void => {
    const card = grid.createDiv('bcgt-card')
    const file = entry.file
    const openFile = (evt: MouseEvent): void => {
      if (!file) return
      evt.preventDefault()
      void app.workspace.openLinkText(file.path, file.path, evt.ctrlKey || evt.metaKey)
    }
    let imgBox: HTMLElement | null = null
    if (imageProp) {
      imgBox = card.createDiv('bcgt-card-img')
      if (aspect) {
        imgBox.addClass('bcgt-card-img-fixed')
        imgBox.style.setProperty('--ar', String(aspect))
      }
      // The cover opens the note, like the title.
      if (file) {
        imgBox.addClass('bcgt-card-img-link')
        imgBox.addEventListener('click', openFile)
      }
      // Prefer building our own <img> from the resolved value — a clean, direct
      // child so the aspect-box and object-fit actually apply. If resolution
      // fails, fall back to Obsidian's renderTo (e.g. an image() formula value)
      // and unwrap the <img> out of any span wrapper so our sizing still reaches it.
      const src = cardImageSrc(entry)
      if (src) {
        imgBox.createEl('img', { attr: { src } })
      } else {
        const v = valueOf(entry, imageProp)
        if (v) {
          try {
            v.renderTo(imgBox, app.renderContext)
          } catch {
            /* none */
          }
        }
        const img = imgBox.querySelector('img')
        if (img) {
          img.remove()
          imgBox.empty()
          imgBox.appendChild(img)
        } else {
          imgBox.empty()
        }
      }
    }
    // Filename: 'show' (below image), 'hide', or 'overlay' (over the image, on
    // hover — pure CSS, no extra rendering). Overlay needs an image box; without
    // one it falls back to showing below.
    if (file && titleMode !== 'hide') {
      const overlay = titleMode === 'overlay' && imgBox !== null
      const host = overlay ? imgBox! : card
      const cls = overlay
        ? 'internal-link bcgt-card-title bcgt-card-title-overlay'
        : 'internal-link bcgt-card-title'
      const title = host.createEl('a', { cls, text: file.basename })
      title.addEventListener('click', openFile)
    }
    const fields = card.createDiv('bcgt-card-fields')
    for (const col of columns) {
      if (col === 'file.name' || col === imageProp) continue
      const v = valueOf(entry, col)
      if (v === null) continue
      const row = fields.createDiv('bcgt-card-field')
      row.createSpan({ cls: 'bcgt-card-field-label', text: config.getDisplayName(col) })
      renderValue(row.createSpan('bcgt-card-field-value'), entry, col)
    }
  }

  // ---- walk the tree: header band + nested groups + a card grid of entries ----
  const renderNode = (parent: HTMLElement, node: TreeNode, depth: number, ancestors: string[]): void => {
    const foldKey = node.key
    allFoldKeys.add(foldKey)
    const isTop = depth === 0
    const header = parent.createDiv(`bcgt-card-group ${isTop ? 'bcgt-card-group-top' : 'bcgt-card-group-sub'}`)
    header.style.setProperty('--depth', String(depth))
    rowMeta.push({ el: header, ancestors })
    const chevron = header.createSpan('bcgt-chevron')
    setIcon(chevron, 'chevron-down')
    chevrons.push({ key: foldKey, el: chevron })
    if (settings.showCount) {
      header.createSpan({ cls: 'bcgt-group-count', text: String(nodeTotal(node)) })
    }
    const label = header.createSpan('bcgt-group-label')
    label.setText(node.label === '__bcgt_none__' ? '(none)' : cleanLabel(node.label))
    if (node.children.size > 1) {
      header.createSpan({ cls: 'bcgt-subgroup-tally', text: String(node.children.size) })
    }
    header.addEventListener('click', () => (isTop ? toggleTop(foldKey) : toggleFold(foldKey)))

    const childAncestors = [...ancestors, foldKey]
    for (const child of node.children.values()) {
      renderNode(parent, child, depth + 1, childAncestors)
    }
    if (node.entries.length > 0) {
      const grid = parent.createDiv('bcgt-card-grid bcgt-card-grid-nested')
      grid.style.setProperty('--depth', String(depth + 1))
      rowMeta.push({ el: grid, ancestors: childAncestors })
      for (const entry of node.entries) renderCard(grid, entry)
    }
  }

  if (isGrouped) {
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
    if (applyOpenDefault) {
      for (const topKey of topLevelKeys) {
        if (collapsed.has(topKey)) {
          for (const d of descendants.get(topKey) ?? []) collapsed.add(d)
        } else {
          applyOpenBehavior(topKey)
        }
      }
    }
    // Cards for entries in the base's own folder (empty stripped value) go at
    // the top, in their own grid, with no group header.
    if (rootEntries.length > 0) {
      const grid = container.createDiv('bcgt-card-grid')
      for (const entry of rootEntries) renderCard(grid, entry)
    }
    for (const root of roots) renderNode(container, root, 0, [])
    for (const k of [...collapsed]) {
      if (!allFoldKeys.has(k)) collapsed.delete(k)
    }
    applyAll()
  } else {
    // No groupBy — a single flat grid of cards.
    const grid = container.createDiv('bcgt-card-grid')
    for (const entry of groups[0].entries) renderCard(grid, entry)
  }
}

export default buildCards
