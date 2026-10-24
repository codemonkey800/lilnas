# Adoption

What exists today, what it costs to move each app, and the order to do it in.

---

## Where we are

Eight apps have a UI. They share almost nothing.

> **Status (2026-10-23).** The survey below predates adoption. Since then
> `apps/download` and `apps/dev` have been built on a local copy of the previous
> design system ("Ultraviolet", now retired): their own `@theme` block in
> `src/tailwind.css` and their own `src/components/ui/`. They are the first
> apps to migrate to Category Standard — see
> [Migrating the apps already on Ultraviolet](#migrating-the-apps-already-on-ultraviolet).
> The other rows are unchanged unless noted.

| App        | Stack             | Accent today              | Neutrals        | Notes                                                                         |
| ---------- | ----------------- | ------------------------- | --------------- | ----------------------------------------------------------------------------- |
| `portal`   | Next RSC          | `purple-500`              | `gray-*`        | ~20 lines total. One component.                                               |
| `auth`     | Next + Nest       | blue `oklch(62% .19 255)` | custom oklch    | Semantic CSS classes in `design-tokens.css`. Closest thing to a system today. |
| `tdr-code` | Next + Nest       | `blue-700`                | `gray-*` ladder | Pure Tailwind, no MUI. Largest className surface.                             |
| `download` | Next + Nest + MUI | `purple`                  | `black`         | 10 MUI components.                                                            |
| `tdr-bot`  | Next + Nest + MUI | violet `#7c3aed`          | `#0f0b1a`       | Frontend is a "Hello World" stub.                                             |
| `swole`    | Next + MUI        | `deepOrange`              | `neutral-*`     | 25 MUI components. The real work.                                             |
| `dashcam`  | Vite + React      | `purple-500`              | `gray-*`        | Small, self-contained.                                                        |
| `theater`  | Next + Nest + R3F | white/alpha               | pure black      | On branch `feat/theater-app`, not `main`.                                     |

`equations` and `me-token-tracker` are backend-only — nothing to do.

Encouraging signal: three apps already reach for purple unprompted, and
`tdr-bot` has a violet palette duplicated in both `theme.ts` and
`tailwind.config.ts`. The direction is where the codebase was already heading.

Tailwind is `4.1.14`, hoisted at the root, with `@tailwindcss/postcss`. Every
app already has it, and every app already uses `cns()` from
`@lilnas/utils/cns`. The plumbing is in place.

---

## Step 0 — `packages/ui`

Nothing can start before this exists.

```
packages/ui/
├── package.json          @lilnas/ui, workspace:*
├── theme.css             the @theme block from foundations.md
├── src/
│   ├── index.ts
│   ├── icons/            seeded from apps/auth/src/app/components/icons.tsx
│   ├── doorplate.tsx
│   ├── button.tsx
│   └── …
└── tsconfig.json
```

Apps opt in with two lines:

```css
@import '@lilnas/ui/theme.css';
@source '../../../node_modules/@lilnas/ui/dist';
```

The `@source` line is mandatory — Tailwind skips `node_modules` by default, so
without it none of the library's classNames get generated.

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
- **Headless UI** — too narrow; no combobox good enough for `swole`.

Take Base UI. Build the simple components (button, badge, card, input, table,
progress) directly in Tailwind; use Base UI only where focus management,
keyboard navigation, positioning or ARIA are hard to get right. Copy shadcn's
_structure_ where it helps, but not its visual defaults — the shadcn look is precisely the generic dark-dashboard look this
system exists to avoid.

Build in the tiers from [`components.md`](components.md#build-order). Tier 1
unblocks `portal` and `auth`; tier 3 exists only for `swole`.

---

## Migrating the apps already on Ultraviolet

`apps/download` and `apps/dev` use the previous system's token names. Most of
those names are semantic and carry over; only the values and a handful of names
change, so this is a values swap plus a rename, not a rewrite.

### Measured surface

| Count                                    | `download` | `dev` |
| ---------------------------------------- | ---------- | ----- |
| `uv-*` utility classes                   | 154        | 27    |
| Files containing them                    | 64         | 13    |
| `ease-uv` references                     | 52         | 18    |
| `font-mono` uses to review               | 112        | 50    |
| `<Chip>` usages (become `<Badge>`)       | 44         | 13    |
| Font references (Figtree/Plex/Bricolage) | 12         | 11    |
| `oklch(` literals outside `tailwind.css` | 0          | 0     |

The last row is the good news: neither app has an `oklch()` literal outside its
`tailwind.css`, so colour appears to flow through tokens. (Hex values and
arbitrary-value classes were not counted; check for them in step 3.)

### Token map

| Previous                                                  | Now                                                                               |
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
| `Chip`                                                    | `Badge`                                                                           |
| Figtree / IBM Plex Mono / Bricolage Grotesque             | Geist / Geist Mono; no display face                                               |

### Order of work, per app

1. **Swap the values.** Replace the `@theme` block with the one in
   [`foundations.md`](foundations.md). It includes deprecated `uv-*` and `ease-uv`
   aliases, so nothing else has to change for the app to build and render in the
   new palette. Do this first and look at every screen: it will already be 80% of
   the way there.
2. **Swap the fonts** in `layout.tsx` (`next/font/google`: `Geist`, `Geist_Mono`)
   and delete the Bricolage loader.
3. **Fix what the values swap can't.** Search for these, in this order:
   - `hover:-translate-y-*` and any hover `shadow-*` on cards (hover now steps a
     surface; it does not lift) — 4 hits across both apps today.
   - `placeholder:text-ink-4` → `placeholder:text-ink-3`, and any readable
     sentence set in `ink-4`.
   - Input / checkbox / switch borders → `border-line-control`.
   - `font-mono` on things that are not identifiers: statuses, counts, sizes,
     timestamps, percentages. Those become plain Geist (tabular figures are on
     globally). Keep it on hostnames, IDs, paths, commands and log lines.
   - Lowercase "machine voice" chip text (`running`, `4h ago`) → sentence-case
     `Badge` text (`Running`) where it is a status; keep derived times as plain
     text.
4. **Rename** `uv-*` → `accent-*` and `ease-uv` → `ease-standard` with a single
   `sed` per app, then delete the alias block. Run `pnpm lint`, `type-check` and
   the app's tests.
5. **`Chip` → `Badge`.** The component keeps its API; only the look (borderless,
   leading dot) and the name change.

**Cost (estimate):** about half a day for `dev`; about a day for `download`,
mostly step 3 because of its 112 `font-mono` call sites.

When `@lilnas/ui` exists, these apps delete their local `@theme` block and
`src/components/ui/` copies and import the package instead. Building `@lilnas/ui`
from the components already written in `download` and `dev` (rather than from
scratch) is the cheapest route, and is what the build order in
[`components.md`](components.md) assumes.

---

## Migration order

Ordered so the system gets proven cheaply, the library is built by real use, and
the expensive app goes last against a mature library.

### 1. `portal` — the proof

~20 lines of JSX. It's the hallway everybody passes through, and it exercises
exactly tier 1: `Doorplate`, `Tile`, `Badge`, `StatusDot`, `EmptyState`, plus the
stagger.

If the system doesn't look right here, stop and fix the system before touching
anything else.

**Cost:** an afternoon, most of it building tier 1.

### 2. `auth` — the front door

Mostly a **token swap**, not a rewrite. `design-tokens.css` already has the
right shape: `--bg`, `--surface`, `--fg`, `--muted`, `--border`, `--accent`,
`--radius`, in OKLCH. Repoint those at the Category Standard values (accent
blue → violet `#9b7bf5`) and the whole app moves at once.

Then, incrementally:

- `.btn*`, `.chip*`, `.card`, `.table`, `.toast` → `@lilnas/ui` components.
- Delete the ~15 classes defined in `design-tokens.css` that no TSX ever uses
  (`.btn-dark`, `.eyebrow`, `.small`, `.grow`, `.hr`, `.mono`, `.surface`,
  `.wrap-items`, `.tabs`/`.tab`, `.stat-row`, `.checkbox-row`, `.select`, …).
- Fix the three verbatim copies of
  `btn btn-ghost btn-sm text-red-400 hover:bg-red-950/30 hover:text-red-300` —
  that's a raw Tailwind red bolted onto a token class. It becomes
  `<Button variant="bad" size="sm">`.
- Replace the duplicated desktop-table / mobile-card renderings of the people
  list with one `<DataList>`.
- Swap `Inter` → `Geist` in `layout.tsx` (the one place fonts are wired).
- Keep `pulse-ring` — it's already the live pulse, just retimed to 2.4s.

**Cost:** 1–2 days. High visibility for the effort.

### 3. `download` — the cheapest MUI removal

10 MUI components, 17 JSX instances, 8 files, 2 icons, **zero `sx` props** — all
styling already goes through `className` and `slotProps`.

| MUI                                  | Replacement                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `Tabs` / `Tab` ×2                    | `<Tabs>` (the only one with real behaviour)                                          |
| `TextField` ×4                       | `<Input>` / `<Field>`                                                                |
| `CircularProgress` ×3                | `<Spinner>`                                                                          |
| `LinearProgress`                     | `<Progress>`                                                                         |
| `Chip` ×2                            | `<Badge>` — and the `ts-pattern` status map moves from `!bg-green-700` to tone names |
| `IconButton` ×2                      | `<Button variant="ghost">`                                                           |
| `Paper`, `Checkbox`, `ThemeProvider` | `<Card>`, `<Checkbox>`, delete                                                       |

Also deletes 12 `!` classes, `src/theme.ts`, `@emotion/*` and
`@mui/material-nextjs`.

Keep the giant single-input hero — a `md:text-6xl` heading over one huge field
is a genuinely good, characterful screen. It just needs the new tokens and a
larger Geist 600 in place of a display face.

**Cost:** ~1 day.

### 4. `tdr-bot` — nearly free

Six MUI components across **five `.tsx` files total**, and the frontend renders
`Hello World`. `AppBar` + `Toolbar` + `Box` ×5 + `Typography` ×2 →
`<Doorplate>` + a nav bar + divs.

Removing MUI also deletes the hand-rolled `@emotion/cache` +
`useServerInsertedHTML` SSR shim in `Provider.tsx` (~50 lines).

The `eminence` / `lavender` scales in `tailwind.config.ts` get deleted — they're
a duplicate of `theme.ts` and both are superseded by the accent token.

Do this before building the real admin UI those unused `src/queries/` hooks
imply, not after.

**Cost:** a few hours.

### 5. `tdr-code` — the biggest surface, but mechanical

No MUI at all. This is a find-and-replace of a hardcoded `gray-*` ladder onto
semantic tokens:

| Today                                               | Becomes                     |
| --------------------------------------------------- | --------------------------- |
| `bg-gray-950` (×26 as `gray-900`+)                  | `bg-bg`                     |
| `bg-gray-900`                                       | `bg-surface`                |
| `bg-gray-800` (×40)                                 | `bg-surface-2`              |
| `bg-gray-700` (×22)                                 | `bg-surface-3`              |
| `border-gray-800` (×20)                             | `border-line`               |
| `text-gray-500` (×70) / `-400` (×43) / `-300` (×49) | `text-ink-3` / `-3` / `-2`  |
| `bg-blue-700 text-blue-100`                         | `<Button variant="accent">` |
| `bg-green-900 text-green-300` etc.                  | `<Badge tone="ok">` etc.    |

The app is already philosophically aligned — dense, mono-heavy, `tabular-nums`,
a `tracking-[0.15em] uppercase` wordmark, `StatusDot`, and a dependency-free
drawer. It mostly needs the tokens and the two-voice type rule applied
consistently.

Watch out for `logs/log-viewer.tsx` (1683 lines) and the virtualized list —
`@tanstack/react-virtual` rows and `animate-rise` need care, since animating
recycled rows will flicker. Stagger only genuinely new lines.

**Cost:** 2–3 days, mostly volume.

### 6. `swole` — the real work

25 MUI components, 141 JSX instances, 35 of 54 `.tsx` files, 24 icons.

The headline number overstates it: `Typography` (49) and `Button` (36) are 85 of
the 141 and are `<span>` / `<Button>` swaps. The genuine effort is concentrated:

| Component                    | Count | Difficulty                                                                                                                                                   |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Autocomplete`               | 1     | **Hard.** freeSolo + `groupBy` + custom `renderGroup` with coloured muscle-group dots. This is `<Combobox>` and it should be built properly in `@lilnas/ui`. |
| `Dialog` cluster             | 4     | Medium — four confirm dialogs                                                                                                                                |
| `Drawer` / `SwipeableDrawer` | 3     | Medium — bottom sheets; swipe-to-dismiss needs a gesture lib or dropping                                                                                     |
| `TextField`                  | 13    | Medium — validation, `helperText`, `slotProps`                                                                                                               |
| `Snackbar` + `Alert`         | 2     | Medium — the whole toast system                                                                                                                              |
| Everything else              | ~118  | Trivial                                                                                                                                                      |

**The migration mostly deletes code.** 161 `!`-prefixed Tailwind classes exist
purely to out-specify MUI (`!border-dashed !border-neutral-700 !py-3`,
`!mt-1 !font-bold !text-orange-400`). They all go. So do the 9 remaining `sx`
props, `OUTLINED_INPUT_SX`, and `theme.tsx`.

Three things to handle deliberately:

1. **`MuiButtonBase.defaultProps.LinkComponent`** in `theme.tsx` wires
   `next/link` into `<Button href>` as an RSC-boundary workaround. `@lilnas/ui`
   `<Button>` needs a `render` prop (Base UI's polymorphism mechanism, the
   counterpart of Radix's `asChild`) to replace it.
2. **`RoutineCard.tsx`** has a 300ms exit-animation hack tied to MUI's `Menu`
   close lifecycle. Rebuild it on Base UI's open-change / exit-transition support rather than porting
   the timeout.
3. **`recharts`** in `WeightTrendChart.tsx` is MUI-independent and survives, but
   has hardcoded hex (`stroke="#f97316"`, grid `#262626`). Retoken to the accent and
   `line-soft`. `@dnd-kit` needs no changes at all.

The accent moves orange → purple. That's the biggest visual change of any app,
so screenshot before/after.

**Cost:** 4–6 days, and it's the app that most needs the press-spring and
big-number treatment. Worth doing carefully.

### 7. `dashcam` — whenever

Six small components, no MUI, Vite rather than Next (fonts via `<link>` or
`@fontsource-variable/*`). The `bg-gray-900` lives on `<body>` in `index.html`.

Fix the latent bug while you're there: `VideoGrid` tiles have
`border-purple-300` with no `border-width`, so the border never renders.

**Cost:** half a day.

### 8. `theater` — needs a decision

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
feeling disconnected bothers you. Either way `theater` is on branch
`feat/theater-app` — merge it before doing anything here.

---

## Cross-cutting cleanup

Removing MUI from all three apps deletes:

- `@mui/material`, `@mui/icons-material`, `@mui/material-nextjs`
- `@emotion/react`, `@emotion/styled`, `@emotion/cache`
- 3 × `theme.ts` / `theme.tsx`
- `tdr-bot`'s hand-rolled emotion SSR cache (~50 lines)
- 173 `!`-prefixed Tailwind classes
- 14 `sx` props

Add `@base-ui/react`, and `motion` only where enter/exit on unmount
genuinely needs it.

### Delete the theme block from every `tailwind.config.ts`

Tailwind 4 is CSS-first. `tdr-bot`'s `eminence`/`lavender` scales and
`tdr-code`'s `fontFamily.sans` override both move into `@lilnas/ui/theme.css`
and the configs shrink to just `content`.

### An ESLint guard is worth it

Once two apps have migrated, add a rule banning raw palette utilities
(`bg-gray-*`, `text-neutral-*`, `border-zinc-*`, `bg-violet-*`) outside
`packages/ui`. Otherwise the next feature quietly reintroduces `gray-800` and
the drift starts again. `@lilnas/eslint` already exists to host it.

---

## Rough total

| Phase                                  | Effort                  |
| -------------------------------------- | ----------------------- |
| `@lilnas/ui` tiers 1–2                 | 3–4 days                |
| `portal` + `auth`                      | 2–3 days                |
| `download` + `tdr-bot`                 | 1.5 days                |
| `tdr-code`                             | 2–3 days                |
| `@lilnas/ui` tier 3 (incl. `Combobox`) | 2 days                  |
| `swole`                                | 4–6 days                |
| `dashcam`                              | 0.5 day                 |
| **Total**                              | **~15–20 focused days** |

Nothing here is all-or-nothing. Each app is independently shippable, and
`portal` alone — one afternoon — is enough to tell whether the direction is
right before committing to the rest.
