# Components

Specs for every primitive in `@lilnas/ui`. Each entry gives anatomy, variants,
states and the classNames that produce them.

These are rendered live in [`preview/index.html`](preview/index.html) — read the
markup there if a spec is ambiguous.

---

## Conventions

- `cns()` from `@lilnas/utils/cns` for all class merging. It's `clsx` +
  `tailwind-merge`, already used by every app.
- Every component takes `className` and merges it last, so callers can override.
- Interactive components forward refs and spread `...props`.
- Headless behaviour comes from **Radix primitives**. See
  [`adoption.md`](adoption.md) for why Radix over Base UI or Headless UI.
- Icons are inline SVG from `@lilnas/ui/icons`, sized by `currentColor` and a
  `size` prop. No icon font, no `lucide-react` — `auth` already has a
  hand-rolled 24-icon set that becomes the seed.

---

## Doorplate

**The signature element. Identical in all eight apps.** It is the only component
with no variants, because its whole job is to be the same everywhere.

```
┌─────────────────────────────┐
│ ( 🐸 )  swole.lilnas.io      │   32px tall, rounded-full
└─────────────────────────────┘
   24px      mono 12px/500
   badge     ".lilnas.io" in ink-4
```

```tsx
<Doorplate app="swole" href="https://lilnas.io" />
```

| Part      | Spec                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Container | `h-8 pl-1 pr-3 gap-[9px] rounded-full border border-line bg-surface`                                                        |
| Badge     | `size-6 rounded-full overflow-hidden` + `pepe-badge` (the mark carries its own full-bleed backdrop, so it fills the circle) |
| Name      | `font-mono text-xs font-medium`                                                                                             |
| TLD       | `text-ink-4` — the subdomain is the emphasis, not the domain                                                                |
| Hover     | `border-uv-dim bg-surface-2`                                                                                                |

Top-left of the app bar. Links to `https://lilnas.io` (the portal). On the
portal itself it reads `lilnas.io` with no subdomain and doesn't link anywhere.

---

## Button

Rectangular (`rounded-md`) — it's a control.

| Variant   | Fill         | Text          | Border        | Use                             |
| --------- | ------------ | ------------- | ------------- | ------------------------------- |
| `uv`      | `bg-uv`      | `text-uv-ink` | —             | The one primary action per view |
| `outline` | `bg-surface` | `text-ink`    | `border-line` | Secondary                       |
| `ghost`   | —            | `text-ink-3`  | —             | Tertiary, toolbar, icon-only    |
| `bad`     | —            | `text-bad`    | —             | Destructive                     |

| Size           | Height | Padding  | Text   |
| -------------- | ------ | -------- | ------ |
| `sm`           | 30px   | `0 11px` | 13px   |
| `md` (default) | 38px   | `0 15px` | 14px   |
| `lg`           | 46px   | `0 22px` | 15.5px |

States:

```
hover    uv → bg-uv-hi · outline → border-uv-dim bg-surface-2 · ghost → text-ink bg-surface-2 · bad → bg-bad-ghost
active   scale-96, 120ms ease-spring · uv → bg-uv-press
focus    outline-2 outline-uv outline-offset-2
disabled opacity-[.38] pointer-events-none
loading  spinner replaces the leading icon; label stays; width does not change
```

**Rules**

- One `uv` button per view. Two primaries means neither is.
- A destructive action is `bad` **ghost**, never a filled red button — filled
  red is for the confirm step inside a dialog, and only there.
- Label with a verb that names the action, and reuse that exact word in the
  resulting toast. See [`voice.md`](voice.md).
- Icon-only buttons need `aria-label`.

---

## Chip

Round (`rounded-full`) — it's a label.

23px tall, `px-[10px]`, `font-mono text-[11px] font-medium`, 1px border.

| Variant | Fill         | Text    | Border    |
| ------- | ------------ | ------- | --------- |
| `uv`    | `uv-ghost`   | `uv-hi` | `uv/30`   |
| `ok`    | `ok-ghost`   | `ok`    | `ok/30`   |
| `warn`  | `warn-ghost` | `warn`  | `warn/30` |
| `bad`   | `bad-ghost`  | `bad`   | `bad/32`  |
| `mute`  | `surface-2`  | `ink-3` | `line`    |

