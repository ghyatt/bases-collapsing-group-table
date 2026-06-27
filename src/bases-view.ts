import { BasesView, BasesPropertyId, debounce, QueryController } from 'obsidian'
import buildTable, { type BuildTableArgs } from './build-table'
import buildCards from './build-cards'
import renderError from './render-error'
import type { TableSettings } from './types'

export const VIEW_TYPE = 'collapsing-group-table'
export const VIEW_TYPE_CARDS = 'collapsing-group-cards'

// View-config key holding the saved fold state: { sig, keys }. `sig` ties the
// saved folds to the accordion/start-collapsed options so changing those
// re-applies the default instead of restoring stale folds.
const FOLD_KEY = 'foldState'

export class GroupTableView extends BasesView {
  readonly type: string = VIEW_TYPE

  private viewContainerEl: HTMLElement
  // Session fold state; build-table mutates it in place.
  private collapsed: Set<string> | null = null
  // Signature (accordion + startCollapsed) the current fold state corresponds to.
  private collapseSig = ''
  // True once the user manually folds/unfolds. Until then we keep recomputing the
  // fold from saved-or-default against the current groups (so it applies even if
  // the first render predates grouping or the instance is reused on return).
  private userTouched = false

  // Persist the fold state — debounced so rapid toggles coalesce into one write,
  // and only ever during active interaction (never on unload, which corrupted
  // other bases when written during teardown).
  private saveFold = debounce(() => this.persistFold(), 700, true)

  constructor(controller: QueryController, parentEl: HTMLElement) {
    super(controller)
    this.viewContainerEl = parentEl.createDiv('bcgt-view')
  }

  onDataUpdated(): void {
    this.viewContainerEl.empty()

    const settings = this.readSettings()
    const groups = this.data.groupedData

    if (!groups || groups.length === 0) {
      renderError(this.viewContainerEl, 'No entries match this view.')
      return
    }

    // Columns to render. Table requires at least one (a column-less table is
    // pointless); cards allow none (covers/titles still show). null = abort.
    const columns = this.resolveColumns()
    if (columns === null) {
      renderError(this.viewContainerEl, 'Add at least one property (column) to this view.')
      return
    }

    // Bases returns a single empty-key group when no groupBy is configured —
    // render a plain table (no chevrons / controls) in that case.
    const isGrouped = !(groups.length === 1 && !groups[0].hasKey())

    const keyOf = (group: { key?: { toString(): string }; hasKey(): boolean }): string =>
      group.hasKey() && group.key ? group.key.toString() : '__bcgt_none__'

    const allKeys = groups.map(keyOf)
    // Top-level fold keys. With sub-grouping (Option X) the group value is split
    // on '/', so the top level is the distinct first segments; otherwise each
    // full group value is its own top group.
    const topKeys = settings.subGroup
      ? Array.from(new Set(allKeys.map((k) => k.split('/')[0])))
      : allKeys

    // The signature ties saved folds to the options that change the fold-key
    // scheme (split toggle + chosen sub-group columns), so they don't carry over
    // when those change.
    const sig =
      `${settings.accordion ? 'acc' : ''}|${settings.startCollapsed ? 'sc' : ''}` +
      `|${settings.subGroup ? 'sg' : ''}|${settings.subCols.join(',')}`
    // applyOpenDefault: true when we're showing the option-driven default (no
    // saved folds) — buildTable then initialises sub-groups per "when opening a
    // group". When restoring saved folds, we leave them as-is.
    let applyOpenDefault = false
    if (this.collapsed === null || !this.userTouched) {
      // No manual folding yet — restore saved folds (if they match the current
      // options) or fall back to the option-driven default. Re-runs each render.
      const saved = this.savedFold(sig)
      if (saved) {
        this.collapsed = saved
      } else {
        this.collapsed = this.resolveCollapsed(topKeys, settings)
        applyOpenDefault = true
      }
      this.collapseSig = sig
    } else if (sig !== this.collapseSig) {
      // The user flipped an option — reset to the new default, save, and resume.
      this.collapsed = this.resolveCollapsed(topKeys, settings)
      this.collapseSig = sig
      this.userTouched = false
      this.saveFold()
      applyOpenDefault = true
    }
    // Stale-key pruning (top-level and sub-group keys) is done inside buildTable,
    // which knows every fold key that exists this render.

    // Guard the whole render so an unexpected error shows a message instead of
    // leaving a broken/blank view.
    try {
      this.build(this.viewContainerEl, {
        app: this.app,
        groups,
        columns,
        config: this.config,
        isGrouped,
        settings,
        // Pass already-computed keys so the builder uses the exact same key
        // strings as our collapsed set.
        keys: allKeys,
        collapsed: this.collapsed,
        applyOpenDefault,
        markTouched: () => {
          this.userTouched = true
          this.saveFold()
        },
      })
    } catch (e) {
      renderError(this.viewContainerEl, `Could not render the view: ${String(e)}`)
    }
  }

