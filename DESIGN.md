# lilnas design system

The design system for every app at `*.lilnas.io`.

> **See it first:** open `docs/designs/preview/index.html` in a browser. It is a
> single self-contained file that renders every component in the system. Read
> this doc after.

**Direction: Category Standard.** Chosen on 2026-10-23 from six dark-purple
candidates (five sketches plus the earlier "Ultraviolet" system, now retired).
The comparison pages live in `.impeccable/mocks/components/`. This replaces
Ultraviolet everywhere; the token names that carried over are listed in
[`docs/designs/adoption.md`](docs/designs/adoption.md).

---

## The thesis

lilnas isn't a product suite. It's a house with rooms — a front door (`auth`), a
hallway (`portal`), a cinema (`theater`), a workshop (`tdr-code`), a mail slot
(`download`), a garage (`dashcam`). The apps have nothing in common
functionally and never will.

The system's only job is to make moving between them feel like walking through a
doorway instead of launching a different product.

**Quiet, conventional, and consistent.** The category standard is the look of
good modern dev tools: dark surfaces, hairline borders, 6–8px corners, soft
tinted status pills, one accent. It has no gimmick. That is the point: eight
unrelated apps read as one place when none of them is trying to be memorable on
its own, and the one memorable thing (the doorplate) is identical in all of them.

**Purple is the only colour that isn't a status.** Every neutral is tinted
slightly toward violet, the accent is violet, and nothing else on screen is
allowed to be a hue unless it is telling you how something is going.

---

## The four rules

### 1. Colour — one accent, tinted neutrals, status means status

| Colour          | Means                                                        |
| --------------- | ------------------------------------------------------------ |
| Accent (violet) | The primary action, the active thing, links, focus, progress |
| Green `ok`      | Running, live, succeeded, granted, connected                 |
| Amber `warn`    | Degraded, pending, queued, stale, needs attention            |
| Red `bad`       | Failed, error, blocked, destructive                          |
| Everything else | Violet-tinted greys. There is no neutral grey and no blue.   |

Any hue that isn't violet is news. Never introduce a fourth hue "for variety" or
"for info" — info is the accent, decoration is nothing.

**Dark ink on the accent, never white.** White on the accent is about 3:1 and
fails WCAG AA; `accent-ink` gives 5.9:1.

### 2. Type — Geist for people, Geist Mono for identifiers

One family does nearly everything. Geist Mono is reserved for strings a process
emitted that you might copy: hostnames, IDs, paths, keys, commands and log
lines. Numbers are never mono by default — they are Geist with
`font-variant-numeric: tabular-nums`, which is on for the whole body so columns
and counters never jitter.

When you can't decide, ask: **would someone copy-paste this?** `download.lilnas.io`
yes; `64% · 12.1 MB/s` no.

### 3. Shape and elevation — hairlines, not shadows

Radius encodes what a thing is: **6px controls** (buttons, inputs), **8px
containers** (cards, panels, menus, dialogs), **full round for labels** (badges,
avatars, dots, the doorplate). Surfaces stack by lightness plus a 1px border.
One shadow exists, for things that genuinely float: menus, dialogs, drawers,
tooltips and toasts.

### 4. Motion — springs for you, eases for the machine

Things you cause (press, toggle, drag) use a short spring. Things the system
causes (data arrived, route changed, toast appeared) use one soft ease-out. There
is one entry motion in the whole system — fade up 6px — and "lots of animation"
comes from staggering it, never from inventing new gestures. Details in
[`docs/designs/motion.md`](docs/designs/motion.md).

---

## Density follows the job

Two modes, same tokens:

| Mode                  | Used by                         | Control height | Body text |
| --------------------- | ------------------------------- | -------------- | --------- |
| Comfortable (default) | `download`, `portal`, `dashcam` | 36px           | 14px      |
| Compact               | `dev`, `tdr-code`, admin tables | 30px           | 13px      |

On touch screens every tappable thing is at least 44px tall regardless of mode.
Phone and desktop are equals: a layout that only works at one width is
unfinished.

---

## The signature

**The doorplate.** Every app announces its room in the top-left with the pepe
badge and its subdomain in mono:

