# Foundations

Colour, type, space, shape, elevation. Every token, why it has that value, and
the block you paste into an app to get them.

Read [`../../DESIGN.md`](../../DESIGN.md) first for the rules these serve.

---

## Colour

### Why OKLCH

The whole system is one hue. That's only workable in a perceptually uniform
space — in HSL, `hsl(300 60% 20%)` and `hsl(300 60% 70%)` are wildly different
_perceived_ saturations, so a single-hue palette drifts and looks accidental. In
OKLCH, lightness and chroma are independent and predictable, so:

- Surface steps are honest. `14%` → `18.5%` → `23%` → `28%` reads as even.
- "Add chroma on hover" is a real, uniform operation at every lightness.
- Contrast ratios are roughly guessable from the L value.

Browser support is universal in every target (Chrome/Edge/Safari/Firefox
current). `apps/auth` already ships OKLCH in production.

### Surfaces

Stacked by **lightness**, never by shadow. Chroma rises with lightness so higher
surfaces read slightly more purple, which is what sells the single-hue idea.

| Token       | Value                    | Use                                                                          |
| ----------- | ------------------------ | ---------------------------------------------------------------------------- |
| `bg-sunk`   | `oklch(11% 0.018 300)`   | Inset wells: input fields, log panes, code blocks, the area _behind_ content |
| `bg`        | `oklch(14% 0.021 300)`   | The page. `<body>`.                                                          |
| `surface`   | `oklch(18.5% 0.027 300)` | Cards, panels, the default raised thing                                      |
| `surface-2` | `oklch(23% 0.032 300)`   | Raised on a card: chips, hovered rows, secondary controls                    |
| `surface-3` | `oklch(28% 0.038 300)`   | Rare. Toasts, tooltips, the top of a stack of three                          |

> Three surface levels is the budget. If a screen needs a fourth, the layout is
> wrong — split it or use a border.

### Lines

Lines do the work shadows would in a non-flat system. Use them liberally.

| Token       | Value                    | Use                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------- |
| `line-soft` | `oklch(23.5% 0.031 300)` | Internal dividers, table row separators, hairlines inside a card |
| `line`      | `oklch(29% 0.038 300)`   | The default border. Cards, inputs, buttons, panels               |
| `line-loud` | `oklch(41% 0.055 300)`   | Floating things (modal, toast) and emphasised borders            |

### Text

| Token   | Value                  | Contrast on `bg` | Use                                                       |
| ------- | ---------------------- | ---------------- | --------------------------------------------------------- |
| `ink`   | `oklch(97% 0.008 300)` | ~16:1            | Headings, primary body, values                            |
| `ink-2` | `oklch(79% 0.020 300)` | ~9:1             | Secondary body, long-form paragraphs, field labels        |
| `ink-3` | `oklch(63% 0.026 300)` | ~5:1             | Captions, hints, inactive tabs, secondary data            |
| `ink-4` | `oklch(50% 0.028 300)` | ~3:1             | Uppercase labels, placeholders, disabled, em-dash empties |

`ink-4` is below AA for body text **by design** — it is only for `≥11px`
uppercase labels with wide tracking, placeholders, and decorative dashes. Never
put a sentence in it.

### The accent

| Token      | Value                        | Use                                                                     |
| ---------- | ---------------------------- | ----------------------------------------------------------------------- |
| `uv`       | `oklch(68% 0.210 300)`       | Primary buttons, active tab underline, progress fill, links, focus ring |
| `uv-hi`    | `oklch(75% 0.195 300)`       | Hover on the accent, and accent-coloured text on a dark fill            |
| `uv-press` | `oklch(62% 0.225 300)`       | Active/pressed on the accent                                            |
| `uv-dim`   | `oklch(42% 0.140 300)`       | Hovered borders on quiet things, disabled accent                        |
| `uv-ghost` | `oklch(68% 0.21 300 / 0.13)` | Tinted fills: chip backgrounds, focus ring, selected rows               |
| `uv-ink`   | `oklch(15% 0.045 300)`       | **Text and icons sitting on `uv`**                                      |