  // The renderer — overridden by the cards view. Default is the table.
  protected build(container: HTMLElement, args: BuildTableArgs): void {
    buildTable(container, args)
  }

  // Columns to display. Table: the configured order, falling back to all visible
  // properties; null (abort) when there are none. Cards override to allow none.
  protected resolveColumns(): BasesPropertyId[] | null {
    let columns = this.config.getOrder()
    if (columns.length === 0) columns = this.data.properties
    return columns.length === 0 ? null : columns
  }

  onunload(): void {
    // Deliberately NOT writing config here. A config.set during teardown is the
    // riskiest write timing (the controller may be switching bases), so we avoid
    // it entirely. Fold state is session-only until we have a safe persist path.
    this.viewContainerEl.empty()
  }

  private readSettings(): TableSettings {
    const df = this.config.get('dateFormat')
    const rh = this.config.get('rowHeight')
    return {
      rowHeight: typeof rh === 'string' ? rh : 'short',
      accordion: this.config.get('accordion') === true,
      startCollapsed: this.config.get('startCollapsed') === true,
      // default true
      showCount: this.config.get('showCount') !== false,
      subGroup: this.config.get('subGroup') === true,
      subCols: this.readSubCols(),
      openBehavior: typeof this.config.get('openBehavior') === 'string'
        ? (this.config.get('openBehavior') as string)
        : 'first',
      dateFormat: typeof df === 'string' ? df.trim() : '',
    }
  }

  // The selected sub-group property ids, in level order (2nd, 3rd), skipping
  // unset ones so a 3rd-level pick still works if the 2nd is set.
  private readSubCols(): string[] {
    const cols: string[] = []
    for (const key of ['subCol1', 'subCol2']) {
      const p = this.config.getAsPropertyId(key)
      if (p) cols.push(p)
    }
    return cols
  }

  // Saved folds if they match the current option-signature, else null. Keeps all
  // saved keys (top-level and sub-group); buildTable prunes any that are stale.
  private savedFold(sig: string): Set<string> | null {
    const saved = this.config.get(FOLD_KEY)
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const s = saved as { sig?: unknown; keys?: unknown }
      if (s.sig === sig && Array.isArray(s.keys)) {
        return new Set(s.keys.filter((k): k is string => typeof k === 'string'))
      }
    }
    return null
  }

  // The option-driven default fold state:
  //  - accordion on → only the first group open (the rest collapsed);
  //  - else start-collapsed on → all collapsed;
  //  - else → all expanded.
  private resolveCollapsed(allKeys: string[], settings: TableSettings): Set<string> {
    if (settings.accordion) return new Set(allKeys.slice(1))
    return settings.startCollapsed ? new Set(allKeys) : new Set<string>()
  }

  // Write the current fold state to the view config. Guarded to only run while
  // the view is on-screen (never during teardown — that was the corruption).
  private persistFold(): void {
    if (this.collapsed === null || !this.viewContainerEl.isConnected) return
    this.config.set(FOLD_KEY, { sig: this.collapseSig, keys: Array.from(this.collapsed) })
  }
}

// Card layout — shares all the grouping/fold/persistence plumbing above; only
// the renderer differs.
export class GroupCardsView extends GroupTableView {
  readonly type: string = VIEW_TYPE_CARDS

  protected build(container: HTMLElement, args: BuildTableArgs): void {
    buildCards(container, args)
  }

  // Cards show covers/titles even with no fields, so don't require columns and
  // don't fall back to all properties — use the configured order as-is.
  protected resolveColumns(): BasesPropertyId[] {
    return this.config.getOrder()
  }
}
