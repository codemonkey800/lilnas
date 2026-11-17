# Foundations

Colour, type, space, shape, elevation. Every token, why it has that value, and
the block you paste into an app to get them.

Read [`../../DESIGN.md`](../../DESIGN.md) first for the rules these serve.

---

## Colour

### Tinted neutrals, written as hex

Every neutral carries a small violet cast (the same hue as the accent, at very low saturation), so
the page reads as part of one palette with the accent instead of a grey UI with
a purple button glued on. Values are plain sRGB hex: the palette is chosen by
eye and verified by contrast ratio, and hex needs no browser-support caveat in
Vite, Next or an email.

### Surfaces

Stacked by **lightness**, never by shadow.

| Token       | Value     | Use                                                                    |
| ----------- | --------- | ---------------------------------------------------------------------- |
| `bg-sunk`   | `#09080e` | Inset wells: input fields, log panes, code blocks                      |
| `bg`        | `#0e0c14` | The page. `<body>`                                                     |
| `surface`   | `#181520` | Cards, panels, the default raised thing                                |
| `surface-2` | `#211d2c` | Raised on a card: hovered rows, secondary buttons, selected menu items |
| `surface-3` | `#2b2638` | Rare. Toasts, tooltips, the top of a stack of three                    |

> Three surface levels is the budget. If a screen needs a fourth, the layout is
> wrong — split it or use a border.

### Lines

| Token          | Value     | Use                                                                          |
| -------------- | --------- | ---------------------------------------------------------------------------- |
| `line-soft`    | `#231f2f` | Internal dividers, table row separators, hairlines inside a card             |
| `line`         | `#2e2a3c` | The default border. Cards, panels, buttons, tabs rule                        |
| `line-loud`    | `#4a4460` | Floating things (menu, dialog, toast) and emphasised borders                 |
| `line-control` | `#6f688a` | Boundaries of inputs, checkboxes, radios and switches. 3:1+ against surfaces |

`line` and `line-soft` are decorative: the content is understandable without
them. A control boundary is not decorative — WCAG 1.4.11 needs 3:1 — so
controls get their own token.

### Text

| Token   | Value     | On `bg` | On `surface` | Use                                                         |
| ------- | --------- | ------- | ------------ | ----------------------------------------------------------- |
| `ink`   | `#ebe8f2` | 16.1:1  | 14.9:1       | Headings, primary body, values                              |
| `ink-2` | `#c4bfd3` | 10.9:1  | 10.1:1       | Secondary body, long-form paragraphs, field labels          |
| `ink-3` | `#a29cb4` | 7.4:1   | 6.8:1        | Captions, hints, placeholders, inactive tabs, metadata      |
| `ink-4` | `#736d88` | 4.0:1   | —            | Disabled controls and decoration only. **Never a sentence** |

`ink-4` is below AA for body text by design. It exists so disabled things look
disabled. Anything a person has to read is `ink-3` or above.

### The accent

| Token          | Value                     | Use                                                         |
| -------------- | ------------------------- | ----------------------------------------------------------- |
| `accent`       | `#9b7bf5`                 | Primary buttons, active tab underline, progress fill, focus |
| `accent-hi`    | `#ae92f8`                 | Hover on the accent, and accent-coloured text and links     |
| `accent-press` | `#8a67ee`                 | Active / pressed on the accent                              |
| `accent-dim`   | `#5a4a96`                 | Hovered borders on quiet things, disabled accent            |
| `accent-ghost` | `rgb(155 123 245 / 0.16)` | Tinted fills: badge backgrounds, selected rows, focus halo  |
| `accent-ink`   | `#120a2a`                 | **Text and icons sitting on `accent`**                      |

Measured: `accent-ink` on `accent` is **5.9:1** (7.5:1 on `accent-hi`, 4.8:1 on
`accent-press`). `accent` as text is 6.1:1 on `bg` and 5.6:1 on `surface`;
`accent-hi` is 7.6:1 and 7.1:1.

#### On `accent-ink`

This is the choice most likely to get "corrected" later, so: white on `#9b7bf5`
is roughly 3:1 and fails AA for normal text. Dark ink passes comfortably and
looks flatter and more deliberate than white-on-violet, which is the default
look of every dark SaaS dashboard. Take it.

### Status

The **only** non-violet hues in the system.

| Token  | Value     | On `surface` | Means                                             |
| ------ | --------- | ------------ | ------------------------------------------------- |
| `ok`   | `#3fb27f` | 6.8:1        | Running, live, succeeded, granted, connected      |
| `warn` | `#e0a43a` | 8.2:1        | Degraded, pending, queued, stale, needs attention |
| `bad`  | `#ef5b5b` | 5.4:1        | Failed, error, blocked, destructive action        |