Chip text is **machine voice** — `running`, `granted`, `pending`, `admin`,
`4h ago`. Lowercase. If you want a sentence, you want a `Note`, not a chip.

A chip may contain a leading `StatusDot`. A chip is never clickable; a clickable
pill is a `Button`.

---

## StatusDot

7px circle. With `pulse`, adds a 1.5px ring animating `breathe` over 2.4s.

| Tone   | Colour  | Pulses?                         |
| ------ | ------- | ------------------------------- |
| `ok`   | `ok`    | yes, when live                  |
| `uv`   | `uv`    | yes, when the system is working |
| `warn` | `warn`  | **no**                          |
| `bad`  | `bad`   | **no**                          |
| `idle` | `ink-4` | no                              |

Problems don't blink. A wall of flashing red dots is unreadable and stressful.

---

## Card / Panel

```
bg-surface · border border-line · rounded-lg · p-5
```

No shadow. Never gains one on hover. A card that's a link becomes a **Tile**.

`Card` variants: `default` (`bg-surface`), `sunk` (`bg-bg-sunk`, for wells
containing their own content like log panes).

---

## Tile

A card that's a navigation target. This is the hover-chroma showcase.

```
rest   bg-surface border-line rounded-md p-4
hover  bg-[oklch(22%_.055_300)] border-uv -translate-y-0.5
       icon slot: bg-surface-3 text-ink-2 → bg-uv-ghost text-uv-hi
```

Anatomy: a 30px `rounded-lg` icon slot, an `h3` name, and a `mono-sm text-ink-3`
subdomain or subtitle. This is the `portal` grid and `auth`'s services grid.

---

## Input / Field

```
h-9.5 px-3 rounded-md border border-line bg-bg-sunk text-sm
placeholder:text-ink-4
focus:border-uv focus:ring-3 focus:ring-uv-ghost focus:outline-none
```

Inputs sit on `bg-bg-sunk` — **darker** than the card they're on. An input is a
well, not a raised surface. This is the opposite of the Material instinct and
it's what makes the flat system read as flat.

`Field` wraps label + control + hint/error:

```tsx
<Field label="Routine name" hint="Shown on your home screen">
  <Input placeholder="Push day" />
</Field>
```

- Label: `text-[13px] font-[560] text-ink-2`
- Hint: `text-xs text-ink-3`
- Error: `text-xs text-bad`, replaces the hint, and sets `border-bad` on the
  control plus `aria-invalid` / `aria-describedby`
- Inputs holding machine values (URLs, paths, IDs, tokens) get
  `font-mono text-[13px]`

---

## Select, Menu, Combobox

Radix `Select` / `DropdownMenu` / a Radix-Popover-based combobox.

Trigger matches `Input`. Content panel:

```
bg-surface-3 border border-line-loud rounded-lg shadow-lift p-1
```

Item: `h-8 px-2.5 rounded-xs text-sm`, hover `bg-surface-2`, selected
`bg-uv-ghost text-uv-hi`. Enter/exit `animate-rise` at 200ms.

**Combobox** is the hardest component in the set — `swole`'s exercise picker
needs freeform entry, grouping by muscle group, and a coloured dot per group.
Spec it once, properly, and only in `@lilnas/ui`. Don't reimplement per app.

---

## Dialog

Radix `Dialog`.

```
scrim    fixed inset-0 bg-black/55, fades 200ms
panel    w-full max-w-[440px] bg-surface border border-line-loud
         rounded-lg shadow-lift p-6 flex flex-col gap-4
         animate-rise
```

Title `h2`, body `sm text-ink-2`, actions right-aligned in a row with the
primary last.

**Destructive confirms name the object and its consequence:**

> Delete "Push day"? Its 14 logged sessions stay.

Not "Are you sure?". The confirm button is filled `bad` — the only place a
filled red button exists.

Prefer `tdr-code`'s **inline two-step confirm** for low-stakes destructive
actions in a list: the button swaps in place to `Kill session?` + Confirm/Cancel.
It's less disruptive than a modal and the pattern already exists in the codebase.

---

## Sheet / Drawer

Radix `Dialog` positioned to an edge. `swole` needs `bottom`; `tdr-code` needs
`right`.

