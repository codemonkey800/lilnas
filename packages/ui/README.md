# @lilnas/ui

The lilnas design system as a component library: the Tailwind theme
(`theme.css`) plus React components built on
[Base UI](https://base-ui.com). The design itself lives in `DESIGN.md` and
`docs/designs/`; `components.md` there is the API this package implements.

## Components

One folder per component under `src/`, exported from `src/index.ts`. The API for
each is specified in `docs/designs/components.md`; the live render of every
variant and state is `docs/features/design-system/designs/index.html`.

| Component                                                | What it is                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| `Doorplate`                                              | Pepe badge plus the subdomain in mono; identical in every app.   |
| `AppBar`                                                 | Top bar: doorplate, nav, search and avatar; nav becomes a sheet. |
| `Button`, `buttonClassName`                              | `accent`, `outline`, `ghost` and `bad` buttons in three sizes.   |
| `Badge`                                                  | Round tinted status label with a leading dot.                    |
| `StatusDot`                                              | Status colour dot, optionally pulsing.                           |
| `Card`, `Panel`, `PanelHead`, `Tile`                     | Surfaces; a card that links is a `Tile`.                         |
| `EmptyState`                                             | Mark, one line and one action for an empty view.                 |
| `Icon`, `ICON_NAMES`                                     | Inline SVG icon set sized by `currentColor`.                     |
| `PepeBadge`, `PepeFull`                                  | The two cuts of the brand mark.                                  |
| `Density`                                                | Wrapper that sets `comfortable` or `compact` for its subtree.    |
| `Input`, `Textarea`, `Field`, `Search`, `useFieldId`     | Text entry and the labelled-field wrapper.                       |
| `Checkbox`, `Radio`, `RadioGroup`, `Switch`, `Segmented` | Choice controls.                                                 |
| `Slider`                                                 | Range input.                                                     |
| `Select`, `Menu`, `Combobox`                             | Popup pickers: value select, action menu, searchable select.     |
| `Dialog`, `ConfirmDialog`                                | Modal dialog and the confirm-step variant.                       |
| `Sheet`                                                  | Edge-anchored panel (bottom or side drawer).                     |
| `Tabs`                                                   | Tab list and panels.                                             |
| `Toast`: `ToastProvider`, `useToast`                     | Transient confirmation messages.                                 |
| `Note`                                                   | Inline message block with a tone.                                |
| `Spinner`, `Skeleton`, `Progress`, `Meter`               | Loading and quantity feedback.                                   |
| `Table`, `DataList`                                      | Dense tables and the list that stands in for them on phones.     |
| `Avatar`, `AvatarStack`                                  | Person marks.                                                    |
| `Tooltip`                                                | Hover and focus hint.                                            |
| `Breadcrumb`, `Pagination`, `Kbd`                        | Navigation helpers and key caps.                                 |
| `LogViewer`, `LogLineRow`                                | Virtual-scrolling log pane for emitted lines.                    |

### Adding a component

1. **Spec it first** in `docs/designs/components.md`: anatomy, variants,
   states and the classNames that produce them.
2. **Add the kit mixin** so it shows up in the live reference: one mixin in
   `docs/designs/mockup-kit/ui.pug`, shown on
   `docs/features/design-system/designs/src/pages/index.pug`, then
   `pnpm mockups` to rebuild the committed HTML.
3. **Then write the code**: a `src/<name>/` folder with the component and an
   `index.ts`, an export line in `src/index.ts`, and a spec under
   `src/__tests__/` covering each variant, state and interaction.

Code that arrives before its spec drifts from the design; the spec and the
mixin are what the next app is built against.

## Using it from an app

Add two lines to the app's stylesheet. The `@source` path is relative to that
stylesheet — Tailwind ignores `node_modules`, so without it the class names
inside the components never get generated. Workspace packages are injected, so
`@lilnas/ui` lives in the app's own `node_modules`
(`apps/<app>/node_modules/@lilnas/ui`), not the repo root's. The path below is
for a stylesheet at `apps/<app>/src/`; adjust the number of `../` to the
stylesheet's depth (`src/styles/globals.css` needs `../../node_modules/…`):

```css
@import '@lilnas/ui/theme.css';
@source '../node_modules/@lilnas/ui/dist';
```

Fonts are loaded by the app with `next/font/google` and mapped in with
`@theme inline` (see foundations.md, "Fonts"):

```ts
import { Geist, Geist_Mono } from 'next/font/google'

const sans = Geist({ subsets: ['latin'], variable: '--font-geist' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
```

```css
@theme inline {
  --font-sans: var(--font-geist), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}
```

### Jest

Map the package to its source so specs don't need a build, next to the existing
`@lilnas/utils` mapping:

```js
moduleNameMapper: {
  '^@lilnas/ui$': '<rootDir>/../../packages/ui/src/index.ts',
}
```

## Developing

Components that use hooks or event handlers start with `'use client'`; `tsc`
preserves the directive.

Workspace packages are injected copies, so run
`pnpm --filter @lilnas/ui build` after editing — the build resyncs every app's
copy. Do this before an app's type-check, jest run or `next build`.

```bash
pnpm --filter @lilnas/ui build
pnpm --filter @lilnas/ui lint
pnpm --filter @lilnas/ui type-check
pnpm --filter @lilnas/ui test
```
