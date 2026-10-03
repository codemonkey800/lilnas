# tdr-bot — UI mockups

**Open [`index.html`](index.html) in a browser.** No install, no server. Every
`*.html` here is self-contained: its CSS and JS are inlined at build time.

Those `*.html` files are **generated**. Don't edit them — edit the Pug in
`src/` and rebuild. Run these from the repo root:

```bash
pnpm mockups        # src/ -> ./*.html
pnpm mockups:watch  # same, rebuilding on every save
```

This directory is not an npm package — no `package.json`, no `node_modules`.
The builder is `lilnas mockups build`, from `@lilnas/cli`.

## Layout

Only `src/pages/` is required; everything else is picked up if present.

```
src/
  theme.css        design tokens as a Tailwind @theme, plus any @utility rules
  runtime.js       optional — inlined into every page as a <script>
  layout/
    page.pug       the shell pages extend
  mixins/*.pug     optional — shared components
  pages/*.pug      one per screen; layout only
  data/*.mjs       optional — copy and sample data, keyed by page name
```

`data/<page>.mjs` default-exports an object that becomes that page's template
locals. It's `.mjs` rather than `.js` because there's no `package.json` here
to tell Node these are ES modules.
