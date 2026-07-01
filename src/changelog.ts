import { App, Component, MarkdownRenderer, Modal } from 'obsidian'

// Bundled release notes (Markdown). Kept in the plugin so the "what's new"
// popup needs no network. Newest first.
export const CHANGELOG = `## 0.6.0
- **Situational options → Strip prefix** — when nesting is on, remove a prefix from group values so a folder MOC shows relative paths. Enter a literal path, or the formula \`this.file.folder\` to auto-strip the base's own folder.
  - Files in the base's own folder (value equals the prefix) render at the top, ungrouped, with no header.
  - Works in both the table and cards views.

## 0.5.0
- **New "Collapsing group cards" view** — the collapsible/nested grouping, accordion, and open-behaviour, rendered as cards (cover image + title + fields) instead of a table.
  - Reads the built-in Cards settings (\`image\`, \`cardSize\`, \`imageAspectRatio\`, \`imageFit\`) so a \`type: cards\` view can be switched over.
  - **Card options:** image property, width, image fit (cover/contain), aspect ratio, and **Filename** display (show / hide / overlay on hover). Cover and filename open the note.
- **Cleaner config dialog** — options are grouped into sections (Table / Cards / Grouping & nesting).
- Group headers drop \`[[ ]]\` wikilink brackets; the control bar always shows **GroupBy** with every group-by column.
- "What's new" popup on update (toggle in settings).

## 0.4.0
- **Sub-group by additional properties** — pick 2nd/3rd-level columns to nest by (alternative to a \`/\`-delimited group value).

## 0.3.0
- **Tree-command-style connectors** (\`├──\`, \`└──\`, \`│\`) for nested groups.

## 0.2.0
- **Nested groups** — split a \`/\`-delimited group value into a collapsible tree; inline editing; row-height presets; resizable columns.
`

// A simple modal that renders the changelog Markdown.
export class ChangelogModal extends Modal {
  constructor(
    app: App,
    private readonly owner: Component,
    private readonly markdown: string,
  ) {
    super(app)
  }

  onOpen(): void {
    this.titleEl.setText("Collapsing Group Table — What's new")
    this.contentEl.addClass('bcgt-changelog')
    void MarkdownRenderer.render(this.app, this.markdown, this.contentEl, '', this.owner)
  }

  onClose(): void {
    this.contentEl.empty()
  }
}