Each has a `-ghost` at 14% alpha for badge and note fills. Badge text in the
status colour on its own ghost fill measures 5.5:1 (`ok`), 6.4:1 (`warn`) and
4.6:1 (`bad`) — all above AA.

They are deliberately few and loud. On a page where everything else is violet or
violet-grey, a single amber badge is impossible to miss. Adding a fourth hue
destroys that. Info is the accent. Decoration is nothing.

### What never appears

- Tailwind's `gray-*`, `zinc-*`, `slate-*`, `neutral-*`, or any `blue-*`. There
  is no grey and no blue.
- Gradients on surfaces. The one exception is the skeleton shimmer.
- Any hue outside violet, green, amber and red.
- `#fff` or `#000` as fills. Use `ink` and `bg-sunk`.

---

## Type

Two families, both free (SIL OFL), both variable, both on Google Fonts and
`next/font/google`.

| Role      | Family     | Weights       | Loaded when |
| --------- | ---------- | ------------- | ----------- |
| Body / UI | Geist      | 400, 500, 600 | Always      |
| Machine   | Geist Mono | 400, 500      | Always      |

There is no display face. Page titles are Geist 600 at a larger size. A system
with no gimmicks relies on spacing and weight for hierarchy.

### Why Geist

It is the current default of the category (clean, tall x-height, neutral
terminals) and has a matching mono, which keeps the two voices visually related
so that a hostname inside a sentence doesn't look pasted in. It supports
tabular figures, which the whole system relies on.

### Scale

| Class     | Size / line-height | Weight | Tracking           | Use                                         |
| --------- | ------------------ | ------ | ------------------ | ------------------------------------------- |
| `h1`      | 24px / 32px        | 600    | `-0.02em`          | Page title                                  |
| `h2`      | 18px / 26px        | 600    | `-0.01em`          | Section heading                             |
| `h3`      | 15px / 22px        | 600    | —                  | Card title, group heading                   |
| `body`    | 14px / 20px        | 400    | —                  | Default (comfortable)                       |
| `sm`      | 13px / 18px        | 400    | —                  | Secondary body; default in compact mode     |
| `cap`     | 12px / 16px        | 400    | —                  | Captions, hints, metadata                   |
| `label`   | 11px / 16px        | 500    | `0.06em` uppercase | Table headers, eyebrows, field group labels |
| `mono`    | 13px / 20px        | 400    | —                  | Hostnames, IDs, paths, commands             |
| `mono-sm` | 12px / 20px        | 400    | —                  | Log lines, dense machine text               |

`font-variant-numeric: tabular-nums` is set on `body`. Do not opt in per
component; do not opt out except for running prose in a long paragraph.

### The "would someone copy it" test

| String                  | Face       | Why                               |
| ----------------------- | ---------- | --------------------------------- |
| `tdr-code.lilnas.io`    | Geist Mono | A hostname                        |
| `Push day`              | Geist      | The user typed it                 |
| `185 lb × 8`            | Geist      | A value, not an identifier        |
| `Beat the last one.`    | Geist      | The interface talking             |
| `09:14:31`              | Geist      | A time; tabular figures align it  |
| `ETIMEDOUT`             | Geist Mono | An error code someone will search |
| `Radarr didn't answer.` | Geist      | An error _explanation_            |
| `/storage/media/movies` | Geist Mono | A path                            |

An error is usually both: the code in mono, the explanation in sans, in that
order.

---

## Space

4px base. Use Tailwind's default scale — do not invent a spacing token set.

| Context                    | Comfortable                   | Compact  |
| -------------------------- | ----------------------------- | -------- |
| Inside a badge             | `0 8px`                       | `0 8px`  |
| Inside a button            | `0 14px`                      | `0 11px` |
| Inside a card              | `16px`                        | `12px`   |
| Between related items      | `8px`                         | `6px`    |
| Between groups in a column | `16px`                        | `12px`   |
| Between sections           | `32px`                        | `24px`   |
| Page gutter                | `16px` mobile, `32px` desktop | same     |

| Width                   | Value        |
| ----------------------- | ------------ |
| Content column          | `1080px` max |
| Reading column          | `62ch` max   |
| Dense / table app       | `1280px` max |
| Dialog                  | `440px`      |
| Auth-style centred card | `380px`      |
| App sidebar             | `232px`      |

---

## Shape

Radius encodes what a thing _is_:

