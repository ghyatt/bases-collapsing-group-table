import type { CachedMetadata } from 'obsidian'

// One row of a note's outline: a heading or a block with an ID.
export interface OutlineItem {
  // 0-based line in the note, for ordering and label lookup.
  line: number
  // Indent below the note row: heading level − 1, or one below the heading above a block.
  depth: number
  // Display text. For blocks this starts as the ID; see blockLabel().
  label: string
  // Link suffix that opens the note there: "#Heading" or "#^block-id".
  link: string
  isBlock: boolean
}

// Headings (except level 1, the note title) and blocks with an ID, in file
// order. A block nests one level below the heading above it.
export const noteOutlineItems = (cache: CachedMetadata | null): OutlineItem[] => {
  if (!cache) return []
  const items: OutlineItem[] = []
  for (const h of cache.headings ?? []) {
    if (h.level === 1) continue
    items.push({ line: h.position.start.line, depth: h.level - 1, label: h.heading, link: `#${h.heading}`, isBlock: false })
  }
  for (const b of Object.values(cache.blocks ?? {})) {
    items.push({ line: b.position.start.line, depth: 0, label: b.id, link: `#^${b.id}`, isBlock: true })
  }
  items.sort((a, b) => a.line - b.line)
  let headingDepth = 0
  for (const it of items) {
    if (it.isBlock) it.depth = headingDepth + 1
    else headingDepth = it.depth
  }
  return items
}

// A readable label for a block: its callout title, or its first line. A block
// ID on its own line (after a callout or quote) labels the block above it, so
// step back over blank lines to that block's first line. Empty if none found.
export const blockLabel = (lines: string[], line: number): string => {
  let at = line
  if ((lines[at] ?? '').trim().startsWith('^')) {
    at--
    while (at > 0 && !(lines[at] ?? '').trim()) at--
    while (at > 0 && (lines[at - 1] ?? '').trim().startsWith('>')) at--
  }
  const raw = (lines[at] ?? '').replace(/^(>\s*)+/, '').replace(/\s\^[\w-]+$/, '').trim()
  const callout = raw.match(/^\[![^\]]+\][-+]?\s*(.*)$/)
  return (callout ? callout[1] : raw).trim()
}
