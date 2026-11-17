# design-system — component reference

**Open [`index.html`](index.html) in a browser.** No install, no server. It is
the live reference for the lilnas design system: every component in the mockup
kit, every variant and state, both densities, the palette, the type scale, the
doorplate for each app, the motion and the icon set.

`index.html` is **generated**. Don't edit it — edit the Pug in `src/` (or the
kit it extends) and rebuild, from the repo root:

```bash
pnpm mockups        # src/ -> ./index.html
pnpm mockups:watch  # same, rebuilding on every save
pnpm mockups:lint   # prettier check over every designs src/ and the kit
```

This page replaces the hand-written
[`docs/designs/preview/index.html`](../../../designs/preview/index.html) as the
reference. That file is kept as the comparison-era snapshot.

## What's here

```
src/
  theme.css       three lines: the two per-project Tailwind lines, then the kit
  pages/
    index.pug     the whole page — one section per component family
  data/
    index.mjs     copy and sample data: palette, type scale, table rows, logs
```

There are no mixins or layout of its own. Everything this page draws comes from
the shared kit, [`docs/designs/mockup-kit`](../../../designs/mockup-kit)
(`page.pug`, `ui.pug`, `mock.pug`, `theme.css`, `sprite.html`), so this page is
also the proof that the kit renders end to end. See that README for the mixin
list and how a project includes it.

## What the page shows

| Section        | Shows                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| Foundations    | Palette, the type scale, shapes and the four elevation levels                             |
| Doorplate      | One per app (portal, auth, dev, download, tdr, tdr-code), plus hover/focus and both marks |
| App bar        | Desktop and mobile behind the CSS-only switch, plus compact                               |
| Button         | accent/outline/ghost/bad × rest/hover/pressed/focus/disabled/loading, sizes, icon-only    |
| Badge          | The five tones, `live`, and the status dot                                                |
| Cards          | Card, sunk card, panel, tile, media card in every state                                   |
| Forms          | Input states, field with hint and error, textarea, search (desktop and phone)             |
| Choice         | Checkbox, radio, switch, segmented, slider — click them, they are native inputs           |
| Overlays       | Select, menu and combobox, drawn open                                                     |
| Dialog         | Dialog (plain and destructive), bottom and right sheets                                   |
| Tabs & tables  | Tabs, breadcrumb, pagination, the table that becomes a card list, compact                 |
| Feedback       | Toast, note, empty state, skeleton, progress, meter                                       |
| People & hints | Avatar sizes, stack, tooltip, kbd                                                         |
| Logs           | The log viewer with streaming rows                                                        |
| Density        | The same form in comfortable (36px) and compact (30px)                                    |
| Motion         | The staggered entry                                                                       |
| Icons          | Every sprite icon, by name                                                                |

Hover, pressed and focus are shown with `data-force` attributes rather than a
real pointer; see the kit README ("Showing a state").
