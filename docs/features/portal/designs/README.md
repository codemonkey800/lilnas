# portal — UI mockups

**Open [`index.html`](index.html) in a browser.** No install, no server. Every
`*.html` here is self-contained: its CSS is inlined at build time.

Those `*.html` files are **generated**. Don't edit them — edit the Pug in
`src/` and rebuild, from the repo root:

```bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
pnpm mockups:lint   # prettier check over every designs src/ and the kit
```

Drawn in **Category Standard** from the shared kit,
[`docs/designs/mockup-kit`](../../../designs/mockup-kit). Each page shows both
1280 and 390 behind the viewport switch, with every state as a captioned row.

## Pages

| Page                           | Shows                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| [`home.html`](home.html)       | The hallway: `lilnas.io` doorplate, "lilnas apps", a staggered tile grid (3 columns / 1). Normal, empty, error. |
| [`browser.html`](browser.html) | `/browser`: status row + the one action. Not installed, stopped, working, starting, running, error.             |

## Decisions

- **No avatar, no menu button.** The portal has no account and no nav, so
  `src/mixins/portal.pug` draws the kit's app bar with only the doorplate
  (bare `lilnas.io`, no link: portal is home).
- **The browser tile opens the power page**, not `browser.lilnas.io`: it is the
  only tile with a status (`Off`), and the browser is only reachable once turned on.
- **One accent button per view.** `Turn on` is accent. When running, `Open browser`
  takes the accent and `Turn off` steps back to outline.
- **Not installed** has no action, only the one-time command in a sunk card, and
  drops the auto-stop line (nothing to stop).
- Empty copy follows [`voice.md`](../../../designs/voice.md): what isn't here, what
  happens when there is, one button (`Reload`). The error is a `Note` with the
  machine string in mono, and `Retry`.

## Layout

```
src/
  theme.css         three lines: the two per-project Tailwind lines, then the kit
  mixins/portal.pug portalBar, portalMain, homeScreen, browserScreen
  pages/*.pug       index, home, browser — layout only
  data/*.mjs        copy and sample data, keyed by page name
```
