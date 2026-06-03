---
title: 'feat: Swole exercise catalog (dropdown picker)'
type: feat
status: active
date: 2026-05-28
deepened: 2026-05-28
origin: docs/brainstorms/2026-05-28-swole-exercise-catalog-requirements.md
---

# feat: Swole exercise catalog (dropdown picker)

## Overview

Replace the free-text exercise-name `TextField` in the Swole routine builder with a
**catalog-only**, searchable MUI `Autocomplete`. A new static TS module ships ~100
curated exercises (each tagged with a muscle group), partitioned by exercise type.
The picker filters options to the card's current type, groups them by muscle group
with a color-coded section header, alphabetizes within each group, blocks
off-catalog entries with an inline notice, pre-fills a sensible duration default for
time-based/cardio picks (only when the field is empty), and clears the name when the
card's type changes.

The change is deliberately additive and narrow: swap one field in one component, add
one static data module, and make a one-line refinement to `applyTypeSwitch`. **No
schema, migration, validation, or mutation change** — `exercises.name` stays free
text at the DB level (catalog membership is a UI-only gate). The future
`/routines/[id]` edit page inherits the picker for free through the shared
`RoutineForm`.

---

## Problem Frame

The routine builder (shipped 2026-05-28) authors each exercise's name via a free-text
`TextField` at `apps/swole/src/components/routines/ExerciseCard.tsx:120`. That builder
brainstorm explicitly deferred a name library; this plan un-defers it.

Free text has two costs (see origin: `docs/brainstorms/2026-05-28-swole-exercise-catalog-requirements.md`):

1. **Mobile friction** — typing "Cable High-to-Low Woodchoppers" by hand every time is
   slow and error-prone.
2. **Name fragmentation** — "Pushups" vs "Push-Ups" vs "Push Ups" become three
   different exercises, polluting any future cross-routine history or stats keyed on
   `exercises.name`.

A curated, searchable, catalog-only picker fixes both: fewer taps, one canonical
spelling per movement. The catalog content is seeded from Jeremy's existing Notion
exercise doc plus curated common-movement additions (~100 entries, weighted-heavy,
glute/hypertrophy-leaning).

---

## Requirements Trace

- R1. Exercise name entered via a searchable single-select combobox (MUI
  `Autocomplete`), replacing the free-text `TextField`; **catalog-only** (`freeSolo`
  disabled) — a non-catalog value cannot be committed. → U1, U3
- R2. Option list **filtered to the card's current type**. → U1 (`optionsForType`), U3
- R3. Options **grouped by muscle group** with section headers, ordered Legs/Glutes →
  Back → Chest → Shoulders → Arms → Core. Cardio renders as a single ungrouped list.
  Bodyweight and time-based use the same muscle-group sections. → U1 (ordering), U3
  (`groupBy` / `renderGroup`)
- R4. Each group header shows a **color-coded accent marker** (resolved: a small
  colored dot per group; one distinct accent color per muscle group). → U1 (accent
  map), U3 (`renderGroup`)
- R5. Within each group, exercises sorted **alphabetically**. → U1 (`optionsForType`)
- R6. No catalog match → inline **`noOptionsText`** notice ("No matching exercise —
  add it to the catalog."). No toast. → U3
- R7. Catalog is a **static TS module** (`apps/swole/src/lib/exercise-catalog.ts`), no
  DB table, no new dependency. → U1
- R8. Each entry carries a **name** and a **muscle-group** tag; type implied by which
  type-list it appears in. → U1
- R9. Ships with the **agreed v1 contents** (origin "Catalog Contents (v1)"). → U1
- R10. An exercise may appear under **more than one type** by listing it in each
  type's set; the type filter keeps contexts distinct. → U1 (data structure)
- R11. Selecting an entry sets the card's **name** to that entry's canonical name. →
  U1 (`buildSelectionPatch`), U3
- R12. Selecting a **time-based** or **cardio** entry pre-fills **duration** with a
  type-level default (time-based 30 s; cardio 20 min) **only when duration is empty**.
  Weighted/bodyweight set only the name. → U1 (`DURATION_DEFAULTS`,
  `buildSelectionPatch`), U3
- R13. Changing a card's **type clears the exercise name** (refines `applyTypeSwitch`,
  which currently preserves `name`). → U2
- R14. Selected value persists exactly as today: `exercises.name` is the chosen
  string. No schema/migration/mutation/DB change. → unchanged (verify via AE6)
- R15. Catalog membership is a **UI-only gate**, not a data invariant. The DB keeps
  `name` free text so seed rows and the future edit page (which may load off-catalog
  names) keep working. Server still enforces only `name` non-empty. → unchanged
  (design honors via value-lookup-or-null in U3)

