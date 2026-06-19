import { BasesView, debounce, QueryController } from 'obsidian'
import buildTable from './build-table'
import renderError from './render-error'
import type { TableSettings } from './types'

export const VIEW_TYPE = 'collapsing-group-table'

// View-config key holding the saved fold state: { sig, keys }. `sig` ties the
// saved folds to the accordion/start-collapsed options so changing those
// re-applies the default instead of restoring stale folds.
const FOLD_KEY = 'foldState'

export class GroupTableView extends BasesView {
  readonly type = VIEW_TYPE

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

    // Columns: the user-configured order, falling back to every visible property.
    let columns = this.config.getOrder()
    if (columns.length === 0) columns = this.data.properties
    if (columns.length === 0) {
      renderError(this.viewContainerEl, 'Add at least one property (column) to this view.')
      return
    }

    // Bases returns a single empty-key group when no groupBy is configured —
    // render a plain table (no chevrons / controls) in that case.
    const isGrouped = !(groups.length === 1 && !groups[0].hasKey())

    const keyOf = (group: { key?: { toString(): string }; hasKey(): boolean }): string =>
      group.hasKey() && group.key ? group.key.toString() : '__bcgt_none__'

    const allKeys = groups.map(keyOf)

    const sig = `${settings.accordion ? 'acc' : ''}|${settings.startCollapsed ? 'sc' : ''}`
    if (this.collapsed === null || !this.userTouched) {
      // No manual folding yet — load the saved fold (if it matches the current
      // options) or fall back to the default. Re-runs each render so it applies
      // even if the first render predated grouping or the instance is reused.
      this.collapsed = this.loadCollapsed(allKeys, settings, sig)
      this.collapseSig = sig
    } else if (sig !== this.collapseSig) {
      // The user flipped accordion or start-collapsed — reset to the new default,
      // save it, and resume tracking.
      this.collapsed = this.resolveCollapsed(allKeys, settings)
      this.collapseSig = sig
      this.userTouched = false
      this.saveFold()
    }
    // Forget keys for groups that no longer exist.
    for (const key of [...this.collapsed]) {
      if (!allKeys.includes(key)) this.collapsed.delete(key)
    }

    // Guard the whole render so an unexpected error shows a message instead of
    // leaving a broken/blank view.
    try {
      buildTable(this.viewContainerEl, {
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
        markTouched: () => {
          this.userTouched = true
          this.saveFold()
        },
      })
    } catch (e) {
      renderError(this.viewContainerEl, `Could not render the table: ${String(e)}`)
    }
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
      dateFormat: typeof df === 'string' ? df.trim() : '',
    }
  }

  // Restore saved folds when they match the current option-signature, else use
  // the option-driven default.
  private loadCollapsed(allKeys: string[], settings: TableSettings, sig: string): Set<string> {
    const saved = this.config.get(FOLD_KEY)
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      const s = saved as { sig?: unknown; keys?: unknown }
      if (s.sig === sig && Array.isArray(s.keys)) {
        const keys = s.keys.filter((k): k is string => typeof k === 'string')
        return new Set(keys.filter((k) => allKeys.includes(k)))
      }
    }
    return this.resolveCollapsed(allKeys, settings)
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