| Token          | Value | Applies to                                                        |
| -------------- | ----- | ----------------------------------------------------------------- |
| `radius-xs`    | 4px   | Nested small things: log rows, skeleton bars, inline code, kbd    |
| `radius-md`    | 6px   | **Controls.** Buttons, inputs, selects, menu items, tiles' icons  |
| `radius-lg`    | 8px   | **Containers.** Cards, panels, menus, dialogs, toasts, tables     |
| `radius-xl`    | 12px  | Sheets, full-bleed app frames                                     |
| `rounded-full` | —     | **Labels.** Badges, avatars, status dots, the doorplate, progress |

**Round means label, rectangular means control.** A pill you can't click is a
badge; a pill you can click is a mistake — with one deliberate exception, the
doorplate, which is a label that happens to link home.

---

## Elevation

The system is flat. Elevation is communicated by **lightness step + border**, in
that order:

| Level              | Background  | Border      | Shadow        |
| ------------------ | ----------- | ----------- | ------------- |
| 0 — page           | `bg`        | —           | none          |
| 1 — card           | `surface`   | `line`      | none          |
| 2 — raised on card | `surface-2` | `line`      | none          |
| 3 — floating       | `surface`   | `line-loud` | `shadow-lift` |

`--shadow-lift: 0 12px 32px -8px rgb(0 0 0 / 0.55)` — one shadow, for menus,
dialogs, drawers, tooltips and toasts. A card never has a shadow. A hovered card
never gains one.

---

## The `@theme` block

Tailwind is `4.1.14`, hoisted at the repo root, with `@tailwindcss/postcss`.
Config is CSS-first — there is no theme in `tailwind.config.ts`.

This lives in `@lilnas/ui/theme.css` and every app imports it. Reproduced here so
the doc is self-contained.

```css
@import 'tailwindcss';

@theme {
  /* ── surfaces ─────────────────────────────────────────────────────── */
  --color-bg-sunk: #09080e;
  --color-bg: #0e0c14;
  --color-surface: #181520;
  --color-surface-2: #211d2c;
  --color-surface-3: #2b2638;

  /* ── lines ────────────────────────────────────────────────────────── */
  --color-line-soft: #231f2f;
  --color-line: #2e2a3c;
  --color-line-loud: #4a4460;
  --color-line-control: #6f688a;

  /* ── text ─────────────────────────────────────────────────────────── */
  --color-ink: #ebe8f2;
  --color-ink-2: #c4bfd3;
  --color-ink-3: #a29cb4;
  --color-ink-4: #736d88;

  /* ── accent ───────────────────────────────────────────────────────── */
  --color-accent: #9b7bf5;
  --color-accent-hi: #ae92f8;
  --color-accent-press: #8a67ee;
  --color-accent-dim: #5a4a96;
  --color-accent-ghost: rgb(155 123 245 / 0.16);
  --color-accent-ink: #120a2a;

  /* ── status ───────────────────────────────────────────────────────── */
  --color-ok: #3fb27f;
  --color-ok-ghost: rgb(63 178 127 / 0.14);
  --color-warn: #e0a43a;
  --color-warn-ghost: rgb(224 164 58 / 0.14);
  --color-bad: #ef5b5b;
  --color-bad-ghost: rgb(239 91 91 / 0.14);

  /* ── type ─────────────────────────────────────────────────────────── */
  --font-sans: 'Geist', system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  /* ── shape ────────────────────────────────────────────────────────── */
  --radius-xs: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* ── elevation — the only shadow ──────────────────────────────────── */
  --shadow-lift: 0 12px 32px -8px rgb(0 0 0 / 0.55);

  /* ── motion ───────────────────────────────────────────────────────── */
  --ease-standard: cubic-bezier(0.32, 0.72, 0, 1);
  --ease-spring: linear(
    0,
    0.006,
    0.025 2.8%,
    0.101 6.1%,
    0.539 18.9%,
    0.721 25.3%,
    0.849 31.5%,
    0.937 38.1%,
    0.968 41.8%,
    0.991 45.7%,
    1.006 50.1%,
    1.015 60%,
    1.006 76.2%,
    1
  );

  --animate-rise: rise 380ms var(--ease-standard) both;
  --animate-breathe: breathe 2.4s var(--ease-standard) infinite;
  --animate-shimmer: shimmer 1.5s linear infinite;

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes breathe {
    0% {
      transform: scale(0.7);
      opacity: 0.9;
    }
    70% {
      transform: scale(2.1);
      opacity: 0;
    }
    100% {
      opacity: 0;
    }
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
}

/* ── base ───────────────────────────────────────────────────────────── */
@layer base {
  html {
    scrollbar-gutter: stable;
  }
  body {
    background: var(--color-bg);
    color: var(--color-ink);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 20px;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
  }
  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

That gives you `bg-surface`, `text-ink-3`, `border-line`, `rounded-md`,
`ease-standard`, `animate-rise`, `font-mono` and so on as ordinary utilities.

### Wiring it into an app

```css
/* apps/<app>/src/tailwind.css */
@import '@lilnas/ui/theme.css';
@source '../node_modules/@lilnas/ui/dist';
```

The `@source` line is required: Tailwind ignores `node_modules` by default, so
without it the classNames inside `@lilnas/ui` components never get generated.
Path is relative to the stylesheet, and it targets the app's own
`node_modules` (`apps/<app>/node_modules/@lilnas/ui`): workspace packages are
injected per app, so the repo-root `node_modules` has no `@lilnas/ui`. The line
above is for a stylesheet at `apps/<app>/src/`; a deeper one needs more `../`
(e.g. `src/styles/globals.css` → `../../node_modules/@lilnas/ui/dist`).

The apps use exactly these two forms. `portal`, `auth`, `dev` and `download`
keep the stylesheet at `src/tailwind.css` and use the `../node_modules/…` path
above. `tdr-bot` and `tdr-code` keep it at `src/styles/globals.css` and use the
same path with one more `../`.

### Fonts

Next apps load fonts with `next/font/google` and map them in with
`@theme inline`, so the family resolves to Next's generated CSS variable:

```ts
// apps/<app>/src/app/layout.tsx
import { Geist, Geist_Mono } from 'next/font/google'

