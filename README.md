# Collapsing Group Table

A [Bases](https://obsidian.md/help/bases) table view for [Obsidian](https://obsidian.md/) that turns grouped results into a **collapsible tree**. Group your Base however you like, then fold and unfold groups like branches — with expand-all, collapse-all, and an accordion mode that keeps only one group open at a time.

It uses Obsidian's own Bases data, columns, and cell rendering, so cells look exactly like the built-in Table view (links, dates, tags, checkboxes, formulas) — it just adds the foldable group rows.

## Requirements

- [Obsidian](https://obsidian.md/) `(ver >= 1.10.2)` — the Bases core plugin must be available.

## Installation

### BRAT (beta)

1. In Obsidian, install and enable **BRAT** (Settings → Community plugins → Browse).
2. Settings → **BRAT** → **Add beta plugin**.
3. Enter the repository `ghyatt/bases-collapsing-group-table` and click **Add Plugin**.
4. Enable **Collapsing Group Table** under Settings → Community plugins.

## Usage

1. Create or open a Base.
2. Add a view and choose **Collapsing group table**.
3. Set a **Group by** property in the Base's view options — this is what becomes a foldable branch.
4. Click a group header (or its chevron) to fold/unfold it.

If no **Group by** is set, the view renders as a plain table.

### Controls

- **Click a group header** — collapse or expand that group.
- **Expand all** / **Collapse all** — buttons above the table.
- **Accordion mode** (view option) — expanding one group collapses the others (i.e. only one group open at a time).

## Configuration

All options are set from the Base **view configuration** menu.

| Option | Default | Description |
| --- | --- | --- |
| Accordion mode | off | Expanding a group collapses every other group (only one open at a time). |
| Start with groups collapsed | off | New groups start folded the first time the view is opened. |
| Show entry count on group headers | on | Display the number of entries beside each group name. |

Which rows appear, the grouping, the column order, and the sort all come from the **Base's own** settings — there is nothing to configure by hand. Your fold state is saved into the `.base` file, so it survives reloads.

## Notes

- Grouping is single-level for now (matching the built-in Table view). Nested multi-level grouping is on the roadmap.

## License

[MIT](LICENSE) — provided as is. File bugs or feature requests on [GitHub](https://github.com/ghyatt/bases-collapsing-group-table/issues).
