---
date: 2026-05-29
topic: swole-routine-edit
---

# Swole — Routine Editing (Edit existing routine)

## Problem Frame

`RoutineCard`'s overflow menu already ships an `Edit` item linking to
`/routines/[id]` (`apps/swole/src/components/home/RoutineCard.tsx:197`), but
that route does not exist — `apps/swole/src/app/routines/` contains only
`new/`. The affordance is a live dead-end: tapping `Edit` 404s. This is the
next load-bearing gap, exactly as `/routines/new` was before the builder
shipped. Until it exists, a routine is immutable once created — a typo'd name,
a wrong starting weight, an extra set, or a swapped exercise can only be fixed
by hand-editing `swole.db`.

The notable starting condition: the **entire editing data + actions layer is
already built and tested**. `getRoutineWithExercises`, `updateRoutine`,
`updateExercise` (which records a `manual_edit` progression when a weighted
exercise's starting weight changes), `archiveExercise` and `reorderExercises`
(both of which refuse while an active session references the routine),
`createExercise`, and the reusable `insertExerciseWithInitialProgression` all
exist in `apps/swole/src/db/{routines,exercises}.ts`, each with an
`actions/` wrapper that revalidates `/routines/[id]`. The create form
(`RoutineForm`) was deliberately built edit-ready: it accepts `initialValues`,
a `submitAction`, and a `submitLabel`, and already renders "Edit routine".

This brainstorm scopes the **edit** flow at `/routines/[id]`: load an existing
routine into the builder form, let the user change everything the builder can
author, and persist the full set of changes in one atomic "Save changes". The
chosen model reuses the create form verbatim — so editing looks and behaves
identically to building — and applies the difference between the loaded state
and the submitted state in a single all-or-nothing transaction. Removal is
soft (archive, never delete) because past sessions reference exercises; editing
is blocked while a session is in progress; and unlike create, the page guards
against losing unsaved changes.

---

## Key Flows

- F1. **Edit a routine and save**
  - **Trigger:** User opens the home card's `Edit` menu item and lands on `/routines/[id]` for a routine with no active session.
  - **Steps:** The form loads pre-filled with the routine's name, day pills, and an exercise card per non-archived exercise (each tagged with its DB id). The user edits freely — rename, toggle days, change an exercise's sets/reps/weight, add a new exercise, remove an existing one, drag to reorder. `Save changes` enables once the form is valid (name + ≥1 valid exercise).
  - **Outcome:** One transaction updates the routine's name/days; updates changed existing exercises (writing a `manual_edit` progression if a weighted starting weight changed); inserts new exercises (seeding an `initial` progression for weighted); archives existing exercises the user removed; and sets `order_in_routine` for every surviving and new exercise to its final list position. The page routes to `/`, which shows the edits via revalidation. Past `set_logs` and `progressions` are untouched.
  - **Covered by:** R1, R2, R3, R4, R5, R8, R9, R10, R11, R12, R13, R14.

- F2. **Attempt to edit during an active session** *(blocked path)*
  - **Trigger:** User opens `/routines/[id]` for a routine that currently has an active (incomplete) session.
  - **Steps:** The page detects the active session and renders a blocked state — a banner explaining the in-progress session must be finished or abandoned first — with `Save changes` disabled. No edits can be submitted.
  - **Outcome:** Nothing is written. The user resolves the session (from the home resume banner or the session runner) and returns to edit.
  - **Covered by:** R15, R16.

- F3. **Leave with unsaved changes** *(escape path)*
  - **Trigger:** User has made at least one change and taps `Cancel`, presses browser-back, or closes the tab.
  - **Steps:** A confirm prompt asks whether to discard unsaved changes. Confirming leaves to `/` and discards the diff; dismissing stays on the form. A pristine (unchanged) form leaves immediately with no prompt.
  - **Outcome:** No partial write; the user either keeps editing or abandons cleanly.
  - **Covered by:** R17.

---

## Requirements

**Routing and page composition**

- R1. The page lives at `apps/swole/src/app/routines/[id]/page.tsx` — a server component that loads `getRoutineWithExercises({ id })`, maps the rows into the form's card model, and renders `RoutineForm` with `submitLabel="Save changes"`. A non-numeric or non-existent id resolves to `notFound()`.
- R2. `RoutineForm` is reused as-is — its `initialValues` / `submitAction` / `submitLabel` seam, drag-reorder, add/remove, per-card validation, and save gate. Create and edit share one form; there is no edit-specific fork of the form component.
- R3. On a successful save, route to `/` (home), where edits appear via the action's revalidation. An explicit `Cancel` returns to `/`. (Mirrors create's routing.)

