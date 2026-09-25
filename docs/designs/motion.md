# Motion

The brief asks for "lots of animation." The failure mode of that brief is a page
where six unrelated things move in six different ways, which reads as
unfinished, not alive.

So: **one entry motion, two curves, and a stagger.** Volume comes from applying
the same gesture to many elements in sequence, never from inventing new gestures.

---

## The rule

> **Springs for you. Eases for the machine.**

| You caused it                               | The machine caused it                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Button press, toggle, drag, swipe, checkbox | Data arrived, route changed, toast appeared, list loaded, status flipped |
| `--ease-spring`, 120ms                      | `--ease-uv`, 200–380ms                                                   |
| Feels physical — it pushes back             | Feels delivered — it glides in                                           |

This mirrors the type rule (`mono` = machine, `sans` = interface) and the colour
rule (hue 300 = system, other hues = events). Three materials, one idea:
distinguish what the machine asserts from what a person does.

---

## Curves

```css
--ease-uv: cubic-bezier(0.32, 0.72, 0, 1);
--ease-spring: linear(0, 0.006, 0.025 2.8%, …, 1.015 60%, 1.006 76.2%, 1);
```

`--ease-uv` is a strong ease-out: fast start, long settle. It's the curve for
everything the system does.

`--ease-spring` is a CSS `linear()` spring with a small overshoot (peaks at
1.015). It's for direct manipulation only. `linear()` is supported everywhere we
target, so presses don't need a JS animation library.

Never use `ease`, `ease-in-out`, or `linear`. `ease-in` in particular is wrong
for entrances — it makes things feel sluggish to start.

---

## Durations

| Token      | Value | Used for                                                          |
| ---------- | ----- | ----------------------------------------------------------------- |
| `--t-fast` | 120ms | Press, hover colour, focus ring                                   |
| `--t`      | 200ms | Entry/exit, chip changes, tab underline, row hover                |
| `--t-slow` | 380ms | Route transitions, drawer/sheet, progress bar fill, large reveals |
| —          | 2.4s  | The live pulse loop                                               |

Anything above 400ms in a UI transition is a mistake unless it's ambient
(`breathe`) or the user asked for it (a `theater` scene fade).

---

## The one entry motion

```css
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
```

`animate-rise` — fade up 6px over 380ms on `--ease-uv`.

Six pixels, not twenty. A big travel distance reads as a slideshow; a small one
reads as the thing settling into place. Nothing in the system slides in from off
screen, scales up from zero, or rotates in.

**Everything that appears uses this.** Cards, rows, panels, toasts, modals
(plus a scrim fade), search results, log lines. If you're reaching for a
different entry animation, the answer is almost always no.

---

## Stagger

This is where "lots of animation" actually comes from.

```
delay = index × 40ms, capped at 8 items (320ms)
```

Forty milliseconds is the sweet spot: below ~25ms the cascade is invisible;
above ~60ms the last item feels late. Cap the delay so a 200-row table doesn't
take eight seconds to arrive — after item 8, everything shares the same delay.

```tsx
export function StaggeredList({ items }: { items: Item[] }) {
  return items.map((item, i) => (
    <Row
      key={item.id}
      item={item}
      className="animate-rise"
      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
    />
  ));
}
```

Stagger **lists and grids**. Do not stagger the parts of a single card — a card
should arrive as one object.

### Where it goes in each app

| App        | Staggered                                     |
| ---------- | --------------------------------------------- |
| `portal`   | The service tile grid                         |
| `auth`     | The request queue; the service grid on home   |
| `swole`    | Routine cards on home; exercises in a routine |
| `download` | Search result posters                         |
| `tdr-code` | New log lines as they stream; session rows    |
| `dashcam`  | Day groups in the sidebar                     |

---

## Hover: chroma, not colour

The signature interaction. A quiet surface doesn't change hue when you point at
it — it gains chroma.

