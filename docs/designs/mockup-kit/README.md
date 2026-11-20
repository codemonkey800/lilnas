# Mockup kit

The Pug + Tailwind kit every lilnas app's mockups include, drawn in the
**Category Standard** system. It replaces the per-project Ultraviolet copies
(`theme.css`, `mixins/ui.pug`, `mixins/mock.pug`, `layout/page.pug`,
`layout/sprite.html`) that each `docs/features/*/designs` project used to carry.

The live reference is
[`docs/features/design-system/designs/index.html`](../../features/design-system/designs/index.html)
— every mixin, every variant and state, both densities. Open it before reading
the code.

| File          | What it is                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `theme.css`   | The `@theme` block from [`foundations.md`](../foundations.md), the named type scale, the utilities Tailwind can't compose, forced states |
| `ui.pug`      | One mixin per component in [`components.md`](../components.md)                                                                           |
| `mock.pug`    | The harness: page header, viewport switch, Nexus review frame, app frame, state rows — furniture around a screen, not part of it         |
| `page.pug`    | The shell a page `extends`: head, Geist fonts, the icon sprite, a centred 1328px column                                                  |
| `sprite.html` | One `<symbol>` set: the union of auth's, download's and dev's icons, plus `pepe-badge` and `pepe-full`                                   |

## Using it from a project

A project is `docs/features/<feature>/designs/` (scaffold one with
`pnpm exec lilnas mockups new <feature>`, then replace its scaffold). Two files
point at the kit.

`src/theme.css` is three lines — the two per-project Tailwind lines, then the kit:

```css
@import 'tailwindcss' source(none);
@source '../.build/html';
@import '../../../../designs/mockup-kit/theme.css';
```

Each `src/pages/*.pug` extends the shell (Pug resolves relative paths outside
`src/`):

```pug
extends ../../../../../designs/mockup-kit/page.pug

block title
  | download — home · UI mockups

block content
  +mockHead({ eyebrow: 'download', title: 'Home' })
    p What this screen is for.

  +appFrame('desktop')
    +appBar('desktop', { app: 'download', links: [{ label: 'Library', active: true }] })
```

Blocks a page fills in: `title`, `head` (rare), `content`. Override `block page`
and call `+mockPage(width)` for a column other than 1328px.

Put a page's copy and sample data in `src/data/<page>.mjs` (the builder passes
it to the template as locals), and keep the `.pug` to layout.

## Mixins

Every mixin ends in `&attributes(attributes)`, so a call site adds layout
classes without the mixin needing a parameter for it:
`+btn({ label: 'Cancel' })(class='flex-1')`. Don't pass a class that fights the
mixin's own (a second `h-*`): two utilities for one property resolve by
Tailwind's output order, not yours.

Call with `()` before attributes when there are no arguments:
`+card()(class='p-6')`.

### `ui.pug` — components