**Loading existing state into the form**

- R4. Each non-archived `ExerciseRow` maps to an `ExerciseCardState`, inverting the create-time normalization: numbers render as strings, **cardio `durationSeconds` displays as minutes** (÷60), and time-based `durationSeconds` displays as seconds — so a loaded card round-trips through `normalizeCard` to the same stored value.
- R5. Each loaded card carries its **DB exercise id**; a card added during the edit session carries **no DB id**. This identity is what lets save diff the submitted list against the persisted state. *(Structural: enables the diff in R12.)*
- R6. A weighted card's starting weight loads from the exercise's canonical `startingWeight`, which the data layer keeps equal to the latest progression (verified invariant). The editor always shows the current baseline, never a stale initial value.
- R7. Archived exercises are excluded from the editor (the load reads non-archived only). There is no show-archived or restore affordance in v1.

**Editing semantics**

- R8. The exercise-type selector is **locked on existing cards** (those with a DB id); only newly-added cards may choose a type. `updateExercise` cannot change `type`, and a type change on an exercise with logged history is incoherent — to change type, remove (archive) the exercise and add a new one.
- R9. Removing a card with a DB id archives that exercise (`archivedAt` set; its `set_logs` and `progressions` remain, FKs intact). Removing a card with no DB id simply drops it (nothing was persisted). No hard delete is offered, and removal needs no extra confirmation beyond the unsaved-changes guard.
- R10. The save gate is unchanged from create: name non-empty **and** at least one valid exercise. A routine cannot be saved down to zero exercises — archiving the last exercise disables `Save changes`.
- R11. Changing a weighted exercise's starting weight records a `manual_edit` progression row, silently — consistent with the existing data-layer behavior and the latest-progression invariant. No new UI explains this in v1.

**Atomic save (the diff)**

- R12. A new `updateRoutineWithExercises` data-layer mutation applies the full diff in one `BEGIN IMMEDIATE` transaction: update the routine's name/days; update each existing card's changed fields (writing a `manual_edit` progression when a weighted starting weight changed); insert each new card (seeding an `initial` progression for weighted via `insertExerciseWithInitialProgression`); archive each existing exercise absent from the payload; and set `order_in_routine` for every surviving and new exercise to its final list index. All-or-nothing — a failure at any step persists nothing.
- R13. The mutation re-enforces validation server-side via `routineFormSchema.safeParse` (mirroring `createRoutineWithExercises`) and reuses `insertExerciseWithInitialProgression` plus `updateExercise`'s manual-edit-progression rule, so a bypassed client can never write invalid rows and the weighted→progression rules are not re-derived divergently.
- R14. A new `updateRoutineWithExercises` server action wraps the mutation, returns the `ActionResult` envelope, and revalidates both `/` and `/routines/[id]`. The form maps a failure result to a toast (extending `mapCreateRoutineError` or adding a sibling mapper).

**Active-session guard**

- R15. When the routine has an active (incomplete) session, the edit page renders a blocked state: a banner directing the user to finish or abandon the in-progress session first, with `Save changes` disabled. (Archive and reorder already throw `*BlockedByActiveSession`; blocking the whole page keeps the single atomic save coherent rather than partially-applicable.)
- R16. The active-session check is re-enforced inside the mutation (defense in depth): if a session became active between page load and save, the mutation refuses the entire save and the form surfaces a conflict toast.

**Unsaved-changes guard**

- R17. The edit page warns before discarding unsaved edits. Navigating away while the form is dirty — via `Cancel`, browser back, or tab close — prompts a confirm; a pristine form navigates freely. (New behavior vs create, which deliberately had no guard; editing loads real data and is loss-sensitive.)

---

## Visual sketch — the save diff

The page renders the builder form (see the routine-builder requirements for the
form layout), pre-filled, plus a blocked banner when a session is active. The
genuinely new machinery is how `Save changes` translates the submitted card
list into database operations:

| Submitted card | Matching DB exercise | Operation on save |
|---|---|---|
| has DB id, fields changed | exists, non-archived | `UPDATE` changed fields (+ `manual_edit` progression if a weighted starting weight changed) |
| has DB id, fields unchanged | exists | no field write; still assigned its final `order_in_routine` |
| no DB id (added this session) | — | `INSERT` exercise (+ `initial` progression if weighted) |
| — | exists, non-archived, **absent** from submission | `archivedAt = now` (soft delete; history preserved) |
| every surviving + new card | — | `order_in_routine` ← final list index, contiguous from 0 |

All rows above execute in one `BEGIN IMMEDIATE` transaction (R12).