```
rest   bg-surface       (18.5% 0.027 300)   border-line      (29% 0.038 300)
hover  oklch(22% .055 300)                  border-uv        (68% 0.21  300)
       + translateY(-2px)
```

Only the accent behaves differently: it's already at maximum chroma, so hover
brightens it (`uv` → `uv-hi`) and press darkens-and-saturates it
(`uv` → `uv-press`).

Transition `background-color`, `border-color`, `color` and `transform` — never
`all`. `transition-all` will animate `height` and `width` during layout and
produce a visible stutter on first paint.

---

## Press

```css
transition: transform 120ms var(--ease-spring);
&:active {
  transform: scale(0.96);
}
```

Every pressable thing. `0.96` on a normal button; `0.97` on anything larger than
about 56px, or the travel becomes comical.

This is the highest-value animation in the system for perceived quality and it
costs one line. It matters most in `swole`, where the whole interaction model is
tapping big buttons with sweaty hands.

---

## The live pulse

```css
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
```

A 7px dot with a 1.5px ring expanding out over 2.4s. Applied to _anything alive_
in any app: running session, active download, connected peer, workout in
progress, tailing logs.

It's slow on purpose. A fast pulse is an alarm; a slow one is a heartbeat.

Only ever one hue per dot — `ok` for healthy-and-live, `uv` for
system-is-doing-something. A `warn` or `bad` dot does **not** pulse; a problem
that blinks at you is stressful and you can't triage a wall of them.

---

## Skeletons, not spinners

Default to a skeleton. It preserves layout, so nothing jumps when content
lands, and it makes the wait feel shorter because the shape of the answer is
already visible.

```css
background: linear-gradient(
  100deg,
  var(--color-surface-2) 30%,
  oklch(30% 0.055 300) 50%,
  var(--color-surface-2) 70%
);
background-size: 300% 100%;
animation: shimmer 1.5s linear infinite;
```

The shimmer highlight is the one gradient in the system, and it's a chroma bump
— consistent with the hover rule.

Use a spinner only when you genuinely can't know the shape of the result:
inside a button mid-submit, or a full-page boot. Use a progress bar whenever a
real percentage exists (`download` always has one).

---

## Route transitions

380ms, `--ease-uv`, `animate-rise` on the incoming page. Nothing on the
outgoing page — animating an exit means the user waits to leave, which always
feels slower than it is.

---

## Reduced motion

Non-negotiable, and it's already in the `@theme` base layer:

```css
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

The blanket rule handles most cases correctly: `animate-rise` uses `both` fill
mode so it snaps to its end state rather than vanishing, and `breathe` runs
once and stops.

Two things need explicit handling:

- **Auto-scrolling log tails** (`tdr-code`) — use `behavior: 'auto'`, not
  `'smooth'`, under reduced motion.
- **`theater`** — camera movement and avatar animation are the _content_, not
  decoration, so they don't stop. Offer an in-app toggle for view-bob instead.

---

## Motion budget per screen

| Always                        | Once per screen            | Never                                                  |
| ----------------------------- | -------------------------- | ------------------------------------------------------ |
| Press springs                 | One staggered reveal       | Parallax                                               |
| Hover chroma                  | One celebration, if earned | Anything looping that isn't a status                   |
| Focus rings                   |                            | Entrance animations on scroll for content already read |
| The live pulse on live things |                            | Two competing focal animations                         |

If two things on a screen are both trying to be the animated moment, cut one.

---

## Library

Most of the system is plain CSS — `animate-rise`, hover transitions, press
springs, the pulse and the shimmer need no JavaScript, and `tdr-code`'s
hand-rolled drawer proves a transform transition is enough for sheets too.

Reach for `motion` (the successor to `framer-motion`, already in `tdr-bot` at
`^12`) only for:

- Enter **and exit** animations on unmounting components (`AnimatePresence`)
- Shared-element transitions (`layoutId`)
- Gesture-driven drag where the spring must follow a finger

If you're animating opacity and transform on mount, use the CSS class.
