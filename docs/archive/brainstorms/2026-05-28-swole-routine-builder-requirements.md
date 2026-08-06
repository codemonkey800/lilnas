---
date: 2026-05-28
topic: swole-routine-builder
---

# Swole — Routine Builder (Create)

## Problem Frame

Home (Survivor 4) ships with three entry points that all dead-end:
`EmptyState` and the `+ New Routine` button link to `/routines/new`, and
`RoutineCard`'s overflow `Edit` links to `/routines/[id]`. Neither route
exists — the `apps/swole/src/app/` tree has no `routines/` directory at all.
The data layer exposes `createRoutine({name, days})` and `createExercise(...)`,
but there is **no UI anywhere to author a routine**, and exercises can only be
inserted today via `scripts/seed-home.mjs`.

That makes this page the load-bearing gap: until it exists, the app cannot be
used without hand-seeding the database. And a routine with zero exercises is
non-functional — the home card renders no "next up" line and `Start session`
has nothing to run — so the builder must author exercises, not just name and
days. There is currently no other surface on which to add them later.

This brainstorm scopes the **create** flow at `/routines/new`: a name, an
optional day schedule, and one or more exercises across the four exercise
types, saved atomically so a mid-way failure can never leave a half-built
routine. The form is built as a reuse-friendly controlled component so the
deferred `/routines/[id]` edit page comes mostly free later, but only the
create wiring ships here.

---

## Key Flows

- F1. **Build and save a routine**
  - **Trigger:** User taps `Create your first routine` (empty state) or `+ New Routine` (home) and lands on `/routines/new`.
  - **Steps:** User types a routine name, optionally toggles day pills (Mon–Sun), and adds exercises. Each `+ Add exercise` appends an inline card defaulting to `weighted`; the user picks a type, fills the type-specific fields, and reorders or removes cards as needed. When the name is set and at least one card is fully valid, `Create routine` enables. Tapping it persists the routine and all exercises in one transaction and routes back to `/`.
  - **Outcome:** One `routines` row, N `exercises` rows ordered 0..N-1, and one `initial` progression per weighted exercise exist. Home shows the new routine's card with the correct next-up line.
  - **Covered by:** R1, R3, R5, R6, R7, R8, R12, R15, R16, R17, R18.

- F2. **Correct an invalid card before saving**
  - **Trigger:** User taps `Create routine` (or blurs a field) with a partial card — e.g. a weighted exercise missing its starting weight.
  - **Steps:** The blocking field shows an inline error and `Create routine` stays disabled. The user fills the missing field; the error clears and the button enables. Nothing is written until the form is fully valid.
  - **Outcome:** No partial write occurs; the user reaches a valid state and saves, or taps `Cancel` and returns to `/` having written nothing.
  - **Covered by:** R3, R12, R13, R14.

---

## Requirements

**Page composition and routing**

- R1. The page lives at `apps/swole/src/app/routines/new/page.tsx` — a thin server component that renders the client builder form. Layout chrome in `apps/swole/src/app/layout.tsx` is reused as-is; this work does not touch layout.
- R2. The builder is a client component. Create needs no server reads (greenfield); the single write goes through a new server action in `apps/swole/src/actions/routines.ts`. ADR-001 path: no inline Drizzle in the page, no React Query, no client-side data fetching.
- R3. On a successful create, route to `/` (home), where the new routine appears via the action's `revalidatePath('/')`. A `Cancel` affordance also returns to `/` without writing. Cancel is an explicit control, not a reliance on browser-back.
- R4. Mobile-first, single-column. The existing dark/orange theme and `cns()` class-composition conventions are reused; no new theme tokens. Primary actions (`Create routine`, `+ Add exercise`, per-card remove/reorder) are thumb-reachable.

**Routine fields**

