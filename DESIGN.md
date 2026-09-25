# Ultraviolet

The design system for every app at `*.lilnas.io`.

> **See it first:** open `docs/designs/preview/index.html` in a browser. It is a
> single self-contained file that renders the whole system — palette, type,
> components, motion, and three apps mocked up in it. Read this doc after.

---

## The thesis

lilnas isn't a product suite. It's a house with rooms — a front door (`auth`), a
hallway (`portal`), a gym (`swole`), a cinema (`theater`), a workshop
(`tdr-code`), a mail slot (`download`), a garage (`dashcam`). The apps have
nothing in common functionally and never will.

Ultraviolet's only job is to make moving between them feel like walking through
a doorway instead of launching a different product.

**One hue. All the chroma.** Most dark-purple interfaces are a neutral grey UI
with a violet button glued on. Ultraviolet inverts that: background, surfaces,
borders, text and accent are all hue `300`. Only the _chroma_ changes — from
`0.008` in body copy to `0.21` in the accent. Nothing in the system is grey.
Everything is purple; most of it is just very quiet.

That one decision is what makes eight unrelated apps read as one place, and it's
why the accent never looks stuck on.

---

## The three rules

Every rule below is the same idea in a different material: **separate what the
machine asserts from what a person does.** Learn these three and you can style a
screen that nobody has specced.

### 1. Colour — chroma is energy

Quiet things don't change colour when you interact with them. They get _more
purple_.

| State         | What changes                                              |
| ------------- | --------------------------------------------------------- |
| Rest          | Low chroma (`0.021`–`0.038`)                              |
| Hover         | Border and fill gain chroma; a tile goes `0.027` → `0.06` |
| Focus         | Gains chroma **and** a 3px `uv-ghost` ring                |
| Live / active | Maximum chroma, plus the pulse                            |
| Pressed       | Accent only — drops lightness, gains chroma               |

The accent is the one exception: it already sits at maximum chroma, so on hover
it brightens instead (`68%` → `75%`). It has nowhere left to go.

**Corollary — any hue that isn't 300 is news.** Green, amber and red are the
only non-purple colours that exist. They mean status and nothing else. That's
why they read so loudly on a page where everything else is one wavelength. Never
introduce a fourth hue "for variety."

### 2. Type — mono is the machine, sans is the interface talking to you

| Voice    | Face                | What it carries                                                                            |
| -------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Machine  | IBM Plex Mono       | subdomains, IDs, statuses, counts, timestamps, paths, keys, log lines, `tabular-nums` data |
| Human    | Figtree             | descriptions, empty states, errors, help, button labels, anything phrased as a sentence    |
| The door | Bricolage Grotesque | page titles at ≥24px only, and the one big number on a screen                              |

When you can't decide which a string is, ask: **did a human write it, or did a
process emit it?** `4h ago` is emitted. `Last seen four hours ago` is written.

This is the rule that saves the most work. Eight apps built months apart drift
because every new screen re-decides what a timestamp looks like. One question
settles that everywhere, forever, without shipping a component.

### 3. Motion — springs for you, eases for the machine

| Cause                                                           | Curve       | Duration      |
| --------------------------------------------------------------- | ----------- | ------------- |
| You pressed, dragged, toggled it                                | spring      | 120ms         |
| The system did it (data arrived, route changed, toast appeared) | `--ease-uv` | 200ms / 380ms |

There is **one** entry motion in the whole system: fade up 6px. "Lots of
animation" comes from _staggering_ that one motion across a list at 40ms, not
from inventing new ones. A screen that slides, spins, bounces and fades is
noise; a screen where forty things arrive in sequence with the same gesture
feels alive.

---

## The signature

**The doorplate.** Every app announces its room in the top-left with the pepe
badge and its subdomain in mono:

```
( 🐸 ) swole.lilnas.io
```

It is byte-for-byte identical in all eight apps — same size, same position, same
radius, same type. It's the only element that never varies. That sameness is
what turns eight tabs into one building.

**The live dot.** 7px, hue 300 or `--ok`, with a slow 2.4s expanding ring.
Anything alive anywhere in the system wears it: a running session, an active
download, a player in the theater, a workout in progress.