#### On `uv-ink`

This is the one choice most likely to get "corrected" by someone later, so:

White on `oklch(68% 0.21 300)` is roughly **3.0:1** — it fails WCAG AA for
normal text and only scrapes large-text AA. `uv-ink` gives roughly **7:1**.

It also looks better. White-on-violet is soft and glowy — the default look of
every dark SaaS dashboard. Near-black on bright purple is flat, high-contrast
and poster-like, which is what "flat and minimal" actually asks for. The
accessible choice and the distinctive one are the same choice here. Take it.

### Status

The **only** non-300 hues in the system.

| Token  | Value                 | Means                                                   |
| ------ | --------------------- | ------------------------------------------------------- |
| `ok`   | `oklch(76% 0.17 155)` | Running, live, succeeded, granted, connected            |
| `warn` | `oklch(82% 0.15 85)`  | Degraded, pending, rate-limited, stale, needs attention |
| `bad`  | `oklch(66% 0.20 22)`  | Failed, error, blocked, destructive action              |

Each has a `-ghost` at 14% alpha for chip fills.

They are deliberately few and deliberately loud. On a page where everything else
is one wavelength, a single amber dot is impossible to miss — which is the whole
point. Adding a fourth hue "for info" or "for a nice gradient" destroys that
property permanently. Info is `uv`. Decoration is nothing.

### What never appears

- Tailwind's `gray-*`, `zinc-*`, `slate-*`, `neutral-*`. There is no grey.
- Gradients on surfaces. The one exception is the skeleton shimmer.
- Any hue outside `{300, 155, 85, 22}`.
- `#fff` or `#000` as fills. Use `ink` and `bg-sunk`.

---

## Type

Three families, one job each. All three are variable, free (SIL OFL), and on
Google Fonts.

| Role      | Family              | Loaded when                                                                |
| --------- | ------------------- | -------------------------------------------------------------------------- |
| Display   | Bricolage Grotesque | The app has a title ≥24px or a hero number. Skip in `dashcam`, `download`. |
| Body / UI | Figtree             | Always                                                                     |
| Machine   | IBM Plex Mono       | Always                                                                     |

### Why not Inter

Inter is the correct answer to "what's the safest UI sans," which is exactly why
every dark-purple dashboard uses it. Figtree is just as legible at UI sizes with
more open apertures and softer terminals — it reads _friendly_, which is in the
brief, without being a rounded novelty face.

Bricolage Grotesque is the risk in the type system. Set condensed
(`wdth 87`) it has genuine character — slightly compressed, quirky details, more
"name painted on a machine-room door" than "startup wordmark." It's used at
display sizes only, where that character is legible and welcome.

### Scale

| Class       | Size                       | Weight | Tracking           | Family              | Use                                         |
| ----------- | -------------------------- | ------ | ------------------ | ------------------- | ------------------------------------------- |
| `display`   | `clamp(32px, 5.2vw, 50px)` | 650    | `-0.02em`          | Bricolage `wdth 87` | Page hero. One per screen.                  |
| `display-2` | 30px                       | 650    | `-0.015em`         | Bricolage `wdth 87` | Section hero, in-app page title             |
| `h1`        | 23px                       | 650    | `-0.015em`         | Figtree             | Page title in a dense app                   |
| `h2`        | 18px                       | 620    | `-0.01em`          | Figtree             | Section heading                             |
| `h3`        | 15.5px                     | 600    | —                  | Figtree             | Card title, group heading                   |
| `body`      | 15px / 1.6                 | 400    | —                  | Figtree             | Default                                     |
| `sm`        | 13.5px / 1.55              | 400    | —                  | Figtree             | Secondary body, dense UI                    |
| `cap`       | 12px / 1.5                 | 400    | —                  | Figtree             | Captions, hints                             |
| `mono`      | 13px                       | 450    | `-0.01em`          | Plex Mono           | Identity, data, paths                       |
| `mono-sm`   | 11.5px                     | 450    | —                  | Plex Mono           | Log lines, table data, dense machine text   |
| `label`     | 10.5px                     | 500    | `0.11em` uppercase | Plex Mono           | Eyebrows, table headers, field group labels |

