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
- Headless behaviour comes from **Base UI** (`@base-ui/react`). See
  [`adoption.md`](adoption.md) for why Base UI over Radix or Headless UI. Simple
  components (button, badge, card, input, table, progress) are plain Tailwind and
  don't need it.
- Icons are inline SVG from `@lilnas/ui/icons`, sized by `currentColor` and a
  `size` prop. No icon font, no `lucide-react` — `auth` already has a
  hand-rolled 24-icon set that becomes the seed.
- **Density.** Components read a `density` of `comfortable` (default) or
  `compact`, set once on a wrapper (`data-density`). Heights below are given as
  comfortable / compact. Anything tappable is at least 44px tall on touch.
- **Interaction.** Hover steps a surface up one level (`surface` → `surface-2`)
  or a border up one level (`line` → `line-loud`). Press springs. Focus is
  always the 2px accent ring.

---

## Doorplate

**The signature element. Identical in every app.** It is the only component with
no variants, because its whole job is to be the same everywhere.

```
┌─────────────────────────────┐
│ ( 🐸 )  swole.lilnas.io      │   32px tall, rounded-full
└─────────────────────────────┘
   24px      mono 12px/500
   badge     ".lilnas.io" in ink-3
```

```tsx
<Doorplate app="swole" href="https://lilnas.io" />
```

| Part      | Spec                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| Container | `h-8 pl-1 pr-3 gap-2 rounded-full border border-line bg-surface`                                                            |
| Badge     | `size-6 rounded-full overflow-hidden` + `pepe-badge` (the mark carries its own full-bleed backdrop, so it fills the circle) |
| Name      | `font-mono text-xs font-medium text-ink`                                                                                    |
| TLD       | `text-ink-3` — the subdomain is the emphasis, not the domain                                                                |
| Hover     | `border-line-loud bg-surface-2`                                                                                             |

Top-left of the app bar. Links to `https://lilnas.io` (the portal). On the
portal itself it reads `lilnas.io` with no subdomain and doesn't link anywhere.

---

## App bar

Full-width, `h-14` (`h-12` compact), `bg-surface border-b border-line`, `px-4`.
Left to right: `Doorplate`, primary nav links (`text-sm font-medium`, `ink-3`,
active `ink`), a spacer, then search / `Avatar`.

On phones the nav collapses into a `Sheet`; the doorplate stays.

---

## Button

Rectangular (`rounded-md`) — it's a control. Font `font-medium`.

| Variant   | Fill           | Text              | Border        | Use                                 |
| --------- | -------------- | ----------------- | ------------- | ----------------------------------- |
| `accent`  | `bg-accent`    | `text-accent-ink` | —             | The one primary action per view     |
| `outline` | `bg-surface-2` | `text-ink`        | `border-line` | Secondary                           |
| `ghost`   | —              | `text-accent-hi`  | —             | Tertiary, toolbar, links-as-buttons |
| `bad`     | —              | `text-bad`        | `border-bad`  | Destructive                         |

| Size           | Height (comfortable / compact) | Padding  | Text |
| -------------- | ------------------------------ | -------- | ---- |
| `sm`           | 30px / 26px                    | `0 11px` | 13px |
| `md` (default) | 36px / 30px                    | `0 14px` | 14px |
| `lg`           | 44px                           | `0 20px` | 15px |

States:

```
hover    accent → bg-accent-hi · outline → border-line-loud bg-surface · ghost → bg-accent-ghost · bad → bg-bad-ghost
active   scale-[.97], 120ms ease-spring · accent → bg-accent-press
focus    outline-2 outline-accent outline-offset-2
disabled opacity-40 pointer-events-none
loading  spinner replaces the leading icon; label stays; width does not change
```

**Rules**

- One `accent` button per view. Two primaries means neither is.
- A destructive action is the outlined `bad` button. A _filled_ red button exists
  only as the confirm step inside a dialog.
- Label with a verb that names the action, and reuse that exact word in the
  resulting toast. See [`voice.md`](voice.md).
- Icon-only buttons need `aria-label`, and are square (`size-9`, `size-11` on
  touch).

---

## Badge

Round (`rounded-full`) — it's a label. Soft tinted pill with a leading dot, no
border.

`h-6`, `px-2.5`, `gap-1.5`, `text-xs font-medium`. The dot is `size-1.5`
(6px), `bg-current`.

