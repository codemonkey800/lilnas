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

Drawn on Category Standard with the shared kit in
[`docs/designs/mockup-kit`](../../../designs/mockup-kit/README.md); read that
for the mixins. Only the tdr-bot-only pieces live here.

```
src/
  theme.css        three lines: Tailwind, then the kit's theme
  mixins/
    tdr-bot.pug    chat bubble, emoji card, reminder row, LLM-call row, cost strip, eval table
  pages/*.pug      one per screen, extending the kit's page.pug; layout only
  data/*.mjs       copy and sample data, keyed by page name (shared.mjs is not a page)
```

`data/<page>.mjs` exports named values that become that page's template
locals. It's `.mjs` rather than `.js` because there's no `package.json` here
to tell Node these are ES modules.