Anything showing a number that changes — timers, counters, weights, percentages,
prices — also gets `font-variant-numeric: tabular-nums`, or it will jitter.

### The machine/human test

Apply the rule from `DESIGN.md` mechanically:

| String                  | Voice   | Why                      |
| ----------------------- | ------- | ------------------------ |
| `swole.lilnas.io`       | machine | A hostname               |
| `Push day`              | human   | The user typed it        |
| `185 lb × 8`            | machine | Emitted from a record    |
| `Beat the last one.`    | human   | The interface talking    |
| `09:14:31`              | machine | A timestamp              |
| `just now`              | machine | Derived from a timestamp |
| `ETIMEDOUT`             | machine | An error code            |
| `Radarr didn't answer.` | human   | An error _explanation_   |
| `PERSON` (table header) | machine | A field name             |
| `No routines yet`       | human   | The interface talking    |

Note rows 8 and 9: an error is usually **both**. The code is mono, the
explanation is sans, in that order.

---

## Space

4px base. Use Tailwind's default scale — do not invent a spacing token set.

| Context                    | Value                                     |
| -------------------------- | ----------------------------------------- |
| Inside a chip              | `0 10px`                                  |
| Inside a button            | `0 15px` (`0 11px` small, `0 22px` large) |
| Inside a card              | `20px`                                    |
| Between related items      | `8–10px`                                  |
| Between groups in a column | `14–18px`                                 |
| Between sections           | `28–40px`                                 |
| Page gutter                | `24px` mobile, `32px` desktop             |

| Width                   | Value        |
| ----------------------- | ------------ |
| Content column          | `1080px` max |
| Reading column          | `62ch` max   |
| Dense/table app         | `1120px` max |
| Modal                   | `440px`      |
| Auth-style centred card | `380px`      |

---

## Shape

Radius encodes what a thing _is_:

| Token          | Value | Applies to                                                                    |
| -------------- | ----- | ----------------------------------------------------------------------------- |
| `radius-xs`    | 6px   | Nested small things: log rows, skeleton bars, inline code                     |
| `radius-md`    | 10px  | **Controls.** Buttons, inputs, selects, tiles                                 |
| `radius-lg`    | 14px  | **Containers.** Cards, panels, modals, sheets                                 |
| `radius-xl`    | 20px  | Full-bleed app frames, the outermost shell                                    |
| `rounded-full` | —     | **Labels.** Chips, badges, avatars, status dots, the doorplate, progress bars |

**Round means label, rectangular means control.** A pill you can't click is a
chip; a pill you can click is a mistake — with one deliberate exception, the
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
| 3 — floating       | `surface-3` | `line-loud` | `shadow-lift` |

`--shadow-lift: 0 16px 40px -12px oklch(6% 0.02 300 / 0.7)` — one shadow, tinted
purple like everything else, and only for modals, drawers, popovers, tooltips
and toasts. A card never has a shadow. A hovered card never gains one.

---

## The `@theme` block

Tailwind is `4.1.14`, hoisted at the repo root, with `@tailwindcss/postcss`.
Config is CSS-first — there is no theme in `tailwind.config.ts` any more.

This lives in `@lilnas/ui/theme.css` and every app imports it. Reproduced here so
the doc is self-contained.