| Variant  | Fill           | Text        | Means                         |
| -------- | -------------- | ----------- | ----------------------------- |
| `accent` | `accent-ghost` | `accent-hi` | In progress, selected, live   |
| `ok`     | `ok-ghost`     | `ok`        | Delivered, connected, healthy |
| `warn`   | `warn-ghost`   | `warn`      | Queued, pending, stale        |
| `bad`    | `bad-ghost`    | `bad`       | Failed, blocked               |
| `mute`   | `surface-2`    | `ink-3`     | Idle, neutral metadata        |

Badge text is **sentence case**, one or two words: `Downloading`, `Delivered`,
`Queued`, `Failed`. If you want a full sentence, you want a `Note`. Never
clickable; a clickable pill is a `Button`.

The `accent` variant with `live` swaps the static dot for a `StatusDot` with
`pulse`.

---

## StatusDot

8px circle. With `pulse`, adds a ring animating `breathe` over 2.4s.

| Tone     | Colour   | Pulses?                         |
| -------- | -------- | ------------------------------- |
| `ok`     | `ok`     | yes, when live                  |
| `accent` | `accent` | yes, when the system is working |
| `warn`   | `warn`   | **no**                          |
| `bad`    | `bad`    | **no**                          |
| `idle`   | `ink-4`  | no                              |

Problems don't blink. A wall of flashing red dots is unreadable and stressful.

---

## Card / Panel

```
bg-surface · border border-line · rounded-lg · p-4 (p-3 compact)
```

No shadow. Never gains one on hover. A card that's a link becomes a **Tile**.

Variants: `default` (`bg-surface`), `sunk` (`bg-bg-sunk`, for wells containing
their own content like log panes).

### Media card

The `download` browse and queue unit: a poster on the left, title and meta on the
right.

```
card   flex overflow-hidden (poster bleeds to the card edge)
poster w-[92px] shrink-0, 2:3
body   p-3 gap-1.5 — title h3, meta cap ink-3, Progress, actions
head   title + Badge on one row (title truncates, badge never wraps)
```

Meta is one line of facts separated by `·`: `2160p · 38.4 GB`. A failed item
swaps the progress fill to `bad` and puts the reason in `cap ink-3` under it,
with `Retry` as the single `accent` button.

---

## Tile

A card that's a navigation target: the `portal` grid and `auth`'s services.

```
rest   bg-surface border border-line rounded-lg p-3
hover  bg-surface-2 border-line-loud
```

Anatomy: a 30px `rounded-md` icon slot (`bg-accent-ghost text-accent-hi`), an
`h3` name, a `mono-sm text-ink-3` subdomain, and an optional `StatusDot` with
a word (`3 active`, `Ready`, `Down`).

---

## Input / Field

```
h-9 (h-[30px] compact) px-3 rounded-md border border-line-control
bg-bg-sunk text-sm placeholder:text-ink-3
focus:border-accent focus:ring-2 focus:ring-accent-ghost focus:outline-none
```

Inputs sit on `bg-bg-sunk` — **darker** than whatever they're on. An input is a
well, not a raised surface; the `line-control` border makes the boundary
legible at 3:1.

`Field` wraps label + control + hint/error:

```tsx
<Field label="Video URL" hint="Paste any link yt-dlp supports.">
  <Input placeholder="https://…" />
</Field>
```

- Label: `text-[13px] font-medium text-ink-2`, 6px above the control
- Hint: `text-xs text-ink-3`, 5px below
- Error: `text-xs text-bad`, replaces the hint, and sets `border-bad` on the
  control plus `aria-invalid` / `aria-describedby`
- Inputs holding machine values (URLs, paths, IDs, tokens) get
  `font-mono text-[13px]`

**Search** is an `Input` and an `accent` `Button` in one row, `gap-2`, the input
flexing. On phones the button drops to icon-only.

`Textarea` is the same, `min-h-[70px]`, vertical-resize off unless it is a
long-form field.

---

## Checkbox, Radio, Switch, Segmented

All built on Base UI; all use `line-control` for their boundary.

