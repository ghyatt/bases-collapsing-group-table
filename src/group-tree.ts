import { BasesEntry, BasesEntryGroup, BasesPropertyId, Value } from 'obsidian'
import type { TableSettings } from './types'

// A node in the grouped hierarchy. `key` is the full path prefix and doubles as
// the fold key; `label` is this level's segment text.
export interface TreeNode {
  key: string
  label: string
  children: Map<string, TreeNode>
  entries: BasesEntry[]
}

// Total entries in a node's whole subtree (for the count badge).
export const nodeTotal = (node: TreeNode): number =>
  node.entries.length + [...node.children.values()].reduce((s, c) => s + nodeTotal(c), 0)

// Display a group value without wikilink syntax: "[[Annie Ballet]]" → "Annie
// Ballet", "[[note|Alias]]" → "Alias". Group headers aren't clickable, so the
// brackets are just noise. Non-link values are returned unchanged.
export const cleanLabel = (s: string): string => {
  let t = s.trim()
  const m = t.match(/^!?\[\[(.*)\]\]$/)
  if (m) t = m[1]
  const pipe = t.indexOf('|')
  if (pipe >= 0) t = t.slice(pipe + 1)
  return t.trim() || s
}

// Friendly names of all the group-by columns: the Base's groupBy property plus
// any sub-group columns chosen in the dialog (for the control-bar "GroupBy:" line).
interface ConfigGroupBy {
  groupBy?: { property?: string }
  getDisplayName(p: BasesPropertyId): string
}
export const groupByNames = (config: unknown, subCols: string[]): string[] => {
  const c = config as ConfigGroupBy
  const names: string[] = []
  const add = (p: string): void => {
    try {
      names.push(c.getDisplayName(p as BasesPropertyId))
    } catch {
      names.push(p)
    }
  }
  const gb = c.groupBy?.property
  if (typeof gb === 'string' && gb) add(gb)
  for (const sc of subCols) add(sc)
  return names
}

interface BuildArgs {
  groups: BasesEntryGroup[]
  // One key per group (same order as `groups`).
  keys: string[]
  settings: TableSettings
  // Path separator for splitting group values and joining "/"-path fold keys.
  sep: string
  // Reads a property value off an entry (used to partition by sub-group columns).
  valueOf: (entry: BasesEntry, col: BasesPropertyId) => Value | null
  // Out-params, populated here so the caller's fold helpers keep their refs:
  // each fold key → its direct child keys, and → all descendant keys.
  directChildren: Map<string, string[]>
  descendants: Map<string, string[]>
}

// Build the grouped tree (view-agnostic): split the groupBy value on `sep` when
// the toggle is on, else use the whole value, then partition each group's
// entries by the selected sub-group columns (values used WHOLE, never split).
// Also populates the directChildren/descendants relationship maps.
export const buildGroupTree = (args: BuildArgs): { roots: TreeNode[]; topLevelKeys: string[] } => {
  const { groups, keys, settings, sep, valueOf, directChildren, descendants } = args

  // Internal separator for column-based fold keys (won't collide with "/" in
  // values, since column values are used whole).
  const COLSEP = '\u0001'

  const partition = (node: TreeNode, entries: BasesEntry[], cols: string[]): void => {
    if (cols.length === 0) {
      node.entries.push(...entries)
      return
    }
    const [col, ...rest] = cols
    const buckets = new Map<string, BasesEntry[]>()
    const order: string[] = []
    for (const e of entries) {
      const v = valueOf(e, col as BasesPropertyId)
      const k = v === null ? '__bcgt_none__' : v.toString()
      let bucket = buckets.get(k)
      if (!bucket) {
        bucket = []
        buckets.set(k, bucket)
        order.push(k)
      }
      bucket.push(e)
    }
    for (const k of order) {
      const childKey = node.key + COLSEP + k
      const child: TreeNode = { key: childKey, label: k, children: new Map(), entries: [] }
      node.children.set(childKey, child)
      partition(child, buckets.get(k) ?? [], rest)
    }
  }

  // Exclusive: "/" split and column sub-grouping never combine — when the split
  // toggle is on, the column pickers are ignored.
  const cols = settings.subGroup ? [] : settings.subCols
  const rootMap = new Map<string, TreeNode>()
  groups.forEach((group, gi) => {
    const segs = settings.subGroup
      ? keys[gi].split(sep).map((s) => s.trim()).filter((s) => s.length > 0)
      : [keys[gi]]
    if (segs.length === 0) segs.push(keys[gi])
    let level = rootMap
    let prefix = ''
    let node: TreeNode | undefined
    for (const seg of segs) {
      prefix = prefix ? `${prefix}${sep}${seg}` : seg
      node = level.get(prefix)
      if (!node) {
        node = { key: prefix, label: seg, children: new Map(), entries: [] }
        level.set(prefix, node)
      }
      level = node.children
    }
    if (node) partition(node, group.entries, cols)
  })

  // Record tree relationships for the open/close behaviors.
  const collect = (node: TreeNode): string[] => {
    const kids = [...node.children.values()]
    directChildren.set(
      node.key,
      kids.map((k) => k.key),
    )
    const all: string[] = []
    for (const c of kids) all.push(c.key, ...collect(c))
    descendants.set(node.key, all)
    return all
  }
  const roots = [...rootMap.values()]
  for (const root of roots) collect(root)

  return { roots, topLevelKeys: [...rootMap.keys()] }
}