```
( 🐸 ) swole.lilnas.io
```

It is identical in every app — same size, position, radius and type. It's the
only element that never varies, and that sameness is what turns eight tabs into
one building.

**The live dot.** 8px, accent or `ok`, with a slow 2.4s expanding ring. Anything
alive anywhere in the system wears it: a running session, an active download, a
workout in progress. Problems never pulse.

---

## Where delight lives

Category Standard is deliberately restrained, so spend delight in four places
and nowhere else:

1. **Empty states** — the only place the mascot appears in normal UI, with one
   line in the interface's voice and exactly one thing to press.
2. **Completion** — a download landing, access being granted. These earn a real
   moment.
3. **Micro-feedback** — every press springs.
4. **Writing** — see [`docs/designs/voice.md`](docs/designs/voice.md). Most of
   "friendly" is not being weird at people.

**One delight per screen, maximum.**

---

## Quick reference

```css
/* surfaces — stack by lightness, never by shadow */
--color-bg-sunk: #09080e;
--color-bg: #0e0c14;
--color-surface: #181520;
--color-surface-2: #211d2c;
--color-surface-3: #2b2638;

/* lines */
--color-line-soft: #231f2f;
--color-line: #2e2a3c;
--color-line-loud: #4a4460; /* floating things */
--color-line-control: #6f688a; /* input and checkbox boundaries, 3:1+ */

/* text */
--color-ink: #ebe8f2;
--color-ink-2: #c4bfd3;
--color-ink-3: #a29cb4;
--color-ink-4: #736d88; /* disabled and decoration only */

/* the accent */
--color-accent: #9b7bf5;
--color-accent-hi: #ae92f8; /* hover, and accent-coloured text */
--color-accent-press: #8a67ee;
--color-accent-ghost: rgb(155 123 245 / 0.16);
--color-accent-ink: #120a2a; /* text ON the accent */

/* status — the only other hues that exist */
--color-ok: #3fb27f;
--color-warn: #e0a43a;
--color-bad: #ef5b5b;
```

### Non-negotiables

- **Dark ink on the accent.** `accent-ink`, not white.
- **Elevation is lightness + a border, not shadow.** The one shadow
  (`--shadow-lift`) is for menus, dialogs, drawers, tooltips and toasts.
- **Control boundaries are visible.** Inputs, checkboxes and switches use
  `line-control` (3:1+). Decorative card borders use `line`.
- **Placeholders are `ink-3`.** `ink-4` is below AA and never carries a word
  someone needs to read.
- **Focus rings are always visible.** 2px `accent`, 2px offset. Never
  `outline: none` without a replacement.
- **`prefers-reduced-motion` is respected everywhere.** Entry animations resolve
  to their end state; loops stop.
- **Round means label, rectangular means control.** Badges, avatars, dots and the
  doorplate are `rounded-full`. Buttons, inputs and cards are not.

---

## The docs

| Doc                                                                  | What's in it                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`docs/designs/preview/index.html`](docs/designs/preview/index.html) | **Start here.** Every component, rendered.                                       |
| [`docs/designs/foundations.md`](docs/designs/foundations.md)         | Colour, type, space, shape, elevation. Tokens, contrast, and the `@theme` block. |
| [`docs/designs/motion.md`](docs/designs/motion.md)                   | Durations, curves, the entry motion, stagger, reduced motion.                    |
| [`docs/designs/components.md`](docs/designs/components.md)           | Anatomy, variants and states for every primitive.                                |
| [`docs/designs/voice.md`](docs/designs/voice.md)                     | How the interface talks. Buttons, errors, empty states.                          |
| [`docs/designs/adoption.md`](docs/designs/adoption.md)               | Current state of every app, the `@lilnas/ui` package, migration order.           |

---

## Status

**Direction agreed; implementation partial.** `apps/download` and `apps/dev`
already ship a local copy of the previous (Ultraviolet) system under the same
token names, so the first step is a values swap, not a rewrite. `@lilnas/ui`
doesn't exist yet. See [`docs/designs/adoption.md`](docs/designs/adoption.md).