| Control   | Rest                                                    | Selected                                                    |
| --------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Checkbox  | `size-[18px] rounded-xs border-line-control bg-bg-sunk` | `bg-accent border-accent`, `accent-ink` check mark          |
| Radio     | `size-[18px] rounded-full border-line-control`          | `border-accent`, 8px `bg-accent` dot                        |
| Switch    | `w-9 h-5 rounded-full bg-surface-2 border-line-control` | `bg-accent border-accent`, thumb `accent-ink` slides to end |
| Segmented | `border-line-control rounded-md`, segments `bg-surface` | selected segment `bg-accent text-accent-ink`                |

Label sits 8px to the right, `text-[13px]`. The tap target includes the label.
Use a switch for something that takes effect immediately; a checkbox for
something that waits on a submit.

---

## Slider

`h-1.5 rounded-full bg-surface-2` track, `bg-accent` fill, 18px thumb
(`bg-ink`, 3px `accent` border). Always paired with its current value in
`tabular-nums`, right-aligned above the track.

---

## Select, Menu, Combobox

Base UI `Select` / `Menu` / `Combobox`.

Trigger matches `Input`, with a chevron and the current value in `ink-3` when
secondary. Content panel:

```
bg-surface border border-line-loud rounded-lg shadow-lift p-1.5
```

Item: `h-8 px-2.5 rounded-md text-[13.5px]` (`h-7` compact). Hover and keyboard
highlight `bg-surface-2`; selected adds a trailing check in `accent-hi`.
Destructive items are `text-bad` and sit below a `line` divider. Keyboard hints
(`⌘C`, `R`) are `mono-sm text-ink-3`, right-aligned. Enter/exit `animate-rise` at
200ms.

A **Select** and a **Combobox** with a `Search…` row at the top share the same
panel; the combobox also filters its items as you type.

**Combobox** is the hardest component in the set — `swole`'s exercise picker
needs freeform entry, grouping by muscle group, and a coloured dot per group.
Spec it once, properly, and only in `@lilnas/ui`. Don't reimplement per app.

---

## Dialog

Base UI `Dialog`.

```
scrim    fixed inset-0 bg-black/55, fades 200ms
panel    w-full max-w-[440px] bg-surface border border-line-loud
         rounded-lg shadow-lift p-5 flex flex-col gap-3
         animate-rise
```

Title `h2`, body `sm text-ink-2`, actions right-aligned in a row with the
primary last.

**Destructive confirms name the object and its consequence:**

> Delete "Dune: Part Two"? The 38.4 GB comes off the disk. You can request it
> again later.

Not "Are you sure?". The confirm button is filled `bad` with `text-bg-sunk` — the
only place a filled red button exists. Cancel is `ghost`, labelled `Keep it`, not
`Cancel`, when the verb makes the choice clearer.

Prefer an **inline two-step confirm** for low-stakes destructive actions in a
list: the button swaps in place to `Kill session?` + Confirm/Cancel. It's less
disruptive than a modal and the pattern already exists in `tdr-code`.

---

## Sheet / Drawer

Base UI `Dialog` positioned to an edge. `swole` needs `bottom`; `tdr-code` and
`download`'s detail view need `right`.

```
transform transition 380ms ease-standard
bottom: translate-y-full → 0, rounded-t-xl, max-h-[85vh]
right:  translate-x-full → 0, w-full max-w-[480px], border-l border-line-loud
panel:  bg-surface shadow-lift p-4
```

Bottom sheets get a 36×4px `rounded-full bg-line-loud` grab handle. Both trap
focus, close on Escape and scrim click, and restore focus on close.

---

## Tabs

Base UI `Tabs`.

```
list     flex gap-1 border-b border-line
trigger  h-10 px-3.5 text-sm font-medium text-ink-3, hover:text-ink
active   text-ink + 2px bg-accent underline, bottom -1px
```

Underline slides between tabs at 200ms `ease-standard`. An optional count is a
`mute` pill (`font-mono text-[11px] bg-surface-2 text-ink px-1.5 rounded-full`).

---

## Table

```
th   text-[11px] font-medium tracking-[.06em] uppercase text-ink-3
     text-left px-3 pb-2.5 border-b border-line-loud
td   px-3 py-2.5 text-[13.5px] border-b border-line-soft
row  hover:bg-surface-2, 120ms · selected: bg-accent-ghost
```

