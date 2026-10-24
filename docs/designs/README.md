# lilnas design system

The design system for every app at `*.lilnas.io`. Direction: **Category
Standard** — dark violet-tinted surfaces, hairline borders, 6–8px corners, soft
tinted status badges and one accent.

**Start with [`preview/index.html`](preview/index.html)** — open it in a browser.
It's one self-contained file that renders every component in the system.
Nothing to install.

Then read [`../../DESIGN.md`](../../DESIGN.md) for the thesis and the four rules
everything derives from.

---

## The docs

| Doc                                  | What's in it                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`../../DESIGN.md`](../../DESIGN.md) | The north star. Thesis, the four rules, density, the signature, quick token reference, non-negotiables.                                   |
| [`foundations.md`](foundations.md)   | Colour, type, space, shape, elevation. Every token with its measured contrast, plus the copy-pasteable Tailwind `@theme` block and fonts. |
| [`motion.md`](motion.md)             | Curves, durations, the single entry motion, stagger, hover steps, the live pulse, reduced motion, when to reach for a library.            |
| [`components.md`](components.md)     | Anatomy, variants and states for every primitive in `@lilnas/ui`, plus the build order.                                                   |
| [`voice.md`](voice.md)               | How the interface talks. Buttons, errors, empty states, confirmations, per-app tone.                                                      |
| [`adoption.md`](adoption.md)         | Current state of the apps, the `@lilnas/ui` package, how to migrate the apps already on the previous system, and the migration order.     |

---

## The short version

**One accent, tinted neutrals, status means status.** Violet is the only colour
that isn't telling you how something is going. Green, amber and red mean
running, queued and failed, and nothing else.

Four rules:

1. **Colour.** One accent; dark ink on it, never white; any other hue is news.
2. **Type.** Geist for people, Geist Mono for identifiers someone would copy.
   Numbers are tabular, not mono.
3. **Shape.** Hairlines, not shadows. 6px controls, 8px containers, round labels.
4. **Motion.** Springs for what you do, one soft ease for what the system does,
   one entry motion staggered.

The signature is the **doorplate** — the pepe badge plus the subdomain in mono,
identical in every app.

---

## Status

**Direction agreed; implementation partial.** `apps/download` and `apps/dev`
ship a local copy of the previous system under mostly the same token names, so
adopting this is a values swap plus a rename. `@lilnas/ui` doesn't exist yet.
See [`adoption.md`](adoption.md).

The comparison that led here (six candidates, 23 components each) was built as
throwaway HTML in `.impeccable/mocks/components/` and is not part of the repo's
tracked docs.