| Mixin                                                                        | Variants and options                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `density(mode)`                                                              | Wrapper: `'comfortable'` (default) or `'compact'`. Controls read it through `data-density`                                                                   |
| `icon(name, size)`                                                           | Any sprite name; `size` in px (default 16)                                                                                                                   |
| `doorplate(app)`                                                             | `'download'`, `'auth'`, `'dev'`, `'tdr'`, `'tdr-code'`…; `'portal'` is the bare `lilnas.io`, which links nowhere                                             |
| `appBar(view, opts)`                                                         | `view` `'desktop'`/`'mobile'`; `opts` `app`, `links`, `initials`, `you`. Block fills the right side. Phone = doorplate + menu button                         |
| `btn(opts)`                                                                  | `variant` accent/outline/ghost/bad (`filled` for the dialog confirm); `size` sm/md/lg; `touch`; `icon`, `iconEnd`, `iconOnly`, `loading`, `disabled`, `full` |
| `badge(opts)`                                                                | `tone` accent/ok/warn/bad/mute, `label`, `live`                                                                                                              |
| `statusDot(tone, pulse)`                                                     | ok/accent/warn/bad/idle; only ok and accent pulse                                                                                                            |
| `card(opts)`, `panel(title, caption)`                                        | `sunk` for a well                                                                                                                                            |
| `tile(opts)`                                                                 | `icon`, `name`, `host`, `status` `{ tone, label, pulse }`                                                                                                    |
| `mediaCard(opts)`                                                            | `state` downloading/queued/delivered/failed, `title`, `meta`, `pct`, `reason`; block adds actions                                                            |
| `input(opts)`, `textarea(opts)`                                              | `value`, `placeholder`, `mono`, `error`, `disabled`                                                                                                          |
| `field(label, hint, error)`                                                  | Wraps a control (the block); the error replaces the hint                                                                                                     |
| `search(opts)`                                                               | Input + accent button; `view: 'mobile'` makes the button icon-only                                                                                           |
| `checkbox`, `radio`, `switch`                                                | `label`, `checked`, `disabled`; checkbox also `mixed`. Native inputs, no JS                                                                                  |
| `segmented(options, selected)`                                               | Strings or `{ value, label, icon }`                                                                                                                          |
| `slider(opts)`                                                               | `label`, `value`, `min`, `max`, `unit`                                                                                                                       |
| `select(opts)`, `menu(items)`, `combobox(opts)`                              | Drawn open. `menuItems` accept `icon`, `kbd`, `selected`, `highlighted`, `destructive`, `{ divider: true }`; combobox takes `groups`, `query`, `create`      |
| `dialog(opts)`, `sheet(side, opts)`                                          | Overlays that fill the nearest `relative` ancestor; `side` `'bottom'`/`'right'`; `dialog` takes `title`, `confirm`, `cancel`, `destructive`                  |
| `tabs`, `tab(label, selected, count)`                                        | A tablist and its triggers                                                                                                                                   |
| `table(cols, rows)`, `dataList(cols, rows, opts)`, `cardList(cols, rows)`    | One column definition `{ key, label, align, mono, type }`; `dataList` renders both, `opts.view` pins one                                                     |
| `toast(tone, title, detail)`                                                 | accent/ok/warn/bad                                                                                                                                           |
| `note(tone, lead)`                                                           | accent/ok/warn/bad; block is the detail after the bold lead                                                                                                  |
| `emptyState(title, body, action)`                                            | The only place the mascot appears                                                                                                                            |
| `skeleton(shape)`                                                            | `'line'`, `'lines'`, `'poster'`, `'avatar'`                                                                                                                  |
| `progress(pct, tone, opts)`, `meter(label, value, pct)`                      | `pct` `null` is indeterminate; the fill goes ok at 100; meter warns past 80% and fails past 95%                                                              |
| `avatar(initials, opts)`, `avatarStack(people, max, size)`                   | `size` 24/32/40/64; `you` is the accent fill                                                                                                                 |
| `tooltip(text)`, `breadcrumb(items)`, `pagination(page, total)`, `kbd(keys)` |                                                                                                                                                              |
| `logViewer(lines, opts)`                                                     | `lines` `{ ts, level, src, msg }`; `stream` staggers the rows                                                                                                |

### `mock.pug` — harness

| Mixin                          | What it does                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `mockHead(opts)`               | Page header: back link, eyebrow, title, standfirst (the block)                                         |
| `mockSection(id, title, lede)` | A titled, anchored section                                                                             |
| `mockFrame(id, title, opts)`   | One Nexus review frame: a `section.sec` with its number, title and caption; `opts.num`, `opts.caption` |
| `viewportToggle(name)`         | Desktop 1280 / Mobile 390, CSS-only (`:has()` radios). `name` must be unique per switch                |
| `viewportPanel(view)`          | One viewport's content; wrap a toggle and two panels in `div(class='vp-scope')`                        |
| `appFrame(view, opts)`         | The window a screen is drawn in; `opts.density`, `opts.height`. `relative`, so dialogs fill it         |
| `frameLabel`                   | Caption under a frame                                                                                  |
| `stateRow(label, opts)`        | A captioned row for one state of a screen or component; `stack` puts the caption above                 |
| `stateCell(label, opts)`       | One captioned example inside a row; `fill` stretches it                                                |
| `jumpNav(items, suffix)`       | Jump links to `[label, id]` pairs                                                                      |
| `code(text)`                   | Inline code                                                                                            |
| `demoFrame(height)`            | A fixed-height `relative` stage for something absolutely positioned                                    |