Numeric columns get `tabular-nums` and right-align. Last row has no border.
Status cells use `Badge`. Identifiers (IDs, paths, hostnames) use `font-mono`;
everything else, including sizes and times, is Geist.

**Below `md`, a table becomes a card list.** `auth` already does this with a CSS
media query and two parallel renderings — `@lilnas/ui` should ship a
`<DataList>` that takes one column definition and renders both, so the data
can't drift between them.

---

## Toast

```
bg-surface border border-line-loud border-l-[3px] border-l-<tone>
rounded-lg shadow-lift px-3.5 py-2.5
```

Title `text-[13.5px] font-medium`; one line of detail in `text-ink-3` when needed.
A `×` dismiss at the right. Bottom-centre. Enters with `animate-rise`, exits
fade+down at 200ms. Auto dismiss at 2200ms (`auth`'s existing constant); errors
persist until dismissed. `role="status" aria-live="polite"`.

Toasts confirm; they don't explain. "Routine saved", not "Your routine has been
saved successfully." If it needs a paragraph, it's a `Note`.

---

## Note

An inline banner. The thing that _does_ get a sentence.

```
flex gap-2.5 px-3 py-2.5 rounded-lg text-[13px] leading-[1.5] text-ink-2
bg-<tone>-ghost
```

Four tones: `accent` (info), `ok`, `warn`, `bad`. The tone tints the fill and the
bold lead; the body text stays `ink-2`.

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
`h-[84px] w-[60px]` block for a poster. Under reduced motion the shimmer is a
flat `surface-2`.

---

## Progress

```
track  h-1.5 rounded-full bg-surface-2
fill   bg-accent rounded-full, width transitions 380ms ease-standard
```

Fill is `ok` when complete and `bad` when failed. Pair with a `tabular-nums
text-ink-3` percentage. Indeterminate variant uses a 30%-wide fill sliding on a
1.4s loop.

`Meter` (storage, quota) is the same track with a 10px height, a label row above
(`Storage` left, `412 GB of 1 TB` right in `ink-3`), and the fill turning `warn`
past 80% and `bad` past 95%.

---

## Avatar

`rounded-full`, initials in `text-[13px] font-semibold`. `accent` avatars
(`bg-accent text-accent-ink`) mean "you"; others are `bg-surface-2 text-ink`.
Sizes 24 / 32 / 40 / 64px. A stack overlaps by 8px with a 2px `bg` ring and a
final `+N` avatar for overflow.

---

## Tooltip

Base UI `Tooltip`. `bg-surface-2 border border-line-loud rounded-md px-2 py-1.5
text-xs font-medium shadow-lift`, 400ms open delay, no delay moving between
neighbours. Never the only place a fact appears — touch users can't hover.

---

## Breadcrumb and Pagination

Breadcrumb: `text-[13px] ink-3`, `/` separators, the current page `ink`
`font-medium`. Pagination: `size-8 rounded-md border-line` buttons with a
`tabular-nums` page number; current page is `bg-accent text-accent-ink`.

---

## LogViewer

The admin apps' staple. `bg-bg-sunk border border-line rounded-lg p-3`,
`font-mono text-xs leading-[1.65]`. Timestamp `ink-3`, level colour-coded
(`INFO` `accent-hi`, `WARN` `warn`, `ERROR` `bad`), source in `ink`, message in
`ink-2`. Streaming lines get `animate-rise`; virtualised rows must not (recycled
rows flicker — see [`adoption.md`](adoption.md)).

---

## Build order

Ship in this order — each tier unblocks real screens:

**1 — unblocks `portal`, `auth`**
`Doorplate` · `App bar` · `Button` · `Card` · `Tile` · `Badge` · `StatusDot` ·
`EmptyState` · `icons`

**2 — unblocks `download`, `dev`, `tdr-code`**
`Input` · `Field` · `Checkbox` / `Radio` / `Switch` / `Segmented` · `Tabs` ·
`Toast` · `Note` · `Skeleton` · `Progress` · `Table` / `DataList` · `Avatar` ·
`Tooltip` · `Breadcrumb` / `Pagination` · `LogViewer`

**3 — unblocks `swole`**
`Dialog` · `Sheet` · `Select` · `Menu` · `Combobox` · `Slider`

Tier 3 is the expensive one and only `swole` needs all of it, which is why
`swole` migrates last. See [`adoption.md`](adoption.md).