```css
@import "tailwindcss";

@theme {
  /* ── surfaces ─────────────────────────────────────────────────────── */
  --color-bg: oklch(14% 0.021 300);
  --color-bg-sunk: oklch(11% 0.018 300);
  --color-surface: oklch(18.5% 0.027 300);
  --color-surface-2: oklch(23% 0.032 300);
  --color-surface-3: oklch(28% 0.038 300);

  /* ── lines ────────────────────────────────────────────────────────── */
  --color-line: oklch(29% 0.038 300);
  --color-line-soft: oklch(23.5% 0.031 300);
  --color-line-loud: oklch(41% 0.055 300);

  /* ── text ─────────────────────────────────────────────────────────── */
  --color-ink: oklch(97% 0.008 300);
  --color-ink-2: oklch(79% 0.02 300);
  --color-ink-3: oklch(63% 0.026 300);
  --color-ink-4: oklch(50% 0.028 300);

  /* ── accent ───────────────────────────────────────────────────────── */
  --color-uv: oklch(68% 0.21 300);
  --color-uv-hi: oklch(75% 0.195 300);
  --color-uv-press: oklch(62% 0.225 300);
  --color-uv-dim: oklch(42% 0.14 300);
  --color-uv-ghost: oklch(68% 0.21 300 / 0.13);
  --color-uv-ink: oklch(15% 0.045 300);

  /* ── status ───────────────────────────────────────────────────────── */
  --color-ok: oklch(76% 0.17 155);
  --color-ok-ghost: oklch(76% 0.17 155 / 0.14);
  --color-warn: oklch(82% 0.15 85);
  --color-warn-ghost: oklch(82% 0.15 85 / 0.14);
  --color-bad: oklch(66% 0.2 22);
  --color-bad-ghost: oklch(66% 0.2 22 / 0.14);

  /* ── type ─────────────────────────────────────────────────────────── */
  --font-display: "Bricolage Grotesque", system-ui, sans-serif;
  --font-sans: "Figtree", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  /* ── shape ────────────────────────────────────────────────────────── */
  --radius-xs: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* ── elevation — the only shadow ──────────────────────────────────── */
  --shadow-lift: 0 16px 40px -12px oklch(6% 0.02 300 / 0.7);

  /* ── motion ───────────────────────────────────────────────────────── */
  --ease-uv: cubic-bezier(0.32, 0.72, 0, 1);
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

  --animate-rise: rise 380ms var(--ease-uv) both;
  --animate-breathe: breathe 2.4s var(--ease-uv) infinite;
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
    -webkit-font-smoothing: antialiased;
  }
  :focus-visible {
    outline: 2px solid var(--color-uv);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
  }
  .font-display {
    font-variation-settings: "wdth" 87;
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
`ease-uv`, `animate-rise`, `font-mono` and so on as ordinary utilities.

### Wiring it into an app

```css
/* apps/<app>/src/tailwind.css */
@import "@lilnas/ui/theme.css";
@source '../../../node_modules/@lilnas/ui/dist';
```

The `@source` line is required: Tailwind ignores `node_modules` by default, so
without it the classNames inside `@lilnas/ui` components never get generated.
Path is relative to the stylesheet.

### Fonts

Next apps load fonts with `next/font/google` and map them in with
`@theme inline`, so the family resolves to Next's generated CSS variable:

```ts
// apps/<app>/src/app/layout.tsx
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from "next/font/google";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  axes: ["opsz", "wdth"],
});
const sans = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});
```

```css
/* after the @theme block */
@theme inline {
  --font-display: var(--font-bricolage), system-ui, sans-serif;
  --font-sans: var(--font-figtree), system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, monospace;
}
```

`@theme inline` (not plain `@theme`) is required when a token references another
CSS variable — otherwise Tailwind pre-resolves it at build time and the
`next/font` variable never gets read.

`dashcam` is Vite, not Next — it uses a `<link>` to Google Fonts, or
`@fontsource-variable/*` if offline builds matter.

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

Legible down to ~20px at 1× and ~16px at 2×. Both cuts are in the preview as
`<symbol>` definitions and should move into `@lilnas/ui` as components.

Never shrink `pepe-full` below 40px — the preview has the side-by-side.