---

## Acceptance Examples

- AE1. **Covers R12, R9.** A routine loads as [weighted Bench, bodyweight Pushups, cardio Treadmill]. The user renames the routine, changes Bench sets 3→4, removes Pushups, adds a new time-based Plank, and drags Treadmill above Bench, then saves. Result, in one transaction: `routines.name` updated; Bench `sets=4` (no weight change → no new progression); Pushups `archivedAt` set (its `set_logs` remain); a new Plank exercise inserted; and `order_in_routine` set to 0,1,2 over [Treadmill, Bench, Plank].
- AE2. **Covers R11, R6.** Changing Bench's starting weight 100→110 and saving produces `exercises.startingWeight = 110` and exactly one new `manual_edit` progression row with `startingWeight = 110`; the latest-progression-equals-exercise invariant holds. Saving with no weight change writes no new progression row.
- AE3. **Covers R8.** An existing weighted card's type selector is disabled. A card added during this edit session can select any of the four types.
- AE4. **Covers R9.** Removing the just-added Plank card before saving writes nothing for it. Removing the existing Pushups card archives that exercise; a later query with `includeArchived` still finds it and its set-log history.
- AE5. **Covers R10.** Removing exercises until none remain valid disables `Save changes`; a zero-exercise routine cannot be persisted.
- AE6. **Covers R15.** Opening `/routines/[id]` for a routine that has an active session shows the blocked banner with `Save changes` disabled; no edit can be submitted from that state.
- AE7. **Covers R12.** If a constraint violation slips past client validation or any step of the transaction fails, the entire save rolls back — no field update, no archive, no insert, and no reorder persists for that attempt.
- AE8. **Covers R4.** A cardio exercise stored as `durationSeconds = 1800` loads showing `30` in its duration (minutes) field; saving it unchanged round-trips back to `1800` seconds.

---

## Success Criteria

- From home, the `Edit` menu opens a populated `/routines/[id]`; the user can rename, reschedule, add/remove/reorder exercises, and fix a starting weight, then `Save changes`, and home reflects every change — while all past session history (`sessions`, `set_logs`, `progressions`) remains intact. Removing an exercise never breaks a past session's data.
- Atomicity holds under failure: a forced mid-save error leaves the routine exactly as it was before the attempt — verifiable in `swole.db`.
- The active-session guard works in both directions: the page is blocked while a session is live, and the mutation refuses a save if a session became active after load.
- The unsaved-changes guard prompts on dirty navigation and stays silent on a pristine form.
- `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` all pass. The new `updateRoutineWithExercises` mutation and its diff have tests; the existing data-layer suites pass unchanged.
- Downstream handoff: planning can implement without re-deciding the diff rules, the type-lock, remove-as-archive semantics, the active-session handling, or the guard behavior — only the technical questions below remain.

---

## Scope Boundaries

- No archived-**exercise** show or restore, and no `unarchiveExercise` mutation — deferred. Archived exercises simply disappear from the editor.
- No editing or restoring an archived **routine**. `/routines/[id]` for an archived routine is treated as not-available (exact handling — `notFound()` vs redirect — is a planning detail). Home never links to it, since it lists only non-archived routines.
- No type change on an existing exercise — replace it (archive + add) instead.
- No hard delete anywhere (FKs are `onDelete: restrict`; deletion is not offered).
- No editing while a session is active — the page is blocked, not partially editable. (Rejected the "allow safe edits, disable only structural ones" variant for v1.)
- `/routines/[id]` is an edit form only — no routine detail / stats / history view, no `Start session` or `Archive` controls (those stay on the home card).
- No editing of past session data or set logs — they are immutable snapshots.
- No dedicated weight-progression management UI — the `manual_edit` write on a weight change is silent.
- Carried over from the builder, unchanged: no templates / duplicate / copy-from-routine, no exercise-name autocomplete, lb-only weight, single integer `target_reps`, no notes / rest timers / supersets / RPE / tempo.

---

## Key Decisions