```
transform transition 380ms ease-uv
bottom: translate-y-full → 0, rounded-t-xl, max-h-[85vh]
right:  translate-x-full → 0, w-full max-w-[480px]
```

Bottom sheets get a 36×4px `rounded-full bg-line-loud` grab handle. Both trap
focus, close on Escape and scrim click, and restore focus on close.

---

## Tabs

Radix `Tabs`.

```
list     flex gap-[22px] border-b border-line
trigger  py-2.5 text-sm font-[550] text-ink-3
active   text-ink + 2px rounded-full bg-uv underline, bottom -1px
```

Underline slides between tabs at 200ms `ease-uv`. An optional count badge is a
`mute` chip.

---

## Table

```
th   font-mono text-[10.5px] font-medium tracking-[.11em] uppercase text-ink-4
     text-left px-3 pb-2.5 border-b border-line
td   px-3 py-[11px] text-[13.5px] border-b border-line-soft
row  hover:bg-surface-2, 120ms
```

Headers are field names, so they're machine voice. Cells holding emitted data
(`4h ago`, `theater, swole`, IDs) are `mono-sm text-ink-3`; cells holding human
data (names, titles) are sans.

Numeric columns get `tabular-nums` and right-align. Last row has no border.

**Below `md`, a table becomes a card list.** `auth` already does this with a
CSS media query and two parallel renderings — `@lilnas/ui` should ship a
`<DataList>` that takes one column definition and renders both, so the data
can't drift between them.

---

## Toast

```
bg-surface-3 border border-line-loud rounded-md shadow-lift
px-4 py-2.5 text-[13.5px] font-[520]
```

Bottom-centre. Enters with `animate-rise`, exits fade+down at 200ms. Auto
dismiss at 2200ms (`auth`'s existing constant); errors persist until dismissed.
Leading icon tinted by tone. `role="status" aria-live="polite"`.

Toasts confirm; they don't explain. "Routine saved", not "Your routine has been
saved successfully." If it needs a sentence, it's a `Note`.

---

## Note

An inline banner. The thing that _does_ get a sentence.

```
flex gap-2.5 p-[13px_15px] rounded-md border border-line bg-surface
text-[13.5px] leading-[1.55] text-ink-2
```

Tone tints the icon and border only, never the whole fill — a solid amber block
is a Material instinct and it wrecks the flat look.

Structure: **bold lead sentence, then the detail.**

> **yt-dlp is out of date.** Some sites may fail until it updates — that happens
> nightly at 3am.

---

## EmptyState

```
py-10 px-6 text-center
pepe-full at 46px, opacity-55
h3 title · sm text-ink-3 body (max-w-[34ch]) · one sm button
```

The only place the mascot appears in normal UI. Never a dead end — always
exactly one thing to press. Copy rules in [`voice.md`](voice.md).

---

## Skeleton

`rounded-xs` + the shimmer gradient. Match the shape of what's loading, not a
generic grey box: three lines of varying width for a paragraph, a
`h-[210px] w-[140px]` block for a poster.

---

## Progress

```
track  h-[5px] rounded-full bg-surface-3
fill   bg-uv rounded-full, width transitions 380ms ease-uv
```

Pair with a `mono-sm tabular-nums text-uv-hi` percentage. Indeterminate variant
uses a 30%-wide fill sliding on a 1.4s loop.

---

## Avatar

`rounded-full bg-surface-3 border border-line`, initials in
`text-[13px] font-[590]`. Sizes 28 / 36 / 64px. `ring` variant adds
`ring-2 ring-uv ring-offset-2 ring-offset-bg` for "this is you."

---

## Build order

Ship in this order — each tier unblocks real screens:

**1 — unblocks `portal`, `auth`**
`Doorplate` · `Button` · `Card` · `Tile` · `Chip` · `StatusDot` · `EmptyState` ·
`icons`

**2 — unblocks `download`, `tdr-code`**
`Input` · `Field` · `Tabs` · `Toast` · `Note` · `Skeleton` · `Progress` ·
`Table` / `DataList` · `Avatar`

**3 — unblocks `swole`**
`Dialog` · `Sheet` · `Select` · `Menu` · `Combobox`

Tier 3 is the expensive one and only `swole` needs it, which is why `swole`
migrates last. See [`adoption.md`](adoption.md).