---

## Where delight lives

"Delightful" is mostly not animation. Budget it deliberately:

1. **Empty states** — the only place the mascot is allowed out, plus one line in
   the interface's voice and exactly one thing to press.
2. **Completion** — finishing a workout, a download landing, access being
   granted. These earn a real moment.
3. **Micro-feedback** — every press springs. Not decoration; it's the interface
   feeling physical.
4. **Writing** — see [`docs/designs/voice.md`](docs/designs/voice.md). Most of
   "friendly" is not being weird at people.

**One delight per screen, maximum.** If two things on a screen are competing to
be charming, cut one.

---

## Quick reference

```css
/* surfaces — stack by lightness, never by shadow */
--color-bg: oklch(14% 0.021 300);
--color-bg-sunk: oklch(11% 0.018 300);
--color-surface: oklch(18.5% 0.027 300);
--color-surface-2: oklch(23% 0.032 300);
--color-surface-3: oklch(28% 0.038 300);

/* lines do the work shadows would */
--color-line: oklch(29% 0.038 300);
--color-line-soft: oklch(23.5% 0.031 300);
--color-line-loud: oklch(41% 0.055 300);

/* text */
--color-ink: oklch(97% 0.008 300);
--color-ink-2: oklch(79% 0.02 300);
--color-ink-3: oklch(63% 0.026 300);
--color-ink-4: oklch(50% 0.028 300);

/* the accent */
--color-uv: oklch(68% 0.21 300);
--color-uv-hi: oklch(75% 0.195 300); /* hover */
--color-uv-press: oklch(62% 0.225 300); /* active */
--color-uv-dim: oklch(42% 0.14 300);
--color-uv-ghost: oklch(68% 0.21 300 / 0.13);
--color-uv-ink: oklch(15% 0.045 300); /* text ON the accent */

/* status — the only other hues that exist */
--color-ok: oklch(76% 0.17 155);
--color-warn: oklch(82% 0.15 85);
--color-bad: oklch(66% 0.2 22);
```

Full token set, the copy-pasteable `@theme` block, and the reasoning behind each
value: [`docs/designs/foundations.md`](docs/designs/foundations.md).

### Non-negotiables

- **Dark ink on the accent, never white.** White on `--color-uv` is ~3:1 and
  fails WCAG AA. `--color-uv-ink` gives ~7:1. The accessible choice is also the
  flatter, more poster-like one.
- **Elevation is lightness + a border. Not shadow.** The system is flat. The one
  shadow (`--shadow-lift`) is reserved for things that genuinely float above the
  page: modal, drawer, popover, toast.
- **Focus rings are always visible.** 2px `--color-uv`, 2px offset. Never
  `outline: none` without a replacement.
- **`prefers-reduced-motion` is respected everywhere.** Entry animations resolve
  to their end state; loops stop.
- **Round means label, rectangular means control.** Chips, badges, avatars and
  status pills are `rounded-full`. Buttons, inputs and cards are not.

---

## The docs

| Doc                                                                  | What's in it                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`docs/designs/preview/index.html`](docs/designs/preview/index.html) | **Start here.** The whole system, rendered.                                      |
| [`docs/designs/foundations.md`](docs/designs/foundations.md)         | Colour, type, space, shape, elevation. Tokens + the `@theme` block.              |
| [`docs/designs/motion.md`](docs/designs/motion.md)                   | Durations, curves, the entry motion, stagger, reduced motion.                    |
| [`docs/designs/components.md`](docs/designs/components.md)           | Anatomy, variants and states for every primitive.                                |
| [`docs/designs/voice.md`](docs/designs/voice.md)                     | How the interface talks. Buttons, errors, empty states.                          |
| [`docs/designs/adoption.md`](docs/designs/adoption.md)               | Rollout order, the `@lilnas/ui` package, and the MUI→Tailwind migration per app. |

---

## Status

**v0.1 — direction agreed, nothing built yet.** No app has adopted this. The
`@lilnas/ui` package doesn't exist. See
[`docs/designs/adoption.md`](docs/designs/adoption.md) for the proposed order and
the real per-app cost.