- **Reuse the builder form with one atomic "Save changes" (Q1, Q2).** The edit page reuses `RoutineForm` verbatim and applies the loaded-vs-submitted diff in a single new `updateRoutineWithExercises` transaction. Gives full visual and behavioral parity with create, and makes a partial edit impossible. Rejected: (a) granular live edits on a detail page — diverges from create's UX and leaves the reuse seam unused, though it would fit the already-built granular mutations more directly; (b) archive-all + recreate-all on every save — simplest (no diff) but mints fresh exercise rows each save, orphaning `set_logs` from the live exercise and breaking progression continuity, which is fatal for a progression-tracking app.
- **Remove = archive existing / drop new, silent (Q3).** History is FK-protected, so soft delete is the only correct removal; a never-saved card has nothing to archive. No scary confirm — the unsaved-changes guard is the only gate.
- **Block the page during an active session (Q4).** Cleanest mental model, matches the atomic-save spirit, and mid-session editing is a rare solo-user edge. Rejected the more permissive "allow field edits, disable structural" split as not worth the UI complexity for v1.
- **Lock type on existing exercises (Q5).** `updateExercise` has no `type` parameter and a typed exercise's history can't be reinterpreted; replace via archive + add.
- **Full parity (Q6); no archived-exercise restore (Q7); keep the ≥1-exercise gate (Q8); silent `manual_edit` on weight change (Q9); pure edit form routing back to `/` (Q11).**
- **Add an unsaved-changes guard (Q10 — overrides the create-time default of none).** Editing loads real data and a stray navigation loses a real diff, unlike a from-scratch create.

---

## Dependencies / Assumptions

- The routine builder is merged: `RoutineForm`, `apps/swole/src/lib/routine-form.ts` (the `routineFormSchema`, `normalizeCard`, `toCreateExerciseArgs`, `createEmptyCard`), and `createRoutineWithExercises` exist and are tested.
- The editing data + actions layer already exists and is tested, and this work builds on it: `getRoutineWithExercises({ includeArchived })`, `updateRoutine`, `updateExercise` (+ `manual_edit` progression), `archiveExercise`, `reorderExercises`, `createExercise`, `insertExerciseWithInitialProgression`, and their `actions/{routines,exercises}.ts` wrappers. This work adds the page, the card model's DB-id seam (R5), and the new atomic `updateRoutineWithExercises` mutation + action. The per-operation granular action wrappers may go unused by the edit page, which is acceptable.
- **Verified** (`apps/swole/src/db/progressions.ts:58-61` + `prd-walkthrough.spec.ts:280`): the latest progression's `starting_weight` always equals `exercises.starting_weight` (maintained across `initial` / `session_progression` / `manual_edit`), so loading `exercises.startingWeight` shows the correct current baseline (R6).
- **Verified**: `UpdateExerciseArgs` has no `type` field and the exercises CHECK ties `type` to column nullness, so type is immutable in place (R8).
- **Verified**: `RoutineCard` already links `Edit → /routines/[id]`; no home change is required.
- **Verified**: `RoutineForm` already accepts `initialValues` / `submitAction` / `submitLabel` and renders "Edit routine"; reuse only needs the card model to carry a DB id (R5).
- **Verified**: no `updateRoutineWithExercises` mutation and no `unarchiveExercise` mutation exist today — both are net-new if needed (the latter is out of scope).
- Traefik forward-auth is the only gate; the page assumes "this is Jeremy" and makes no per-row authorization checks.
- Weight unit is lb; cardio duration is entered in minutes and stored as seconds — unchanged from the builder.

---

## Outstanding Questions

### Resolve Before Planning

_None. All product decisions are settled._

### Deferred to Planning

- [Affects R5][Technical] How the card model carries identity — extend `ExerciseCardState` with an optional `dbId`, or hold a parallel card-id→exercise-id map — without disturbing create's empty-card path.
- [Affects R12][Technical] Exact args shape and location of `updateRoutineWithExercises` (e.g. `RoutineFormValues` plus a parallel id list, or a richer per-exercise payload), and whether to factor a shared `applyExerciseDiff(tx, …)` helper.
- [Affects R14, R16][Technical] Error taxonomy for edit-during-active-session — a new `EditBlockedByActiveSession` vs reusing an existing `forbidden_transition` error — and which `mapCreateRoutineError` sibling the form uses for it.
- [Affects R15][Technical] How the page detects the active session for the block (reuse `activeSessionCountForRoutine` via a read), and whether the banner should name the active session and link to resume it.
- [Affects R17][Technical] Unsaved-changes guard mechanism — dirty-state diff + `beforeunload` + Next.js route-change interception — and the exact definition of "dirty" (any field differs from the loaded snapshot, including reorder).
- [Affects R4][Technical] Where the `ExerciseRow → ExerciseCardState` mapper lives (extend `routine-form.ts` as the inverse of `normalizeCard` / `toCreateExerciseArgs`), and handling of a legacy cardio `durationSeconds` that is not a clean multiple of 60 (create always stores multiples, so this is an edge).
- [Affects R1][Technical] `[id]` param parsing and the archived-routine response (`notFound()` vs redirect to `/`).

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
