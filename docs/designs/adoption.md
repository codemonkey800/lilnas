# Adoption

Where the design system stands, what changed for the apps that moved, and what
is left.

---

## Where we are

> **Status (2026-11-17).** Six apps are on Category Standard through `@lilnas/ui`: `portal`, `auth`, `download`, `tdr-bot`,
> `tdr-code` and `dev`. Each imports `@lilnas/ui/theme.css`, loads Geist and
> Geist Mono with `next/font/google`, and takes its primitives from the package.
> No `@mui/*` or `@emotion/*` remains in them, and an ESLint guard stops raw
> palette utilities from coming back. Remaining: `dashcam` and `theater`.

| App        | State                       | Notes                                                                  |
| ---------- | --------------------------- | ---------------------------------------------------------------------- |
| `portal`   | Done                        | Tile grid on `Doorplate`, `Tile`, `StatusDot`, `EmptyState`.           |
| `auth`     | Done                        | Login, people and admin screens on `@lilnas/ui`; Geist replaces Inter. |
| `download` | Done                        | MUI and `src/theme.ts` gone; primitives from `@lilnas/ui`.             |
| `tdr-bot`  | Done                        | MUI, emotion SSR shim and `tailwind.config.ts` gone.                   |
| `tdr-code` | Done                        | `gray-*` ladder replaced by semantic tokens.                           |
| `dev`      | Done                        | Local `ui/` copy deleted; the package replaces it.                     |
| `dashcam`  | Not started                 | Vite + React, `gray-*`. Small and self-contained — see below.          |
| `theater`  | Not started, needs decision | In `apps/theater`. Deliberately a dark cinema.                         |

`equations` and `me-token-tracker` are backend-only — nothing to do.

The library is at [`packages/ui`](../../packages/ui) (see its
[README](../../packages/ui/README.md) for the component index). The live
reference is
[`../features/design-system/designs/index.html`](../features/design-system/designs/index.html).

### What changed, for anyone reading old branches

`download` and `dev` were on the previous system ("Ultraviolet", retired) and
kept a local `@theme` block and `src/components/ui/` copy. The other four apps
were on ad-hoc Tailwind or MUI. All six now share one theme and one component
library. The Ultraviolet token names mostly carried over; only values and a
handful of names changed:

| Previous (Ultraviolet)                                    | Now                                                                               |
| --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `bg`, `bg-sunk`, `surface`, `surface-2`, `-3`             | Same names, new values                                                            |
| `line-soft`, `line`, `line-loud`                          | Same names, new values                                                            |
| —                                                         | `line-control` (new): input / checkbox / switch borders                           |
| `ink`, `ink-2`, `ink-3`                                   | Same names, new values                                                            |
| `ink-4`                                                   | Same name, **narrower job**: disabled and decoration only                         |
| `uv`, `uv-hi`, `uv-press`, `uv-dim`, `uv-ghost`, `uv-ink` | `accent`, `accent-hi`, `accent-press`, `accent-dim`, `accent-ghost`, `accent-ink` |
| `ok`, `warn`, `bad` and their `-ghost`                    | Same names, new values                                                            |
| `ease-uv`                                                 | `ease-standard`                                                                   |
| `radius-xs` / `md` / `lg` / `xl` = 6 / 10 / 14 / 20       | Same names, now 4 / 6 / 8 / 12                                                    |
| `Chip`                                                    | `Badge` (borderless, leading dot, sentence case)                                  |
| Figtree / IBM Plex Mono / Bricolage Grotesque             | Geist / Geist Mono; no display face                                               |

For the other four apps, the old-to-new mapping was:

| App        | Before                                                     | After                                                          |
| ---------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `portal`   | `purple-500` / `gray-*`, one component                     | `Doorplate`, `Tile`, `Badge`, `StatusDot`, `EmptyState`        |
| `auth`     | Blue oklch accent, semantic classes in `design-tokens.css` | Violet accent from `theme.css`; `.btn*`/`.chip*` → components  |
| `tdr-bot`  | MUI + emotion, violet `#7c3aed`, `eminence`/`lavender`     | `@lilnas/ui`; accent token replaces both scales                |
| `tdr-code` | `bg-gray-950…700`, `text-gray-*`, `bg-blue-700`            | `bg-bg` / `surface*`, `text-ink*`, `<Button variant="accent">` |

---

## The library — `packages/ui`

```
packages/ui/
├── package.json          @lilnas/ui, workspace:*
├── theme.css             the @theme block from foundations.md
├── src/
│   ├── index.ts
│   ├── icons/
│   ├── doorplate/
│   ├── button/
│   └── …                 one folder per component, specs in __tests__/
└── tsconfig.json
```

