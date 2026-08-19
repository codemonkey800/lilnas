# Ultraviolet — design docs

The design system for every app at `*.lilnas.io`.

**Start with [`preview/index.html`](preview/index.html)** — open it in a browser.
It's one self-contained file that renders the entire system: palette, type,
every component, the motion, and three apps mocked up in it. Nothing to install.

Then read [`../../DESIGN.md`](../../DESIGN.md) for the thesis and the three rules
everything derives from.

---

## The docs

| Doc                                  | What's in it                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`../../DESIGN.md`](../../DESIGN.md) | The north star. Thesis, the three rules, the signature, quick token reference, non-negotiables.                                         |
| [`foundations.md`](foundations.md)   | Colour, type, space, shape, elevation. Every token with its reasoning, plus the copy-pasteable Tailwind `@theme` block and font wiring. |
| [`motion.md`](motion.md)             | Curves, durations, the single entry motion, stagger, hover chroma, the live pulse, reduced motion, when to reach for a library.         |
| [`components.md`](components.md)     | Anatomy, variants and states for every primitive in `@lilnas/ui`, plus the build order.                                                 |
| [`voice.md`](voice.md)               | How the interface talks. Buttons, errors, empty states, confirmations, per-app tone.                                                    |
| [`adoption.md`](adoption.md)         | Current state of all eight apps, the `@lilnas/ui` package, migration order, and the real per-app MUI cost.                              |

---

## The short version

**One hue, all the chroma.** Everything — background, surfaces, borders, text,
accent — is hue `300`. Only chroma changes, from `0.008` in body copy to `0.21`
in the accent. Nothing in the system is grey.

Three rules, all saying the same thing in different materials:

1. **Chroma is energy.** Quiet things gain chroma when you interact with them,
   not a new colour. Any hue that isn't 300 means status.
2. **Mono is the machine, sans is the interface talking to you.** Did a human
   write this string, or did a process emit it?
3. **Springs for you, eases for the machine.** One entry motion; volume comes
   from staggering it.

The signature is the **doorplate** — the pepe badge plus the subdomain in mono,
byte-for-byte identical in all eight apps.

---

## Status

**v0.1 — direction agreed, nothing built.** `@lilnas/ui` doesn't exist yet and
no app has adopted the system. See [`adoption.md`](adoption.md) for the proposed
order; `portal` is one afternoon and is the cheapest way to find out whether
this is right.
