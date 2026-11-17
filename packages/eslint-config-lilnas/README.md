# Shared ESLint Config

Shared ESLint configuration file for the monorepo. Exports the following configurations:

- `base`: All projects
- `react`: React projects
- `designSystem`: design-system guard for apps (add after `base` and `react`)

## `designSystem`

```js
const { base, designSystem, react } = require('@lilnas/eslint')

module.exports = [...base, ...react, ...designSystem]
```

Enables `lilnas-design/no-raw-palette` as an error. It reports any string
literal, template literal or JSX `className` that contains

- a Tailwind utility on a raw palette:
  `(bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|divide|shadow)-<palette>-<shade>`
  where `<palette>` is `gray`, `zinc`, `slate`, `neutral`, `stone`, `blue`,
  `sky`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, `red`,
  `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal` or `cyan`, and
  `<shade>` is two or three digits (a variant such as `hover:` or an opacity
  suffix does not hide it);
- a retired `uv-*` / `ease-uv` name (`bg-uv-hi`, `ease-uv`, `--color-uv`).

Use a token from `@lilnas/ui/theme.css` instead (`bg-surface`, `text-ink-2`,
`border-line`, `text-accent-hi`, `text-bad`; see `DESIGN.md`). Comments and
hex values in inline `style` objects (e.g. `tdr-code`'s `global-error.tsx`) are
not utilities and are not reported.

Do not add the fragment to `packages/ui`: the only place a palette value may
live is `theme.css`, which ESLint does not read. Rule tests: `pnpm --filter
@lilnas/eslint test`.