- R5. Name is a single required text field. It is trimmed; an empty or whitespace-only name blocks submit and mirrors the `ValidationError` `createRoutine` already throws.
- R6. Days is an optional multi-select of the seven day codes, presented Mon-first as toggle pills styled to match the home day-token look. Selection maps to `DayCode[]`. Zero days selected is valid and persists `days: []` (the schema's `days` column is notNull but accepts an empty array).

**Exercise editor**

- R7. Exercises are authored as a vertical list of inline cards. `+ Add exercise` appends a new card; each card has a remove (trash) control and up/down controls to reorder. The card's submit-time list position becomes its `orderInRoutine`.
- R8. Each card leads with a type selector across the four types, and shows exactly the fields that type requires:
  - **weighted:** name, sets, target reps, starting weight, increment
  - **bodyweight:** name, sets, target reps
  - **time-based:** name, sets, duration
  - **cardio:** name, duration (sets is fixed at 1 and not shown as an editable field)
- R9. Switching a card's type preserves still-applicable values and clears the rest: `name` is always kept; `sets` is kept except when switching to cardio (forced to 1); `target reps` is kept across weighted↔bodyweight; `duration` is kept across time-based↔cardio. Fields that do not apply to the new type are cleared, never left holding stale values.
- R10. A new card defaults to `weighted` with sets / target reps / increment pre-filled to common values and starting weight blank (must be entered). Defaults are conveniences and fully editable. Exact default numbers are planning-tunable.
- R11. Numeric fields accept positive integers, with per-type constraints mirroring the exercises CHECK constraint: `sets >= 1`; cardio `sets = 1`; weighted requires reps + weight + increment; time-based and cardio require duration.

**Validation and save gate**

- R12. `Create routine` is enabled only when the name is non-empty **and** at least one exercise card is fully valid for its type. Days are not required.
- R13. Invalid or partial cards surface inline, field-level errors (on blur and on submit attempt) — the user can see which field of which card blocks the save, not a single opaque form-level error.
- R14. Validation runs client-side for immediate feedback and is re-enforced server-side. The persistence layer — the DB-layer `ValidationError` plus the exercises CHECK constraint — is the authoritative backstop, so a bypassed client can never write an invalid row.

**Persistence (atomic)**

- R15. The routine and all of its exercises are created in a single all-or-nothing transaction. A failure at any point persists nothing — no orphan routine, no partial exercise set.
- R16. Each weighted exercise seeds its `initial` progression row inside the same transaction, identical to the rule `createExercise` applies today (data-layer R20). The "latest progression's starting_weight equals exercises.starting_weight" invariant (R19) holds for the newly created weighted exercises.
- R17. Exercises persist with `orderInRoutine` equal to their submit-time list position — 0-indexed and contiguous.
- R18. A new server action wraps the mutation and calls `revalidatePath('/')`. On error it surfaces a tagged error that the form maps to a toast via a new `mapCreateRoutineError` helper alongside the existing `mapStartSessionError` / `mapArchiveRoutineError`.

**Form reuse seam**

- R19. The builder is a controlled component that accepts `initialValues` and a submit-action prop, so a future `/routines/[id]` edit page can reuse it. Only the create wiring (empty defaults + the new create action) ships now; the edit page is not built.

---

## Visual sketch

```
┌──────────────────────────────────────────────┐
│  [Swole]                                     │  ← existing nav (layout.tsx)
├──────────────────────────────────────────────┤
│  New routine                          Cancel │  ← R3
│                                              │
│  Name                                        │  ← R5
│  ┌────────────────────────────────────────┐  │
│  │ Push Day                               │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Days (optional)                             │  ← R6
│  [Mon] (Tue) [Wed] (Thu) [Fri] (Sat) (Sun)   │     selected = orange
│                                              │
│  Exercises                                   │  ← R7, R8
│  ┌────────────────────────────────────────┐  │
│  │ [ weighted ▾ ]                  ↑ ↓ 🗑  │  │
│  │ Name  [ Bench Press            ]        │  │
│  │ Sets [3]  Reps [10]                     │  │
│  │ Weight [105] lb   + [5]                 │  │  ← weighted fields (R8)
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ [ cardio ▾ ]                    ↑ ↓ 🗑  │  │
│  │ Name  [ Treadmill              ]        │  │
│  │ Duration [30] min                       │  │  ← cardio: no sets (R8)
│  └────────────────────────────────────────┘  │
│  [ + Add exercise ]                          │
│                                              │
│  [           Create routine            ]     │  ← R12 (disabled until valid)
└──────────────────────────────────────────────┘
```

---

## Acceptance Examples

- AE1. **Covers R8, R11.** A card set to `cardio` shows only name and duration; there is no editable sets field, and the persisted row has `sets = 1`.
- AE2. **Covers R9.** A weighted card with name="Row", sets=3, reps=10, weight=95, increment=5 is switched to `bodyweight`. Result: name, sets, and reps are retained; weight and increment are cleared and their fields disappear.
- AE3. **Covers R9.** The same weighted card is instead switched to `cardio`. Result: name is retained; sets is forced to 1; reps, weight, and increment are cleared; a duration field appears empty.
- AE4. **Covers R15, R16, R17.** Saving a routine with cards [weighted, weighted, cardio] writes exactly: one `routines` row; three `exercises` rows with `orderInRoutine` 0, 1, 2; two `progressions` rows (`reason='initial'`) for the weighted exercises; and the cardio row with `sets = 1`.
- AE5. **Covers R12, R13.** With a valid name and a single weighted card missing its starting weight, `Create routine` is disabled and the weight field shows an inline error. Entering a weight clears the error and enables the button.
- AE6. **Covers R15.** If a constraint violation slips past client validation (or any step of the transaction fails), the whole create rolls back — no `routines` row and no `exercises` rows remain for that attempt.
- AE7. **Covers R6, R12.** A valid name plus one valid exercise and zero days selected saves successfully. The resulting routine renders on home with no day pills and no "today" highlight.

---

## Success Criteria

- On a fresh dev deploy (`docker-compose -f docker-compose.dev.yml up -d swole`) against a clean database, the home empty state's CTA opens `/routines/new`; creating a routine with a name and a few exercises returns to home with that routine's card showing the correct name, days, exercise count, and next-up line, and `Start session` on it succeeds (the runner page itself may 404 in interim deploys).
- Atomicity holds under failure: a forced mid-create error (e.g. an injected invalid exercise) leaves zero new rows — verifiable in `swole.db`.
- `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` all pass. The new `createRoutineWithExercises` mutation and the shared validation schema have tests; the Survivor 3 data-layer suite still passes unchanged. Form-rendering tests are not required — the form is glue over tested helpers and a tested mutation.
- The next swole brainstorm (the runner) starts without re-litigating how routines and exercises are created: the editor shape, save gate, atomic-create contract, and reuse seam are settled here.

---

## Scope Boundaries

- No edit-page wiring. `/routines/[id]` is not built; the form is made reuse-ready but editing an existing routine (loading initial values, archiving/reordering existing exercises) is a separate brainstorm.
- No drag-and-drop reorder. Up/down controls only; pointer-based drag (and any dependency it needs) is deferred.
- No archived-routine restore, no "show archived" anything — that belongs on the future routine detail/edit page.
- No templates, "duplicate exercise", or "copy from another routine" shortcuts.
- No exercise-name library or autocomplete; names are free text.
- No unsaved-changes navigation guard in v1. `Cancel` is explicit; browser-back may drop in-progress input. A lightweight guard is a possible later nice-to-have.
- No unit choice — weight is lb only (matching `format.ts`). No per-exercise notes, rest timers, supersets, RPE, or tempo.
- No rep ranges — `target_reps` is a single integer per the schema.
- No runner or stats work. Downstream pages the created routine links into may 404 during interim deploys.
- No new dependencies and no theme changes; the page composes existing MUI + Tailwind primitives.
- No client-side data-fetching libraries.

---

## Key Decisions

- **Atomic single-transaction create over client orchestration.** A new `createRoutineWithExercises({name, days, exercises})` mutation (extending `apps/swole/src/db/routines.ts`) inserts the routine, its exercises, and each weighted exercise's initial progression in one transaction. Rejected: client-side `createRoutine` followed by N × `createExercise` — it can half-create a routine on a mid-way failure (and an exercise-less routine is non-functional with no surface to repair it), costs N+1 round-trips, and fires multiple `revalidatePath` calls. One transaction means no orphans, one round-trip, and it matches the codebase's transactional discipline (`createExercise` already wraps its progression seed in a tx). Planning may extract a shared `tx`-level `insertExerciseWithInitialProgression` helper so the weighted→initial-progression rule (R16) is not duplicated between the two mutations.
- **Inline stacked cards (Q2/A).** Chosen over a summary-list + edit-drawer and a flat repeating fieldset. At ~4–6 exercises, everything-visible beats hidden-behind-a-drawer, it reuses the home card styling, and it is the fewest-taps option on mobile.
- **Save gate = name + ≥1 valid exercise; days optional (Q3/A).** Enforces "no dead-end routines" while leaving `days: []` valid, since un-scheduled routines are legitimate and forcing a schedule over-constrains.
- **Full builder authors exercises now (Q1/B), not name+days-first.** The exercise editor is unavoidable for the app to function, and there is no other surface to add exercises today; a name+days-only v1 would ship a dead end.
- **Built reuse-friendly but edit not wired (Q1/B over C).** The controlled `initialValues` + submit-action shape keeps the future edit page cheap without paying to build it now (YAGNI).
- **Type-switch preserves applicable fields and clears the rest (R9).** Avoids silent stale values that would violate the CHECK constraint, and avoids re-typing fields shared across types.

---

## Dependencies / Assumptions

- Survivors 1–3 are merged: the Next.js scaffold, the FSM, and `apps/swole/src/db/{routines,exercises,progressions}.ts` plus their `actions/` wrappers exist and are tested. This work extends `db/routines.ts` and `actions/routines.ts`.
- `createRoutine`'s name validation and `createExercise`'s discriminated `CreateExerciseArgs` shape (plus the exercises CHECK constraint) are the validation contract the new mutation reuses and mirrors.
- `zod` is already a dependency. A single discriminated-union schema mirroring the four exercise variants is the natural source for both client validation and the new mutation's args typing; its module location is a planning-time call.
- The home page already targets `/routines/new` and `/routines/[id]`; no home changes are required beyond what Survivor 4 shipped.
- Weight unit is lb and duration is stored as `durationSeconds`, consistent with `apps/swole/src/lib/format.ts`.
- Traefik forward-auth is the only auth gate; the page assumes "this is Jeremy" and makes no per-row authorization checks.
- Verified against `apps/swole/src/db/schema.ts`: `routines.days` is a notNull JSON column that accepts an empty array; the exercises CHECK enforces type-conditional field presence and cardio `sets = 1`; and `createExercise` already seeds the `initial` progression for weighted exercises. No schema changes are required for this work.

---

## Outstanding Questions

### Resolve Before Planning

_None. All product decisions are settled._

### Deferred to Planning

- [Affects R6][Technical] Days-picker primitive — MUI `ToggleButtonGroup` vs custom pills reusing the home day-token classes — and exact Mon-first rendering.
- [Affects R8, R10][Technical] Duration input units: enter time-based in seconds (displays `Ns`) but cardio in minutes (stored ×60, displays `N min`) so each input matches its type's formatter in `format.ts`. Default: time-based = seconds, cardio = minutes.
- [Affects R10][Technical] Exact default values for a new card (e.g. sets 3 / reps 10 / increment 5) and whether starting weight defaults to blank or 0.
- [Affects R7][Technical] Reorder controls are up/down now; drag-and-drop is deferred and would need a dependency or custom pointer handling.
- [Affects R14][Technical] Where the shared zod schema lives (`src/lib/` vs a new `src/validation/`) and how its discriminated union feeds both the client and the new mutation's args type.
- [Affects R15, R16][Technical] Whether to extract a shared `insertExerciseWithInitialProgression(tx, …)` helper used by both `createExercise` and `createRoutineWithExercises`, or to inline the progression seed in the new mutation.
- [Affects R18][Editorial] Toast copy and which tagged errors `mapCreateRoutineError` distinguishes (create has no active-session conflict, so likely just generic failure + validation).
- [Affects R3][Technical] Unsaved-changes guard: none in v1, or a lightweight `beforeunload` / route-change confirm if it proves cheap. Default: none.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
