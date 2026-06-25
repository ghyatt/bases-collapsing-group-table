// View options, read from the Bases view config (persisted in the .base file).
export interface TableSettings {
  // Fixed row height preset: 'short' | 'medium' | 'tall' | 'extra' (1/2/4/8
  // lines, with images capped to fit) or 'dynamic' (rows grow to content).
  rowHeight: string
  // Opening a group collapses the others ("expand only one").
  accordion: boolean
  // Default fold state for groups that have no saved state yet.
  startCollapsed: boolean
  // Show the entry count beside each group header.
  showCount: boolean
  // Split the groupBy value on "/" into a nested tree.
  subGroup: boolean
  // Additional properties to sub-group by, in order (each adds one nesting level
  // below the groupBy). Values are used whole — NOT split on "/".
  subCols: string[]
  // What happens to sub-groups when a group is opened: 'first' (open the first
  // sub-group), 'all' (open all), or 'none' (keep them collapsed).
  openBehavior: string
  // Optional moment.js format applied to date cells (e.g. "YYYY-MM-DD"). Empty
  // string = use Obsidian's default date rendering. Works around the Bases API
  // not exposing the per-property date format to custom views.
  dateFormat: string
}