Apps opt in with two lines (the path form each app actually uses is in
[`foundations.md`](foundations.md#wiring-it-into-an-app)):

```css
@import '@lilnas/ui/theme.css';
@source '../node_modules/@lilnas/ui/dist';
```

The `@source` line is mandatory — Tailwind skips `node_modules` by default, so
without it none of the library's classNames get generated. The path is relative
to the stylesheet and lands in the app's own `node_modules` (workspace packages
are injected per app); the line above is for `apps/<app>/src/`, deeper
stylesheets need more `../`.

### Headless layer: Base UI

Decided in `PRODUCT.md`; recommended over the alternatives:

- **Base UI** (`@base-ui/react`) — unstyled and accessible, with the full set
  this system needs (Dialog, Menu, Select, Combobox, Popover, Tabs, Tooltip,
  Switch). It is MUI's own successor, so its structure is the smoothest
  migration path off MUI. It reached 1.x and has shipped a minor release
  roughly monthly since May 2026; pin the version and read release notes on
  upgrade, since minors can still change APIs.
- **Radix** — also mature and accessible, and `tdr-bot` already has a
  `components.json` configured for shadcn (`utils: "@lilnas/utils/cns"`), but
  it is not what MUI users already know and the decision went the other way.
- **Headless UI** — too narrow; its combobox fell short of what the system needs.

Take Base UI. Build the simple components (button, badge, card, input, table,
progress) directly in Tailwind; use Base UI only where focus management,
keyboard navigation, positioning or ARIA are hard to get right. Copy shadcn's
_structure_ where it helps, but not its visual defaults — the shadcn look is precisely the generic dark-dashboard look this
system exists to avoid.

All three tiers from [`components.md`](components.md#build-order) are shipped.

---

## Remaining work

### `dashcam` — whenever

Six small components, no MUI, Vite rather than Next (fonts via `<link>` or
`@fontsource-variable/*`). The `bg-gray-900` lives on `<body>` in `index.html`.

Fix the latent bug while you're there: `VideoGrid` tiles have
`border-purple-300` with no `border-width`, so the border never renders.

**Cost:** half a day.

### `theater` — needs a decision

`theater` is deliberately different: pure black with white-alpha glassmorphism,
Roboto, wide-tracked uppercase eyebrows, HUD chips floating over live WebGL. It
is the most visually considered app in the repo and it looks nothing like the
others _on purpose_ — it's a dark cinema.

Three options:

| Option                                 | What it means                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Doorplate only** _(recommended)_ | Keep the black/white HUD aesthetic. Adopt only the `Doorplate`, the type families, and the voice rules. The room is dark because it's a cinema; that's a legitimate reason to differ. |
| **B — Full adoption**                  | Retint the HUD purple. Risk: purple chrome over projected video competes with the film and hurts the immersion the app is built around.                                               |
| **C — Landing only**                   | Landing + CharacterSelect become the full system; the in-world HUD stays black/white. A clean boundary at the moment you enter the room.                                              |

**A** is the recommendation, with **C** as a good compromise if the login screen
feeling disconnected bothers you.

---

---

## Guard rails

### Done

- **Theme block removed from every `tailwind.config.ts`.** Tailwind 4 is
  CSS-first; `tdr-bot`'s `eminence`/`lavender` scales and `tdr-code`'s
  `fontFamily.sans` override are gone, and the `tailwind.config.ts` files with
  them.
- **MUI and emotion removed** from `download` and `tdr-bot` (`@mui/*`,
  `@emotion/*`, their `theme.ts` files, `!`-prefixed override classes, `sx`
  props, and `tdr-bot`'s hand-rolled emotion SSR cache). No app has them
  any more.
- **ESLint guard against raw palette utilities — done.** The `designSystem`
  flat config in `@lilnas/eslint` (`packages/eslint-config-lilnas/design-system.js`)
  enables the `lilnas-design/no-raw-palette` rule, which reports raw palette
  utilities (`bg-gray-*`, `text-neutral-*`,
  `border-zinc-*`, `bg-violet-*`, …) and the retired `uv-*` / `ease-uv`
  aliases in string literals, template literals and JSX `className`. It is
  enabled in the six migrated apps and does not apply to `packages/ui`. The
  next app to migrate adds it to its `eslint.config.cjs` as
  `[...base, ...react, ...designSystem]`.

---

## Remaining effort

| Work      | Effort                             |
| --------- | ---------------------------------- |
| `dashcam` | 0.5 day                            |
| `theater` | Depends on the option chosen above |
| **Total** | **~0.5 day, plus `theater`**       |

Each app is independently shippable.
