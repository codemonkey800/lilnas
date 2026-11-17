# lilnas design system

The design system for every app at `*.lilnas.io`. Direction: **Category
Standard** — dark violet-tinted surfaces, hairline borders, 6–8px corners, soft
tinted status badges and one accent.

**Start with the live reference,
[`../features/design-system/designs/index.html`](../features/design-system/designs/index.html)**
— open it in a browser. It is one self-contained file that renders every
component in the system, every variant and state, in both densities. Nothing to
install. It is built from the shared mockup kit,
[`mockup-kit/`](mockup-kit), which every app's mockups include too.

[`preview/index.html`](preview/index.html) is the comparison-era snapshot: the
hand-written page the direction was chosen from. It is kept for the record and
is no longer updated.

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
| [`mockup-kit/`](mockup-kit)          | The Pug + Tailwind kit every app's mockups include: theme, one mixin per component, the harness and the icon sprite.                      |
| [`adoption.md`](adoption.md)         | Which apps are on the system, what changed for them (with the old-to-new token map), and the work that remains.                           |

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

**Implemented.** The library is [`packages/ui`](../../packages/ui)
(`@lilnas/ui`: the Tailwind theme plus every component in
[`components.md`](components.md)). `portal`, `auth`, `download`, `tdr-bot`,
`tdr-code` and `dev` are on it; `dashcam` and `theater` are the
remaining work. The live reference is
[`../features/design-system/designs/index.html`](../features/design-system/designs/index.html).
See [`adoption.md`](adoption.md).

The comparison that led here (six candidates, 23 components each) was built as
throwaway HTML in `.impeccable/mocks/components/` and is not part of the repo's
tracked docs.