**Origin actors:** A1 — Jeremy (sole user).
**Origin flows:** F1 (pick an exercise from the grouped catalog), F2 (attempt an
exercise that isn't in the catalog).
**Origin acceptance examples:** AE1 (covers R1, R2, R3, R5), AE2 (R1, R6), AE3 (R11,
R12), AE4 (R12), AE5 (R13), AE6 (R14, R15).

---

## Scope Boundaries

Carried from origin (`docs/brainstorms/2026-05-28-swole-exercise-catalog-requirements.md`).
Explicit non-goals for this plan:

- **No custom / free-text exercises.** A movement not in the catalog cannot be entered
  in the UI — it is added to `exercise-catalog.ts` and the app is redeployed.
  Deliberate: the broad catalog is the safety margin.
- No DB-backed or runtime-editable catalog, and no catalog-management UI.
- No self-growing catalog (union of past `exercises.name` values) — would resurface
  typos and needs a server read the builder avoids.
- No per-exercise sets / reps / increment defaults — only type-level **duration**
  defaults for time-based and cardio.
- No "recently used" / most-used ordering or pinned-recents cluster.
- No assist-weight or machine-level/intensity tracking.
- No exercise metadata beyond name + muscle group (no equipment, description, images,
  primary/secondary muscles, or video links).
- No fuzzy/synonym matching or typo correction beyond MUI's default substring filter.
- No change to the four exercise types, the schema, the CHECK constraint, or the
  atomic-create mutation.
- No de-duplication/canonicalization of historical rows — catalog-only governs new
  selections, not past data.

### Deferred to Follow-Up Work

- **Edit-page wiring** (`/routines/[id]`): no work here. The page inherits the picker
  automatically through the shared `RoutineForm`. R15's "keeps working" bar **is met** by
  this plan: an off-catalog legacy name resolves to `value = null` (empty field), with no
  crash and no MUI warning. What's deferred is only the *graceful display* of such a name
  (showing it rather than blank) — a follow-up polish, not a correctness gap (see Risks).

---

## Context & Research

### Relevant Code and Patterns

- `apps/swole/src/components/routines/ExerciseCard.tsx` — the **only component to
  change**. The name `TextField` lives at lines 120–139, wired with
  `value={card.name}`, `onChange={e => onChange({ name: e.target.value })}`,
  `error`/`helperText` via `showError('name')`, `inputRef={nameInputRef}`, and the
  dark-theme styling idiom (`sx` outline borders + `!text-neutral-*` Tailwind
  classes). The Type `Select` (lines 83–106) is the model for controlled MUI usage and
  styling in this file.
- `apps/swole/src/components/routines/RoutineForm.tsx` — the controlled container. Key
  integration seams: `handlePatchCard` (line 162, does `{ ...c, ...patch }` — accepts
  a multi-field patch, so a selection can set `name` + `duration` at once),
  `handleTypeChange` (line 148, calls `applyTypeSwitch`), and the focus-ref plumbing
  (`nameInputs` ref + `registerNameInput`, lines 76–83; `handleAddCard` focuses the new
  card's name input via `requestAnimationFrame`). **No change required here** — the
  existing props/handlers already carry everything the picker needs.
- `apps/swole/src/lib/routine-form.ts` — `ExerciseCardState` (the controlled-card type;
  `name`/`duration` are strings), `createEmptyCard` (already defaults sets 3 / reps 10 /
  increment 5), `applyTypeSwitch` (line 105 `base` preserves `name` — the R13 change
  point), `normalizeCard` (cardio minutes→seconds at line 208), `isRoutineFormValid`
  (the save gate — unchanged, still requires non-empty name). **Stays catalog-free** to
  avoid a layering inversion (it must remain the shared client/server validation module).
- `apps/swole/src/lib/format.ts` — duration unit contract: time-based is **seconds**,
  cardio is entered/displayed in **minutes**. The R12 defaults (`'30'`, `'20'`) are raw
  strings written into the `duration` field; `normalizeCard` converts cardio min→sec at
  save.
- `apps/swole/src/lib/format.ts` `DAY_LABELS` (lines 28–36) — the canonical example of a
  client-safe `Record`-shaped static const; the catalog's group-metadata maps follow
  this shape.

### Institutional Learnings

- `docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`
  — its "don't apply when" clause is the relevant signal: **do not** build a heavy
  pure-core/FSM for UI-only presentation logic. The catalog is plain static data plus
  small pure helpers; that is the right altitude. Its honest caveat — matrix-cover every
  public function's inputs, not just the dominant one — applies: test `optionsForType`
  for **all four** types, including the short bodyweight/time-based lists and flat
  cardio.
- `docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`
  — **boundary marker, not triggered.** Confirms this feature touches no DB mutation
  path. Its one transferable thread: keep the catalog client-safe and out of the
  `db/*.ts` runtime path.
- No documented learnings exist for the routine-builder UI, MUI components, MUI
  `Autocomplete`, the client/server boundary, or swole testing conventions — this is a
  good `/ce-compound` candidate after it lands.

### External References

- **MUI `Autocomplete` (v7.3.4, installed)** — there is **zero prior art for
  `Autocomplete` anywhere in the monorepo** (verified grep-clean). The API surface
  below was verified against the installed v7.3.4 type declarations and `useAutocomplete`
  runtime source (not memory); all behaviors are confirmed for v7.3.4 + React 19.2.0:
  - **`groupBy` orders group headers by first appearance in the options array** —
    runtime `reduce` merges only with the *previous* group, so it groups *consecutive*
    equal-key options and does **not** sort groups. Unsorted options produce duplicate /
    misordered headers and a dev `console.warn`. → the `optionsForType` helper must
    return options pre-sorted (group order, then alpha). This is the crux of R3/R5.
  - **Empty groups auto-hide after filtering** — grouping runs on the already
    text-filtered list, so `renderGroup` is never called for a zero-match group. The
    field-level no-match (R6) is handled by `noOptionsText`. The origin's visual-sketch
    line "(no matches in this group)" is illustrative only, not a requirement to render
    empty headers.
  - **Controlled single-select:** with generics `Multiple=false, DisableClearable=false,
    FreeSolo=false`, `value` is `Option | null` and `onChange` is
    `(event, newValue, reason, details) => …` with `newValue: Option | null` (the
    object on select, `null` on clear). `reason`/`details` are unused here.
  - **Object options need `isOptionEqualToValue: (option, value) => boolean`** comparing
    a stable scalar (`option.name === value.name`). Omitting it is the single most common
    Autocomplete-with-objects bug — options are recreated each render, so reference
    equality fails, producing a console warning and a visually unselected state.
  - **`getOptionLabel: o => o.name`** drives both input display and the default substring
    filter (built-in `createFilterOptions` stringifies via `getOptionLabel`).
  - **`renderGroup` receives `{ key: number, group, children }`** where `group` is the
    `groupBy` return value; `key` is a number to use as the React key.
  - **`renderInput` ref forwarding (focus-on-add):** `<TextField {...params}
    inputRef={nameInputRef} />` reaches the underlying `<input>` element and MUI
    *merges* it with its own internal input ref — so the existing `nameInputRef`
    focus-on-add keeps working and Autocomplete's keyboard handling is preserved. Do
    **not** manually overwrite `params.inputProps.ref` (the documented foot-gun);
    `params.InputProps.ref` is the root wrapper, not the input element.
  - **Catalog-only is the default posture:** leaving `freeSolo` unset means typed text
    that doesn't match an option cannot be committed; `clearOnBlur` (defaults to
    `!freeSolo` ⇒ `true`) wipes stray typed text on blur and `autoSelect` (default
    `false`) means blur never commits a highlighted option. No extra props are needed to
    block off-catalog entry (R1/AE2).
  - **v7 deprecations:** `components` / `componentsProps` / `*Component` props are
    deprecated — use `slotProps` if any Paper/Popper/listbox customization is needed (the
    basic catalog use likely needs none).

### Technology & Versions

Next.js 16.2.2 (App Router, standalone), React 19.2.0, `@mui/material` 7.3.4 +
`@mui/icons-material` 7.3.4 (both already present), TypeScript 5.9.3. Tests: Jest
29.7.0 + ts-jest, **`testEnvironment: 'node'`, no jsdom / React Testing Library, and
`testMatch` globs `.ts` only (not `.tsx`)**. Consequence: there is **no component-test
harness** — all feature logic must be exercised through pure `.ts` helpers; the
component swap (U3) is verified by type-check, lint, and a manual dev-deploy
walkthrough.

---

## Key Technical Decisions

- **Object options `{ name, muscleGroup? }`, value derived by lookup-or-null.** The
  Autocomplete operates on catalog-entry objects; the controlled `value` is
  `optionsForType(card.type).find(o => o.name === card.name) ?? null`. Object options
  let `groupBy` read `o.muscleGroup` directly (no name→group lookup map), and
  lookup-or-null cleanly handles off-catalog/legacy names (R15) — they resolve to
  `null` (empty field) with no "value not in options" MUI warning, rather than crashing.
  Object options require `isOptionEqualToValue` comparing by `name` (verified: omitting
  it is the most common objects-in-Autocomplete bug, since options are recreated each
  render). Catalog-only entry needs no extra props beyond leaving `freeSolo` unset — the
  v7 defaults (`clearOnBlur=true`, `autoSelect=false`) already prevent committing typed
  text and wipe stray input on blur.
- **`optionsForType()` pre-sorts to satisfy MUI's `groupBy` ordering.** Because MUI
  orders headers by option-array order, the helper returns a flattened array sorted by
  (muscle-group order index, then name). Cardio returns a flat alphabetical array and
  the component omits `groupBy` for it. This is the single most important pure-logic
  unit and is fully testable.
- **`buildSelectionPatch(card, entry)` pure helper for R11/R12.** Returns `{ name }` for
  weighted/bodyweight, and `{ name, duration: DEFAULT }` for time-based/cardio **only when
  `card.duration === ''`**. `entry` is `CatalogEntry | null`; a `null` entry (deselect via
  the MUI clear "✕") returns `{ name: '' }`. This is the **only place the empty-only
  duration rule and the clear path can be unit-tested** given there's no component harness
  — so both live here, not inline in the component's `onChange`.
- **`DURATION_DEFAULTS` as raw strings** (`{ 'time-based': '30', cardio: '20' }`). The
  card stores `duration` as a string; `normalizeCard` converts cardio min→sec at save.
- **Group metadata co-located in the catalog module** — `MUSCLE_GROUP_ORDER`,
  `MUSCLE_GROUP_LABELS`, and `MUSCLE_GROUP_ACCENT` (the color map) live with the catalog
  data; `renderGroup` looks them up. Keeps "what groups exist and how they're labeled /
  colored / ordered" in one source.
- **`applyTypeSwitch` clears `name` (R13); `routine-form.ts` stays catalog-free.** The
  clear lands in the existing pure helper (one line), preserving the tested seam.
  `routine-form.ts` does **not** import the catalog, so no dependency cycle and no
  layering inversion.
- **Catalog module is client-safe** — plain pure TS, no `'use client'` / no
  `'server-only'`, value-imports only from client-safe modules, `import type` for the
  `ExerciseCardState` type from `routine-form.ts`. Mirrors `routine-form.ts`'s
  documented bundle-safety contract.

---

## Open Questions

### Resolved During Planning

- **Per-group marker (R4):** color-coded accent — a small colored dot per group header,
  one distinct accent color per muscle group. (Chosen over emoji, which is thin for
  Back/Chest/Shoulders, and MUI icons, which lack muscle-specific glyphs.)
- **Duration defaults (R12):** time-based `30` (seconds), cardio `20` (minutes), at the
  type level via `DURATION_DEFAULTS`.
- **Short-list grouping + `groupBy` order (R3/R5):** bodyweight and time-based reuse the
  muscle-group sections; cardio is flat. Ordering guaranteed by pre-sorting in
  `optionsForType` (MUI orders headers by option-array order).
- **Module path/shape (R7):** `apps/swole/src/lib/exercise-catalog.ts`; entry =
  `{ name: string; muscleGroup?: MuscleGroup }`; `EXERCISE_CATALOG` partitioned by type.
- **`applyTypeSwitch` change (R13):** clear `name` + update its unit tests.
- **Content (R9):** ship the enumerated v1 list verbatim; trimming is a trivial
  per-line content edit at the implementer's discretion.
- **`renderInput` ref forwarding (R1 focus-on-add):** confirmed against the installed
  v7.3.4 types — `<TextField {...params} inputRef={nameInputRef} />` reaches the inner
  `<input>` and MUI merges it with its internal ref. No need to touch
  `params.inputProps.ref`.

### Deferred to Implementation

- Exact accent color shades per group (a visual-polish detail; proposed Tailwind
  palette in U1 is directional). Dot vs left-border treatment is likewise polish.
- Whether `optionsForType` is memoized in the component via `useMemo` keyed on
  `card.type` (likely yes, to avoid re-sorting ~70 items each render) — an
  implementation detail with no behavioral effect.
- Verify the swole app's root layout already has MUI's Emotion SSR setup
  (`AppRouterCacheProvider`) — almost certainly present since the app already uses MUI
  heavily, but worth a glance since `Autocomplete` mounts a portal/popper.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not
> implementation specification. The implementing agent should treat it as context, not
> code to reproduce._

**Catalog module shape** (`apps/swole/src/lib/exercise-catalog.ts`):

```text
type MuscleGroup = 'legs-glutes' | 'back' | 'chest' | 'shoulders' | 'arms' | 'core'

MUSCLE_GROUP_ORDER:  MuscleGroup[]                 // Legs/Glutes → Back → Chest → Shoulders → Arms → Core
MUSCLE_GROUP_LABELS: Record<MuscleGroup, string>   // 'legs-glutes' → 'Legs / Glutes', …
MUSCLE_GROUP_ACCENT: Record<MuscleGroup, string>   // 'legs-glutes' → 'bg-orange-500', … (Tailwind bg class)

type CatalogEntry = { name: string; muscleGroup?: MuscleGroup }  // cardio omits muscleGroup
type ExerciseType = ExerciseCardState['type']                    // import type from routine-form

EXERCISE_CATALOG: Record<ExerciseType, CatalogEntry[]>           // the ~100 v1 entries, per origin

DURATION_DEFAULTS: Partial<Record<ExerciseType, string>>         // { 'time-based': '30', cardio: '20' }

optionsForType(type): CatalogEntry[]
  // non-cardio → sort by (MUSCLE_GROUP_ORDER index, then name)
  // cardio     → sort by name (flat, no group)

buildSelectionPatch(card, entry: CatalogEntry | null): Partial<ExerciseCardState>
  // entry === null (deselect / clear) → { name: '' }
  // else base { name: entry.name }
  //   if (type is time-based|cardio) AND card.duration === '' → add duration: DURATION_DEFAULTS[type]
```

**Selection data flow** (no new wiring in `RoutineForm`):

```text
catalog ──optionsForType(card.type)──▶ Autocomplete options (pre-sorted, grouped)
                                          │ user picks entry
                                          ▼
              onChange ─ entry ──▶ buildSelectionPatch(card, entry) ─ patch ─▶ onChange(patch)
                                          │                                       │
                          (null ⇒ { name: '' })                    existing handlePatchCard
                                                                    { ...card, ...patch } ⇒ setCards
                                          ▼
                              save gate re-evaluates (isRoutineFormValid, unchanged)
```

**Per-type picker behavior:**

| Type | `groupBy` applied? | Group order | Within group | Duration default on select (empty only) |
|------|--------------------|-------------|--------------|------------------------------------------|
| weighted | yes | Legs/Glutes → … → Core | alphabetical | — (name only) |
| bodyweight | yes | same order (subset of groups present) | alphabetical | — (name only) |
| time-based | yes | same order (subset present) | alphabetical | `30` (seconds) |
| cardio | no (flat) | — | alphabetical | `20` (minutes) |

---

## Implementation Units

- U1. **Exercise catalog data module + pure helpers**

**Goal:** Add the static, client-safe catalog with group metadata, the type-filtered
ordering helper, and the selection-patch helper — the entire testable core of the
feature.

**Requirements:** R2, R3, R4, R5, R7, R8, R9, R10, R11, R12.

**Dependencies:** None.

**Files:**
- Create: `apps/swole/src/lib/exercise-catalog.ts`
- Test: `apps/swole/src/lib/__tests__/exercise-catalog.spec.ts`

**Approach:**
- Define `MuscleGroup`, `MUSCLE_GROUP_ORDER` (Legs/Glutes → Back → Chest → Shoulders →
  Arms → Core), `MUSCLE_GROUP_LABELS`, and `MUSCLE_GROUP_ACCENT` (proposed Tailwind
  dot-background palette: legs-glutes `bg-lime-500`, back `bg-sky-500`, chest
  `bg-rose-500`, shoulders `bg-amber-400`, arms `bg-violet-500`, core `bg-emerald-500`
  — exact shades are polish, but **avoid `orange-500`**, the app's brand/primary accent,
  so a group dot is never confused with an interactive accent).
- Define `CatalogEntry = { name: string; muscleGroup?: MuscleGroup }` and
  `EXERCISE_CATALOG: Record<ExerciseType, CatalogEntry[]>`, keying `ExerciseType` off
  `ExerciseCardState['type']` via `import type` (no value import from `db/*`).
- Transcribe the v1 contents **verbatim** from origin's "Catalog Contents (v1)" section
  (`docs/brainstorms/2026-05-28-swole-exercise-catalog-requirements.md`, lines 153–183):
  weighted (Legs/Glutes, Back, Chest, Shoulders, Arms, Core), bodyweight (tagged by
  group), time-based (tagged by group), cardio (no group). Names are canonical — copy
  exactly, including punctuation, so they become the one true spelling.
- `optionsForType(type)`: non-cardio → flatten the type's entries and sort by
  `MUSCLE_GROUP_ORDER` index then `name`; cardio → sort by `name` only.
- `DURATION_DEFAULTS` + `buildSelectionPatch(card, entry)` per the design sketch. `entry`
  is `CatalogEntry | null`: a real entry yields `{ name }` (plus the empty-only duration
  default for time-based/cardio); `null` (deselect/clear) yields `{ name: '' }`, so the
  clear path is unit-tested rather than living inline in the component.
- No `'use client'`, no `'server-only'`; follow the import-sort and
  `no-relative-import-paths` (`src/...`) lint rules.

**Patterns to follow:**
- `apps/swole/src/lib/format.ts` — client-safe pure module with `Record`-shaped consts
  (`DAY_LABELS`) and the header comment documenting the no-directive contract.
- `apps/swole/src/lib/routine-form.ts` — the `import type { … } from 'src/db/…'`
  bundle-safety discipline; mirror it for the `ExerciseCardState` type import.

**Test scenarios:** (`exercise-catalog.spec.ts`)
- Happy path — `optionsForType('weighted')` returns entries whose muscle groups appear
  in order Legs/Glutes → Back → Chest → Shoulders → Arms → Core, and entries are
  alphabetical within each group. _Covers AE1._
- Happy path — `optionsForType('cardio')` returns a flat, alphabetically-sorted list
  with no `muscleGroup` on any entry.
- Happy path — `optionsForType('bodyweight')` and `optionsForType('time-based')` return
  grouped, canonically-ordered, within-group-alphabetical lists (exercises the short
  lists, per the FSM-doc matrix caveat).
- Edge case — every non-cardio catalog entry has a `muscleGroup` that is a member of
  `MUSCLE_GROUP_ORDER`; every cardio entry has no `muscleGroup` (data integrity).
- Edge case — `MUSCLE_GROUP_LABELS` and `MUSCLE_GROUP_ACCENT` each have an entry for
  every member of `MUSCLE_GROUP_ORDER` (metadata completeness).
- Happy path — `buildSelectionPatch` for a weighted entry returns `{ name }` only (no
  `duration` key). _Covers R11._
- Happy path — `buildSelectionPatch` for a time-based entry with `card.duration === ''`
  returns `{ name, duration: '30' }`. _Covers AE3._
- Happy path — `buildSelectionPatch` for a cardio entry with `card.duration === ''`
  returns `{ name, duration: '20' }`. _Covers AE3._
- Edge case — `buildSelectionPatch` for a cardio entry with `card.duration === '35'`
  returns `{ name }` only; the existing duration is untouched. _Covers AE4._
- Edge case — `buildSelectionPatch` for a time-based entry with a non-empty
  `card.duration` returns `{ name }` only (empty-only guard, both prefill types).
- Happy path — bodyweight entry through `buildSelectionPatch` returns `{ name }` only.
- Edge case — `buildSelectionPatch(card, null)` (deselect/clear) returns `{ name: '' }`
  for every type, giving the clear path the same unit coverage as the select path.
- Structure — `EXERCISE_CATALOG` permits the same `name` under two types (R10): assert
  the type partition is independent (no cross-type dedup) so a movement can be listed in
  two type sets. _Covers R10._

**Verification:**
- `pnpm --filter @lilnas/swole test` passes with the new spec; `type-check` and `lint`
  clean. Group order and within-group alpha assertions hold for all four types.

---

- U2. **Clear exercise name on type switch (`applyTypeSwitch`, R13)**

**Goal:** Make a card's name clear when its type changes, so a catalog-only field never
displays an unselectable name carried over from the prior type's list.

**Requirements:** R13.

**Dependencies:** None (independent of U1; should land alongside U1/U3 for AE5
correctness).

**Files:**
- Modify: `apps/swole/src/lib/routine-form.ts`
- Test: `apps/swole/src/lib/__tests__/routine-form.spec.ts`

**Approach:**
- Change the `base` object in `applyTypeSwitch` (currently
  `{ id: card.id, type: newType, name: card.name }`, line 105) to set `name: ''`.
- Update the function's comment block (lines 96–100) to state that name is intentionally
  cleared on type switch because each type has its own catalog list.
- Flip the existing name-preservation assertions in `routine-form.spec.ts`: the
  `weighted → bodyweight` test (line 310, `expect(result.name).toBe('Row')`) and the
  `weighted → cardio` test (line 321) become `toBe('')`; update those two test titles to
  reflect clear-on-switch. Add an explicit `expect(result.name).toBe('')` to the other
  `applyTypeSwitch` cases for full coverage.

**Patterns to follow:**
- The existing `applyTypeSwitch` test block (`routine-form.spec.ts:295–387`) — keep the
  table-driven, requirement-tagged style.

**Test scenarios:** (`routine-form.spec.ts` updates)
- Happy path — `weighted → bodyweight` now yields `name === ''` (was `'Row'`); other
  field expectations (sets/reps kept, weight/increment cleared) unchanged. _Covers
  AE5/R13._
- Happy path — `weighted → cardio` now yields `name === ''` (was `'Row'`); `sets === '1'`
  and reps/weight/increment cleared unchanged.
- Edge case — remaining `applyTypeSwitch` cases (`cardio → weighted`,
  `weighted → bodyweight → weighted`, `→ time-based`) each assert `name === ''`,
  confirming clear-on-every-switch.
- Regression (do not drop) — the existing duration-carry assertions ("any → time-based:
  keeps duration from cardio source" and "any → cardio: keeps duration from time-based
  source") must be **preserved verbatim**. U2 changes only `name`; these unrelated
  regression tests must stay green and must not be deleted while editing the block.
- Regression — `createEmptyCard` still produces `name: ''` (unchanged); the
  `isRoutineFormValid` / `normalizeCard` suites still pass (the save gate's non-empty
  name rule is unaffected).

**Verification:**
- `pnpm --filter @lilnas/swole test` green with updated assertions; no other
  `applyTypeSwitch` caller exists (confirmed: only `RoutineForm.handleTypeChange`).

---

- U3. **Swap the name `TextField` for the catalog `Autocomplete` in `ExerciseCard`**

**Goal:** Replace the free-text name field with the catalog-only searchable combobox,
wiring grouping, the color-accent headers, the no-match notice, duration prefill on
select, and preserved focus-on-add.

**Requirements:** R1, R2, R3, R4, R6, R11, R12 (and honors R14/R15 by construction).

**Dependencies:** U1 (options, group metadata, `buildSelectionPatch`); U2 (so a
type switch clears the field — required for AE5).

**Files:**
- Modify: `apps/swole/src/components/routines/ExerciseCard.tsx`

**Approach:**
- Replace the name `TextField` (lines 120–139) with `Autocomplete` (single-select,
  `freeSolo` disabled):
  - `options={optionsForType(card.type)}` (consider `useMemo` keyed on `card.type`);
    `getOptionLabel={o => o.name}`; `isOptionEqualToValue={(o, v) => o.name === v.name}`.
  - Controlled `value = options.find(o => o.name === card.name) ?? null`.
  - `groupBy={o => o.muscleGroup!}` **only when `card.type !== 'cardio'`** (omit for
    cardio so it renders flat); `renderGroup` renders a header with a colored dot
    (`MUSCLE_GROUP_ACCENT[group]`) + `MUSCLE_GROUP_LABELS[group]`, using `cns()` to
    combine the dot's base + accent classes. The dot is decorative — give it
    `aria-hidden` since the text label already names the group (the accent color must
    not be the only group signal).
  - `noOptionsText="No matching exercise — add it to the catalog."` (R6).
  - Leave `freeSolo` **unset** (catalog-only); the v7 defaults (`clearOnBlur=true`,
    `autoSelect=false`) already block committing typed text — no extra props.
  - `onChange={(_, entry) => onChange(buildSelectionPatch(card, entry))}` — the clear
    case (`entry === null`, via the MUI clear "✕") is handled inside `buildSelectionPatch`,
    so the deselect path is unit-tested rather than an untested inline branch.
  - `renderInput` renders a `TextField` matching the current styling (`sx` outline
    borders, `!text-neutral-*` label/input classes, `size="small"`, `fullWidth`,
    `label="Exercise name"`, `error`/`helperText` via `showError('name')`), and
    **forwards `nameInputRef` via `<TextField {...params} inputRef={nameInputRef} />`** —
    this reaches the inner `<input>` and MUI merges it with its internal ref, so
    `RoutineForm.handleAddCard`'s focus-on-add keeps working. Do not overwrite
    `params.inputProps.ref`.
- **Interaction states** (specify so the implementer doesn't guess):
  - After a type switch clears the name (U2), the field renders empty with its label; the
    dropdown stays **closed** and focus is **not** stolen (the Type `Select` keeps focus).
    The user taps the field to pick from the new type's list — do not auto-open.
  - On blur with unmatched typed text, MUI's `clearOnBlur` wipes the text and the field
    returns to empty: this **silent clear is the accepted UX** (the empty field signals
    nothing was saved). No toast, no persistent error.
  - Keep MUI's default clear "✕" and dropdown chevron; the clear "✕" routes through the
    same `onChange(null)` → `{ name: '' }` path (no `disableClearable`).
  - Empty/null state: rely on the label + chevron as the picker affordance (matches the
    Type `Select`); a placeholder string is optional polish, not required.
- Add the `Autocomplete` import (MUI import group) and the catalog imports
  (`src/lib/exercise-catalog`) respecting `simple-import-sort` and
  `no-relative-import-paths`.
- No change to `ExerciseCardProps` or `RoutineForm` — the existing `onChange` patch
  path and `nameInputRef` contract carry everything.

**Patterns to follow:**
- The Type `Select` (`ExerciseCard.tsx:83–106`) and the original name `TextField`
  (120–139) for the exact dark-theme `sx` + `!text-neutral-*` styling to reproduce on
  `renderInput`.
- `RoutineForm.tsx:316` and `DayPicker` for `cns()` usage when combining the dot's
  conditional/accent classes.

**Test scenarios:**
- No automated component test — this is the component layer, and the swole Jest setup is
  `node`-env with no jsdom/RTL and globs `.ts` only, so `ExerciseCard` cannot be rendered
  in Jest. All feature logic is unit-tested in U1 (`optionsForType`, `buildSelectionPatch`)
  and U2 (`applyTypeSwitch`). The manual AE-mapped walkthrough below is therefore this
  unit's **required completion gate** (not optional polish) — treat every line as a merge
  check.

**Verification:** (required manual walkthrough on a dev deploy — maps to acceptance examples)
- `pnpm --filter @lilnas/swole type-check` and `lint` clean; app builds.
- AE1 — on a weighted card, opening the name field shows groups Legs/Glutes → Back →
  Chest → Shoulders → Arms → Core with colored-dot headers, alphabetized within each;
  typing "row" narrows to the Back-group rows.
- Cardio-flat — on a cardio card the list renders **flat** (no group headers),
  alphabetized; confirms the `groupBy`-omitted branch, which is the one behavioral branch
  with no automated coverage.
- AE2 — typing "Kettlebell Swing" (off-catalog) shows the inline no-match notice; name
  stays empty; `Create routine` stays disabled.
- AE3 — selecting "Plank" on a time-based card with empty duration sets name = Plank,
  duration = 30; selecting "Stairmaster" on a cardio card sets duration = 20.
- AE4 — on a cardio card with duration already 35, selecting "Rowing Machine" updates
  the name but leaves duration = 35.
- AE5 — a weighted card with name "Hip Thrust" switched to cardio clears the name and
  lists cardio options.
- Focus — adding a card moves focus to its (now Autocomplete) name input.
- Popup positioning — on a mobile viewport, the dropdown opens within the routine-card
  scroll container without clipping; if the portal/popper clips, adjust placement via
  `slotProps` (first Autocomplete use in the app — no prior art to inherit).

---

## System-Wide Impact

- **Interaction graph:** `ExerciseCard` → `RoutineForm` via the existing
  `onChange(patch)` (selection routes through `handlePatchCard`'s `{ ...card, ...patch }`
  — a single patch can set `name` + `duration`), `onTypeChange` (→ `applyTypeSwitch`,
  now clears name), and `nameInputRef` (must reach the Autocomplete's inner input).
  `RoutineForm` is **unchanged**.
- **Error propagation:** the `name` error still drives the `renderInput` `TextField`
  via `showError('name')`; `submitAttempted` gating unchanged. With catalog-only entry,
  a committed name is always non-empty by construction, so the name error effectively
  only appears for an untouched/empty field on submit.
- **State lifecycle:** focus-on-add (`requestAnimationFrame` → `nameInputs.current[id].focus()`)
  depends on `nameInputRef` reaching the real input element through MUI's
  `renderInput` — the primary regression risk (see Risks). Type-switch clearing means
  the derived Autocomplete `value` becomes `null` (empty field), which is correct.
- **API surface parity:** `ExerciseCardProps` is unchanged, so the future
  `/routines/[id]` edit page inherits the picker with no extra work.
- **Integration coverage:** the select → patch → save-gate chain crosses the
  component/helper boundary; unit tests prove `buildSelectionPatch` and the save gate
  independently, and the manual walkthrough proves the wired behavior (no Jest
  component harness exists to prove it automatically).
- **Unchanged invariants:** `db/schema.ts` (types, CHECK constraint), the atomic-create
  mutation, `exerciseDraftSchema`, `normalizeCard`, `isRoutineFormValid`, and
  `exercises.name` as free text at the DB level — none change. Catalog membership is a
  UI-only gate layered on top.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| MUI 7.3.4 + React 19 `Autocomplete` has no in-repo prior art. | API surface verified against installed v7.3.4 types + `useAutocomplete` runtime source (see External References) — `value`/`onChange`, `isOptionEqualToValue`, `getOptionLabel`, `groupBy`, `renderGroup`, `renderInput`, `noOptionsText`, `freeSolo` defaults all confirmed for v7. Residual: glance that the swole layout has MUI Emotion SSR setup (deferred question). Manual selection walkthrough catches wiring errors. |
| `groupBy` header misordering / duplicate headers if options aren't pre-sorted (confirmed failure mode in v7 runtime — emits a `console.warn`). | `optionsForType` returns options pre-sorted by (group order → alpha); unit-tested for all four types (U1). |
| Forgetting `isOptionEqualToValue` (the most common objects-in-Autocomplete bug) → console warning + visually-unselected state. | Key Technical Decisions + U3 approach mandate `isOptionEqualToValue` comparing by `name`. |
| Focus-on-add regression — `nameInputRef` not reaching the inner input after the swap. | Confirmed pattern: `<TextField {...params} inputRef={nameInputRef} />` reaches the `<input>` and MUI merges refs (don't overwrite `params.inputProps.ref`); manual-verify add-focus (U3 verification). |
| No component-test harness, so AE1–AE6 wired behavior isn't auto-tested. | Push all logic into pure helpers that *are* unit-tested (U1/U2); enumerate AE-mapped manual verification on a dev deploy. Accepted boundary, documented. |
| Off-catalog legacy name on the future edit page resolves to `value = null` (empty field). | Edit page is out of scope; `null` shows an empty field with no crash/warning. Graceful legacy-name display is deferred follow-up work. |
| Pre-existing: `applyTypeSwitch` carries `duration` across a cardio↔time-based switch, but the two types read the string in different units (cardio minutes vs time-based seconds), so a carried value silently changes meaning; the empty-only prefill guard then skips re-defaulting it. | **Unchanged by this plan** — U2 touches only `name`, and this behavior is asserted by existing tests. Flagged for awareness; clearing `duration` on a cardio↔time-based switch is a separate, out-of-scope refinement. |

---

## Documentation / Operational Notes

- No schema, migration, env-var, deployment, or monitoring change. Pure client-side
  additive UI + static data; ships on the next swole dev/prod deploy with no extra
  steps.
- Good `/ce-compound` candidate after landing: a "catalog-only MUI `Autocomplete` with
  type-filtered, muscle-grouped, pre-sorted options + empty-only duration prefill"
  pattern, plus any MUI 7 / React 19 Autocomplete gotchas hit during U3 — fills a
  documented gap (no MUI/Autocomplete learnings exist today).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-28-swole-exercise-catalog-requirements.md](../brainstorms/2026-05-28-swole-exercise-catalog-requirements.md)
- Component to change: `apps/swole/src/components/routines/ExerciseCard.tsx` (name field lines 120–139)
- Container (unchanged, integration seams): `apps/swole/src/components/routines/RoutineForm.tsx`
- Pure helpers to extend / refine: `apps/swole/src/lib/routine-form.ts` (`applyTypeSwitch`), new `apps/swole/src/lib/exercise-catalog.ts`
- Duration unit contract: `apps/swole/src/lib/format.ts`
- Tests: `apps/swole/src/lib/__tests__/routine-form.spec.ts`, new `apps/swole/src/lib/__tests__/exercise-catalog.spec.ts`
- Prior plan (builder this extends): `docs/plans/2026-05-28-001-feat-swole-routine-builder-plan.md`
- Institutional learnings: `docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`, `docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`
