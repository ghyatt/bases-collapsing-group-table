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
  // Optional moment.js format applied to date cells (e.g. "YYYY-MM-DD"). Empty
  // string = use Obsidian's default date rendering. Works around the Bases API
  // not exposing the per-property date format to custom views.
  dateFormat: string
}