const sans = Geist({ subsets: ['latin'], variable: '--font-geist' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' })
```

```css
/* after the @theme block */
@theme inline {
  --font-sans: var(--font-geist), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}
```

`@theme inline` (not plain `@theme`) is required when a token references another
CSS variable — otherwise Tailwind pre-resolves it at build time and the
`next/font` variable never gets read.

All six Next apps do this the same way: `Geist` with `variable: '--font-geist'`
and `Geist_Mono` with `variable: '--font-geist-mono'` in `layout.tsx`, mapped to
`--font-sans` and `--font-mono` in an `@theme inline` block in the app's
stylesheet, with the variable classes on `<html>`.

`dashcam` is Vite, not Next — it uses a `<link>` to Google Fonts, or
`@fontsource-variable/geist` and `@fontsource-variable/geist-mono` if offline
builds matter.

---

## The mark

`apps/auth/public/sad-pepe.svg` is the existing brand mark: a detailed 338×309
illustration. It's genuinely good and it stays. But at 24px — exactly the size
the doorplate needs — it goes soft, dark and crowded, because the drawing is
mostly hairline strokes at that scale.

So the mark ships in **two cuts of the same drawing**:

| Cut          | File                                 | Size  | Where                                          |
| ------------ | ------------------------------------ | ----- | ---------------------------------------------- |
| `pepe-full`  | `apps/auth/public/sad-pepe.svg`      | 40px+ | Empty states, hero moments, the login card     |
| `pepe-badge` | `docs/designs/assets/pepe-badge.svg` | ≤32px | Doorplate, avatars, favicon, anywhere in a bar |

### The badge is derived, not redrawn

This matters, because a hand-drawn "simplified Pepe" is just a generic frog —
the character lives in the specific geometry of those droopy lens-shaped eyes
and the wide lip, and any redraw loses it.

`pepe-badge` is generated from `sad-pepe.svg` by four mechanical steps:

1. **Drop the 9 stroke-only paths** (`fill="none"`). These are the contour and
   wrinkle detail. At 338px they're the craft; at 24px they're the mud.
2. **Drop `stroke` / `stroke-width`** from the remaining 15 filled shapes.
3. **Crop the viewBox** from `0 0 338 309` to `96 38 240 240` — a square on the
   face. This roughly doubles the effective scale of the eyes and lips, and
   being square means it doesn't letterbox inside a circular badge.
4. **Add a full-bleed `#5a8d3e` backdrop.** The head silhouette doesn't fill a
   square, so without this the badge shows a dark notch where the mask cuts.

Path data is untouched, so it's the same character, not a lookalike. The recipe
is in a comment at the top of the file — rerun it if `sad-pepe.svg` ever changes.

Legible down to ~20px at 1× and ~16px at 2×. Both cuts are shown in the preview
("The mark") and should move into `@lilnas/ui` as components.

Never shrink `pepe-full` below 40px.
