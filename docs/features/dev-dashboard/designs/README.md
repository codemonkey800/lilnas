# dev-dashboard — UI mockups

**Open [`index.html`](index.html) in a browser.** No install, no server. Every
`*.html` here is self-contained: its CSS and JS are inlined at build time.

Those `*.html` files are **generated**. Don't edit them — edit the Pug in
`src/` and rebuild. Run these from the repo root:

```bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
pnpm mockups:lint   # prettier check on src/
```

This directory is not an npm package — no `package.json`, no `node_modules`.
The builder is `lilnas mockups build`, from `@lilnas/cli`.

Drawn in **Category Standard** at **compact** density (dev is a compact app),
from the shared kit in [`docs/designs/mockup-kit`](../../../designs/mockup-kit/README.md).
Two screens, each at 1280 and 390: the overview (`index`) and one stack in full
(`stack-detail`), with every state the app shows below them.

## Layout

```
src/
  theme.css        three lines: Tailwind, its source, the kit's theme
  mixins/dev.pug   dev-only components: stack card, host strip, service row,
                   reaper panel, container logs…
  pages/*.pug      one per screen; they extend the kit's page.pug
  data/*.mjs       copy and sample data, keyed by page name
```

Everything generic (button, badge, note, meter, dataList, logViewer…) comes
from the kit; don't copy it back in here.