### Nexus review frames

A human reviews a mockup page in Nexus's review canvas, which lays the page out
as **frames** and pins comments to each one. Nexus reads the built HTML; nothing
is configured. A page opts in by putting `class='page'` on its column and
filling it with `+mockFrame` calls:

```pug
block page
  +mockPage('max-w-[1760px]')(class='page')
    +mockHead({ eyebrow: 'app', title: 'Screen' })
      p What this is.

    each s, i in states
      +mockFrame(s.key, s.label, { num: String(i + 1).padStart(2, '0'), caption: s.caption })
        +myScreen(s)
```

The rules Nexus applies:

- A frame is a direct `<section class="sec …">` child of the first element in
  the document with the class `page`. `+mockFrame` makes that section.
- Children of `.page` before the first section are the **cover band** (title
  and intro), shown above the frames. `+mockHead` goes first.
- A frame's title is the text of its `h2.sec-title`; an optional `.sec-num`
  holds a number such as `01`.
- Frames sit on a grid of cells as wide as the `.page` content, in any order,
  and sometimes one at a time. Each section must stand alone: its own title and
  caption, no "as above", nothing that depends on a control outside it (so no
  viewport switch).
- `sec`, `sec-title`, `sec-num` and `page` are marker classes only; they need
  no CSS.

Size the column to what a frame holds: `max-w-[1760px]` fits a 1280 screen and
a 390 screen side by side with a gap.

### Showing a state

Any element can be pinned to a pseudo-state with a `data-force` attribute —
`(data-force='hover')`, `'active'` or `'focus'` — so a mockup can show it
without anyone pointing at it. `theme.css` redefines the `hover`, `active`,
`focus` and `focus-visible` variants to match the real pseudo-class **or** that
attribute.

## Rules

- **App-specific mixins live in the project**, in its own `src/mixins/<app>.pug`
  (`include`d from the page). This kit is the design system and nothing else:
  no poster art, no workout rows, no queue-specific copy.
- **No behavioural JS.** The viewport switch and every checked/open state is CSS
  (`:has()` on native inputs). The files get opened through wrappers (iframe
  `srcdoc` among them) where a page's own `<script>` never runs.
- **A mixin owns its variants end to end.** Each variant sets its own border and
  each size its own padding, rather than overriding a base.
- **Density is a wrapper**, not an argument: `data-density='compact'` on an
  ancestor.
- **Tailwind scans the compiled HTML**, not the `.pug`, so utilities containing
  `.` or `/` (`text-[13.5px]`, `w-1/2`) survive — write those in `class='…'`
  rather than Pug's `.foo.bar` shorthand.
- Tokens come from [`foundations.md`](../foundations.md), which is canonical.
  `theme.css` reproduces its `@theme` block; the type scale (`text-h1` …
  `text-mono-sm`) is the one addition, and `@lilnas/utils`' `cns()` registers
  the same names — keep the two lists in sync.

## Icons

`sprite.html` carries one `<symbol id="i-<name>">` per icon, plus the two marks:
`pepe-badge` (≤32px: the doorplate, avatars) and `pepe-full` (40px+: empty
states). Use `+icon('name', size)`.

Icons: `activity`, `alert`, `arrow`, `chart`, `check`, `chevron`, `clock`,
`device`, `discord`, `download`, `expand`, `external`, `eye`, `eye-slash`,
`file`, `film`, `filter`, `flag`, `folder`, `globe`, `google`, `grid`,
`grid-fill`, `home`, `inbox`, `info`, `key`, `laptop`, `layers`, `list`, `lock`,
`logout`, `mail`, `monitor`, `more`, `pause`, `play`, `plus`, `recreate`,
`refresh`, `search`, `server`, `shield`, `sort`, `stop`, `terminal`, `trash`,
`tv`, `users`, `volume`, `x`.

`arrow` points right and `chevron` down; rotate with `-scale-x-100` or
`rotate-*` for the other directions. `list` is the menu button.

Where two apps drew the same thing, the 16-grid version (download, dev) won; auth's
20-grid line icons fill the gaps. `info` and `more` are new.
