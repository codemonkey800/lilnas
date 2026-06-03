---
title: 'feat: Swole session state machine — pure FSM for set actions and post-session progression'
type: feat
status: active
date: 2026-05-26
deepened: 2026-05-26
origin: docs/brainstorms/2026-05-26-swole-session-machine-requirements.md
---

# feat: Swole session state machine — pure FSM for set actions and post-session progression

## Overview

Extract the rules of the active-session game into a single pure-TypeScript module at `apps/swole/src/core/session-machine.ts`. The module exposes four public functions — `applyAction`, `undo`, `nextTarget`, `classifyPostSession` — plus an `initialState()` helper, and is the single source of truth for: how Increment / Stay / Decrement / Complete / Failed / Hold / Done / Skipped affect the next set's weight, when a session is "complete", and what the post-session weight-progression prompt should say. The active-session UI (Survivor 4) and the server action that persists a completed session (Survivor 4) both import this module unchanged — no rule lives in two places.

This is the only place in v1 where a logic slip writes wrong data to SQLite forever, so the contract is pinned by an exhaustive table of (action × exercise type × set position) tests plus two named fixtures encoding PRD F2 and F3 verbatim. No React, no NestJS, no SQLite — the module ships, gets reviewed against the table, and stays still while everything around it grows.

---

## Problem Frame

Three downstream consumers all need to agree on the per-set rules: the active-session client component (renders the next target, dispatches actions on tap), the `/session/[id]` server action (persists the completed session's set logs), and the post-session prompt UI (asks the user about progression). If any two diverge — e.g., the UI bumps the weight on Increment but the server action persists the pre-bump weight, or the post-session prompt's "lowest weight" calculation drifts from the runner's "stay at SW" notion — the SQLite row written is wrong. There is no rollback in v1; the user lives with corrupted history.

The fix is to keep the rules in one module, behind a small functional API. State is `{ setLogs: SetLog[] }` and nothing else — every derived value (current cursor, current target weight, "is the session finished") is computed on read. The `SetLog` shape carries every domain field the planned `set_logs` Drizzle row needs (weight, reps, actualReps, duration, action), so when Survivor 3 lands the schema, persistence is a name-rename map plus housekeeping-column attachment (`id`, `session_id`, `logged_at`) and `exerciseIdx`/`setIdx` → FK resolution — not a re-derivation of business rules that could disagree with the FSM.

This module also unblocks Survivor 3's schema design: rather than designing `set_logs` in the abstract, Survivor 3 reads `SetLog` from this module and lifts it into Drizzle. (Origin: rationale in Problem Frame and Key Decisions blocks of the requirements doc.)

---

## Requirements Trace

- R1. Module lives at `apps/swole/src/core/session-machine.ts`. Pure TypeScript: no React, no NestJS, no Drizzle, no `better-sqlite3` imports.
- R2. Public API: four pure functions — `applyAction`, `undo`, `nextTarget`, `classifyPostSession`. Plus types: `SetLog`, `SessionState`, `Action`, `Routine`, `Exercise`, `PostSessionPrompt`. Also exports `initialState()` (resolved planning question — see Open Questions).
- R3. `SessionState = { setLogs: SetLog[]; cursorOverride?: number }`. `setLogs` is the canonical history; `cursorOverride` is set by the `JumpTo` action and cleared the moment any other action dispatches. Apart from these two fields, all other state (current target weight, "is the session finished") is derived.
- R4. `SetLog` shape: `{ exerciseIdx, setIdx, weight?, reps?, actualReps?, duration?, actualDuration?, action }`. Carries every domain field the future SQLite `set_logs` row needs (one-to-one mapping: `weight`, `reps`/`target_reps`, `actualReps`/`actual_reps`, `duration`/`duration_seconds`, `actualDuration`/`actual_duration_seconds`, `action`); Survivor 3 lifts the shape into Drizzle, attaches housekeeping columns (`id`, `session_id`, `logged_at`), and resolves `exerciseIdx`/`setIdx` to `exercise_id`/`set_number` via routine lookup. `actualReps` is set only on weighted/bodyweight `Failed`; `actualDuration` is set only on time-based `Failed`. Splitting the field avoids the semantic overload that would otherwise force `exercise.type`-aware rendering downstream.
- R5. `Action` is a discriminated union of the eight PRD button labels plus `JumpTo`. The seven simple-button actions (`Increment`, `Stay`, `Decrement`, `Complete`, `Hold`, `Done`, `Skipped`) carry no payload; `Failed` carries `{ actualReps: number }`; `JumpTo` carries `{ exerciseIdx: number }` and moves the cursor without appending a `SetLog`.
- R6. `applyAction(state, action, routine) → SessionState` is pure (no input mutation). For the seven simple-button actions and `Failed`, it appends one new `SetLog` to `state.setLogs` and returns the new state with any prior `cursorOverride` cleared. For `JumpTo`, it does NOT append a log — it returns `{ setLogs: state.setLogs, cursorOverride: action.exerciseIdx }`. This single rule keeps the FSM's append-only history invariant intact (any prefix of `setLogs` is a valid `SessionState`) while letting the UI jump the cursor freely.
- R7. New log's weight comes from the last `SetLog` for the same `exerciseIdx`: `Increment` → prior + increment, `Decrement` → prior − increment, anything else → prior unchanged. If no prior log for that exercise, use the routine's `startingWeight`. Bodyweight / time-based / cardio ignore weight entirely.
- R8. `Failed` records `actualReps`. Next set's weight is computed as if the prior action were `Stay`.
- R9. `applyAction` only appends. Cursor advance, cross-exercise transitions, session-finished — all derived via `nextTarget`.
- R10. `undo(state) → SessionState` removes the last `SetLog`. Empty state returns input unchanged.
- R11. No separate undo stack. No redo in v1.
- R12. `nextTarget(state, routine) → { weight?, reps?, duration?, exerciseIdx, setIdx } | null` returns what the UI should render next, using R7's rules. If `state.cursorOverride` is set, the active exercise is `routine.exercises[state.cursorOverride]` (the user's chosen jump target) and `setIdx` is the count of logs already on that exercise. Otherwise the active exercise is the first one with `count < sets` (the normal walk).
- R13. Returns `null` when every (exerciseIdx, setIdx) prescribed by the routine has a corresponding `SetLog`.
- R14. `classifyPostSession(state, routine) → PostSessionPrompt[]` returns one prompt per weighted exercise with at least one set logged.
- R15. Per weighted exercise: lowest ≥ original SW → Case A prompt (Stay@SW or Roll up to SW+increment). Lowest < original SW → Case B prompt (informational; new SW = lowest used).
- R16. Bodyweight, time-based, and cardio emit no prompt.
- R17. Test file at `apps/swole/src/core/session-machine.spec.ts` (adjacent — Jest config supports both adjacent `.spec.ts` and `__tests__/`, and adjacent is cleaner for a single-module domain folder).
- R18. Exhaustive table covering every (action × exercise type × set position) cell the PRD permits. Test names encode the cell.
- R19. Named fixture tests literally encoding PRD F2 (Bench Press → Pushups → Plank walkthrough) and PRD F3 (cases A and B).
- R20. Undo round-trip tests: `undo(applyAction(S, A, R))` deep-equals `S`. Plus undo-on-empty no-op.
- R21. Invalid-action dispatches throw (e.g., `Increment` on bodyweight; `Complete` on a non-last set of weighted; `Increment` on the last set of weighted).

---

## Scope Boundaries

- No persistence. The FSM never writes to SQLite or any other store. Saving a completed session's `setLogs` is the job of Survivor 4's active-session server action.
- No React or UI bindings. The FSM does not import `react`. No `useReducer` / `useOptimistic` adapters in this PR — consumers wire those up themselves in Survivor 4.
- No SQLite schema work. The `SetLog` *shape* matches the planned `set_logs` table, but the table itself lands in Survivor 3.
- (In scope for this PR: out-of-order exercise jumps via the `JumpTo` action. PRD F2 step 5 — "User may jump to any exercise out of order via an exercise list / drawer" — requires the FSM to support the write path, not just the UI. The FSM exposes a `JumpTo { exerciseIdx }` action that sets `state.cursorOverride`; subsequent `applyAction` writes go to the jumped-to exercise. The override clears the moment any non-`JumpTo` action dispatches, so the cursor "sticks" to the chosen target only until the user does their next set.)
- No routine validation. `applyAction` and friends assume well-formed routine input (exercise types and required fields per the PRD's exercise-type table). Validation belongs in the routine builder.
- No redo.
- No in-flight session recovery across browser reloads.
- No `docs/solutions/` entry. The FSM is internal swole logic. The first `docs/solutions/` entry is reserved for Survivor 3's SQLite-in-monorepo writeup.
- No changes outside `apps/swole/src/core/`. The PR touches exactly two new files (`session-machine.ts`, `session-machine.spec.ts`) — no other source files, no other configs.
- No coverage threshold change in `jest.config.js`. The success criterion is 100% branch coverage on `session-machine.ts` as measured manually from the per-file coverage table (`pnpm --filter @lilnas/swole test:cov`). Existing files without tests (`health/route.ts`, `metrics/route.ts`, `logger.ts`) will show 0% in the same report; this is expected. Enforcing per-file thresholds via Jest's `coverageThreshold` is a Survivor 4+ concern when more code exists.

### Deferred to Follow-Up Work

- Wiring the FSM into the active-session client component (`useOptimistic`, `useReducer`): Survivor 4.
- Wiring the FSM's `setLogs` output into the SQLite `set_logs` table via a server action: Survivor 4 (depends on Survivor 3's schema landing first).
- Drizzle-generated `Routine`/`Exercise` types replacing the FSM's local definitions: Survivor 3 reconciliation step.

---

## Context & Research

### Relevant Code and Patterns

- **`apps/swole/src/lib/logger.ts`** — the only prior file under `apps/swole/src/lib/`. Uses the `src/<dir>/<single-file>.ts` shape that this PR mirrors for `src/core/session-machine.ts`. The intentional split is `src/lib/` = framework utilities (logger, env), `src/core/` = pure domain logic (this module); future Survivor 3 may add `src/db/` for persistence-only code.
- **`apps/swole/jest.config.js:5-13`** — testMatch accepts both `**/__tests__/**/*.ts` and `**/?(*.)+(spec|test).ts`, with `<rootDir>/src` in `roots`. Adjacent `session-machine.spec.ts` is picked up automatically.
- **`apps/swole/tsconfig.json:14-17`** — `paths` maps `src/*` to `./src/*`. The spec file imports as `import { applyAction } from 'src/core/session-machine'` to match the convention used by `apps/swole/src/lib/logger.ts:4` (`import { EnvKeys } from 'src/env'`).
- **`apps/swole/package.json:23-25`** — `test`, `test:watch`, `test:cov` scripts already in place from the foundation PR. Verification commands in this plan use them directly.
- **`apps/tdr-bot/src/message-handler/utils/__tests__/message-utils.spec.ts`** — the closest existing pure-logic Jest precedent in the monorepo (no NestJS test slices, no mocked I/O). Uses plain `describe`/`it` blocks. For R18's exhaustive matrix the implementer may reach for Jest's `describe.each`, which has no in-tree precedent yet but is standard Jest idiom — either explicit `it()` or `describe.each` is fine.
- **`docs/prds/swole.md`** — authoritative source for: the four exercise types' fields and valid actions (table under "Exercise types"), the set-action semantics (section under "Set actions — semantics"), F2 walkthrough (under "User flows / F2 — Run a session" and the "Verification" section's step 3), F3 cases A and B (under "User flows / F3 — End-of-session weight prompt").
- **`docs/brainstorms/2026-05-26-swole-session-machine-requirements.md`** — origin document. All R-IDs in this plan trace back here.
- **`docs/plans/2026-05-26-001-feat-swole-infra-foundation-plan.md`** — Survivor 1 plan; confirms that the swole scaffold is now pure Next.js with `src/lib/logger.ts`, no Drizzle yet, no `src/db/`, and that Jest is already configured.

### Institutional Learnings

- None applicable. `docs/solutions/` does not yet exist in the monorepo (confirmed at planning time and during the Survivor 1 plan). The brainstorm explicitly reserves the first `docs/solutions/` entry for Survivor 3 (SQLite-in-monorepo).

### External References

- No external research conducted. The work is pure TypeScript with no framework specifics; the PRD and the requirements doc are exhaustive on semantics, and local Jest patterns (download, tdr-bot) cover test idiom. Per Phase 1.2 of the planning workflow, lean on the brainstorm and PRD as the source of truth.

---

## Key Technical Decisions

- **Module path: `apps/swole/src/core/session-machine.ts`.** The brainstorm proposes `src/core/`; the foundation PR settled on `src/lib/logger.ts` for framework glue. `src/core/` carves out a sibling directory for pure domain logic so the import path itself communicates the boundary (`src/core/*` = no React, no I/O, no framework). Survivor 3 may add a parallel `src/db/` for persistence-only code.
- **Test file: adjacent `session-machine.spec.ts`.** Jest config accepts both adjacent and `__tests__/` layouts. Adjacent keeps the spec literally next to the module it pins, which matters for an FSM-as-contract module where any drift between module and tests is the bug the spec is meant to catch.
- **State is `{ setLogs: SetLog[] }`, not an abstract action log.** A `SetLog` already carries everything an event would (action plus values resolved at dispatch time). Using set logs *as* state means the FSM's in-memory shape and the SQLite row shape share the same domain fields one-to-one (modulo naming and housekeeping columns) — no second representation, no `derive(actions) → setLogs` step at session-complete.
- **True undo via `setLogs.pop()`, no separate undo stack.** The running log *is* the undo stack. The property "any prefix of `setLogs` is a valid `SessionState`" holds by construction.
- **No `currentTarget` field on state; derived via `nextTarget(state, routine)`.** Per-render cost is invisible for ~60 sets per workout. Zero fields that could disagree with `setLogs`.
- **Action vocabulary uses the PRD's eight set-action labels verbatim, plus `JumpTo` for out-of-order navigation.** Every UI button tap on a set maps 1:1 to a log entry; the exercise-list/drawer tap maps to `JumpTo { exerciseIdx }`, which moves the cursor without appending a log. Rejected: collapsing to semantic actions (`BumpUp`/`Hold`/`Skip`) — loses the user-intent trace. Rejected: making `JumpTo` write a log — its presence in history is misleading because no set was performed. Rejected: making `cursorOverride` persistent (sticky across multiple sets at the jumped-to exercise) — easier to reason about as a single-action override that clears on first write, matching the UI's natural flow ("jump, do the set, come back to normal walk").
- **`Failed` carries `actualReps` as payload.** The modal collects this value before dispatch. `applyAction` stays synchronous and pure.
- **`classifyPostSession` lives in the same module as `applyAction`.** Same rules of the game, tested side by side. A separate file would let the post-session rules drift away from the per-set rules they depend on.
- **Routine is an argument, not state.** Threading `routine` through `applyAction(state, action, routine)` and `nextTarget(state, routine)` is fine — it does not change during a session. Closures/factory functions would hide the dependency without simplifying tests.
- **Invalid action throws (does not return an error result).** The UI's job is to never present an invalid button for the current exercise type and set position. Any invalid dispatch is a programmer bug worth crashing on, not a recoverable condition. Concretely: `Increment` on bodyweight throws; `Complete` on a non-last set of weighted throws; `Increment` on the last set of weighted throws (Complete replaces it per PRD set-action semantics).
- **Decrement past zero is not clamped.** The FSM records `prior − increment` literally. A non-positive weight is a routine-config or user-intent bug at a higher layer, not an FSM concern. (Affects R7; resolves the brainstorm's Outstanding Question #2.)
- **`Failed` on time-based exercises stores its payload in `actualDuration`, not `actualReps`.** The PRD's exercise-type table lists `Failed` as valid on time-based but the PRD's set-action semantics text describes Failed as a reps modal — an upstream inconsistency. Rather than semantically overloading `actualReps` (which would force downstream consumers to switch on `exercise.type` when rendering), the FSM exposes a separate `actualDuration?: number` field on `SetLog`. The `Failed` action union still carries its payload as `actualReps: number` (R5) since that is the value the modal collects; `applyAction` routes the payload to `SetLog.actualReps` for weighted/bodyweight and to `SetLog.actualDuration` for time-based, so the persisted column name matches the semantic meaning. Survivor 3's schema gets a separate `actual_duration_seconds` column naturally; no `exercise.type`-aware rendering needed in the F4 stats UI.
- **`initialState()` is exported.** Trivial (`() => ({ setLogs: [] })`), but pairs with `applyAction`/`undo` in the public API and gives the UI a one-import entry point. (Resolves the brainstorm's Outstanding Question #5.)
- **Cardio's single-set advance uses the normal "past last set" path.** No special-cased branch for cardio in `nextTarget`. The index math walks "next setIdx within current exercise; if past `exercise.sets`, advance to next exerciseIdx; if past last exercise, return null" uniformly. A cardio exercise with `sets: 1` exits the inner loop on the second call to `nextTarget`. (Resolves the brainstorm's Outstanding Question #4.)
- **Test layout is `describe('applyAction', ...)` / `describe('undo', ...)` / `describe('nextTarget', ...)` / `describe('classifyPostSession', ...)` / `describe('PRD fixtures', ...)`.** Five top-level describe blocks match the five public functions plus the F2/F3 named fixtures, giving the spec a 1:1 map to the public API and the PRD. Per-block, use plain `it()` for distinct cases and reach for `describe.each` only when the table-driven shape genuinely beats repeated `it()` blocks (the R18 matrix for `applyAction` is the main candidate).
- **Routine and Exercise types live inside `session-machine.ts` for now.** Survivor 3 lands Drizzle; the FSM's types are then reconciled with Drizzle-generated ones (either import from the schema module, or keep the FSM types as the canonical shape and let Drizzle's `$inferSelect` types align). The reconciliation is a 1-PR mechanical step in Survivor 3, not a design problem now.

---

## Open Questions

### Resolved During Planning

- **Final module path?** `apps/swole/src/core/session-machine.ts` (brainstorm proposed; carves `src/core/` as the pure-domain sibling to `src/lib/`).
- **Final test path?** Adjacent `apps/swole/src/core/session-machine.spec.ts`. Jest config supports it; adjacency makes the spec-as-contract relationship explicit.
- **Decrement clamping?** No clamp. FSM records `prior − increment` verbatim.
- **Throw vs return-error on invalid action?** Throw. UI should never present invalid buttons; the contract is "given valid inputs, return valid output".
- **Invalid-action surface includes set-position checks (Complete only on last set, Increment never on last set of weighted)?** Yes. R21's "does not belong to the current exercise's type" extends to the PRD-defined position constraints. Treating these as type-level invariants prevents a UI bug that displays the wrong button from silently corrupting history.
- **Cardio `nextTarget` after the single Done/Skipped log?** Uses the normal "past last set" path. No special-casing.
- **`JumpTo` in scope?** Resolved: **yes, in scope for this PR**. PRD F2 step 5 ("User may jump to any exercise out of order via an exercise list / drawer") requires the FSM to support an out-of-order write path — there is no way for the UI to honor F2 step 5 if the cursor logic only walks first-incomplete. Adding `JumpTo` here (rather than as a follow-up PR) lets Survivor 4's drawer feature ship without a second FSM revision, and lets Survivor 4 trust that the FSM-as-contract claim survives its arrival. Tradeoff: ~1 extra implementation unit (U2b) plus a `cursorOverride?: number` field on `SessionState`.
- **Export an `initialState()` helper?** Yes. Pairs cleanly with `applyAction`/`undo`.
- **`Failed` on time-based with `actualReps` payload — semantic mismatch?** Resolved by splitting `SetLog`: the `Action` union still carries `Failed.actualReps: number` (collected by the modal), but `applyAction` routes the payload to `SetLog.actualDuration` for time-based exercises and to `SetLog.actualReps` for weighted/bodyweight. Persistence column names then match semantic meaning naturally — no downstream `exercise.type`-aware rendering required.
- **Test framework / style?** Jest (already configured) with plain `describe`/`it` blocks. Use `describe.each` for the R18 (action × type × position) matrix where the table beats repetition; everywhere else, prefer explicit `it()` blocks so failures point at named scenarios.
- **Exercise type representation — permissive `{ ...optional fields }` vs discriminated union by `type`?** Resolved: **discriminated union**. Each exercise-type variant requires exactly the fields it needs, so TypeScript narrows correctly inside `applyAction` / `nextTarget` / `classifyPostSession` and prevents the `NaN` / silent-misroute bugs that a permissive type would allow when a routine is malformed. The "no routine validation" rule still holds at the FSM boundary — the type system replaces runtime assertions with compile-time guarantees.

### Deferred to Implementation

- Exact TypeScript representation of the `Action` discriminated union (e.g., `{ type: 'Increment' } | { type: 'Failed', actualReps: number }` vs. a single object with optional payload). The implementer picks the shape that produces the cleanest switch-based dispatch in `applyAction`. Standard TypeScript discriminated-union conventions apply; no design implication for the rest of the plan.
- Whether to surface a TypeScript `Readonly<>` wrapper on `SessionState` and `SetLog` exported types. Defensive immutability annotation is fine but not required; the runtime guarantee (no mutation of input) is what the spec tests pin.
- Whether to centralize the "valid actions per (exerciseType, isLastSet)" table as a constant in the module or inline it inside `applyAction`. Either reads fine for an 8-action vocabulary; implementer's call.
- Whether `classifyPostSession`'s return order matches `routine.exercises` order or `setLogs` first-appearance order. Default: routine-exercises order (predictable for the UI). Implementer confirms during U5 work; either choice satisfies R14 as written.
- Exact `pino`/coverage-related Jest cli flags for the 100%-branch coverage check. `pnpm --filter @lilnas/swole test:cov` invokes Jest with `--coverage`; reading the report and confirming `session-machine.ts` shows 100% branches is the verification step, not a config change.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

The module is small (~5 functions) but the rule surface is the entire PRD's "Set actions — semantics" plus the F3 case A/B branching. A sketch of the action-to-next-set decision table — derived from R7 + R8 + PRD set-action semantics — makes the rules visible at a glance:

| Prior log's `action` | Effect on this set's weight (R7 lookup) |
|---|---|
| (no prior log for this exercise) | `routine.exercises[exerciseIdx].startingWeight` |
| `Increment` | `prior.weight + exercise.increment` |
| `Decrement` | `prior.weight − exercise.increment` (no clamp; may go negative) |
| `Stay` | `prior.weight` |
| `Complete` | `prior.weight` (Complete is "Stay on last set") |
| `Failed` | `prior.weight` (R8: Failed → next set behaves like Stay) |
| `Hold` | n/a — time-based has no weight |
| `Done` / `Skipped` | n/a — cardio has no weight |

The valid-action matrix for `applyAction`'s invariant check (R21):

| Exercise type | Not-last set | Last set |
|---|---|---|
| Weighted | `Increment`, `Stay`, `Decrement`, `Failed` | `Complete`, `Stay`, `Decrement`, `Failed` (no `Increment`) |
| Bodyweight | `Complete`, `Failed` | `Complete`, `Failed` |
| Time-based | `Hold`, `Failed` | `Hold`, `Failed` |
| Cardio | (only 1 set; this column does not apply) | `Done`, `Skipped` |

The cursor logic for `nextTarget` has two modes. **JumpTo-override mode:** if `state.cursorOverride != null`, the active exercise is `routine.exercises[state.cursorOverride]` and `setIdx` is the count of logs already on that exercise. **Normal walk mode:** otherwise, walk `routine.exercises` in order; for each exercise, the count of `SetLog` entries with that `exerciseIdx` is the next `setIdx`; the first exercise where `count < exercise.sets` is the active exercise. If every exercise's count meets its `sets` (and no override is set), return `null`. The override is set by `JumpTo` and cleared by the next non-`JumpTo` dispatch — `applyAction` for any of the eight set-action labels returns a new state object that omits `cursorOverride`, naturally clearing it.

Pseudo-code shape of the module exports (directional):

```ts
// apps/swole/src/core/session-machine.ts -- DIRECTIONAL
export type ExerciseType = 'weighted' | 'bodyweight' | 'time-based' | 'cardio'
export type Action =
  | { type: 'Increment' }
  | { type: 'Stay' }
  | { type: 'Decrement' }
  | { type: 'Complete' }
  | { type: 'Hold' }
  | { type: 'Done' }
  | { type: 'Skipped' }
  | { type: 'Failed'; actualReps: number }
  | { type: 'JumpTo'; exerciseIdx: number }

export type SetLog = { exerciseIdx, setIdx, weight?, reps?, actualReps?, duration?, actualDuration?, action }
export type SessionState = { setLogs: SetLog[]; cursorOverride?: number }
export type Routine = { exercises: Exercise[] }
export type WeightedExercise   = { name, type: 'weighted',   sets, targetReps, startingWeight, increment }
export type BodyweightExercise = { name, type: 'bodyweight', sets, targetReps }
export type TimeBasedExercise  = { name, type: 'time-based', sets, durationSeconds }
export type CardioExercise     = { name, type: 'cardio',     sets: 1, durationSeconds }
export type Exercise = WeightedExercise | BodyweightExercise | TimeBasedExercise | CardioExercise
export type NextTarget = { weight?, reps?, duration?, exerciseIdx, setIdx }
export type PostSessionPrompt = ...   // discriminated union: { case: 'A', ... } | { case: 'B', ... }

export function initialState(): SessionState
export function applyAction(state: SessionState, action: Action, routine: Routine): SessionState
export function undo(state: SessionState): SessionState
export function nextTarget(state: SessionState, routine: Routine): NextTarget | null
export function classifyPostSession(state: SessionState, routine: Routine): PostSessionPrompt[]
```

Per-function shape decisions:
- `applyAction`: compute current (exerciseIdx, setIdx) from `state.setLogs.length`-by-exercise, look up the exercise's type, validate `(type, isLastSet, action)`, build the new `SetLog` (weight per the R7 table above, plus reps/duration/actualReps fields per the type), return `{ setLogs: [...state.setLogs, newLog] }`.
- `undo`: `state.setLogs.length === 0 ? state : { setLogs: state.setLogs.slice(0, -1) }`.
- `nextTarget`: walk `routine.exercises`, count logs per exercise, find first `count < sets`, derive next target weight (R7 table) or duration/reps.
- `classifyPostSession`: filter `routine.exercises` to type `weighted`, for each, find all logs with that `exerciseIdx`, compute lowest / highest / ending weight, branch on `lowest >= startingWeight`.

---

## Implementation Units

- U1. **Define types, helpers, and module shell**

**Goal:** Create the new file `apps/swole/src/core/session-machine.ts` containing the type exports (`Action`, `SetLog`, `SessionState`, `Routine`, `Exercise`, `PostSessionPrompt`, `ExerciseType`, `NextTarget`), the `initialState()` helper, and signatures-only stubs for the four functions (each `throw new Error('not implemented')` so type-check passes but tests fail). Plus create the empty `apps/swole/src/core/session-machine.spec.ts` shell with `describe()` blocks matching the eventual layout. This unit is the API surface; subsequent units fill in behavior one function at a time.

**Requirements:** R1, R2, R3, R4, R5, R17

**Dependencies:** None

**Files:**
- Create: `apps/swole/src/core/session-machine.ts`
- Create: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- Define `ExerciseType` as `'weighted' | 'bodyweight' | 'time-based' | 'cardio'`.
- Define `Exercise` as a discriminated union by `type`, with each variant requiring exactly the fields its exercise type needs:
  - `WeightedExercise = { name: string; type: 'weighted'; sets: number; targetReps: number; startingWeight: number; increment: number }`
  - `BodyweightExercise = { name: string; type: 'bodyweight'; sets: number; targetReps: number }`
  - `TimeBasedExercise = { name: string; type: 'time-based'; sets: number; durationSeconds: number }`
  - `CardioExercise = { name: string; type: 'cardio'; sets: 1; durationSeconds: number }` (cardio is always single-set per PRD)
  - `Exercise = WeightedExercise | BodyweightExercise | TimeBasedExercise | CardioExercise`

  Rationale: routine well-formedness is enforceable at the type level rather than via runtime trust. After narrowing on `exercise.type`, TypeScript guarantees the required fields are present — `classifyPostSession`'s `rollUpOption = exercise.startingWeight + exercise.increment` cannot produce `NaN` because both fields are statically defined on `WeightedExercise`. The "no routine validation" rule still holds at the FSM boundary — the type system replaces runtime assertions with compile-time guarantees. Survivor 3's Drizzle reconciliation may need to express this narrowing on its end (e.g., separate row types per exercise type, or a typed `select()` with a discriminator), which is a known cost noted in Risks & Dependencies.
- Define `Routine = { exercises: Exercise[] }`.
- Define `SetLog = { exerciseIdx: number, setIdx: number, weight?: number, reps?: number, actualReps?: number, duration?: number, actualDuration?: number, action: Action }` matching R4 exactly. Note that `actualReps` is populated only on weighted/bodyweight `Failed` actions; `actualDuration` is populated only on time-based `Failed` actions.
- Define `SessionState = { setLogs: SetLog[]; cursorOverride?: number }` per R3. `setLogs` is the canonical history; `cursorOverride` is an optional pointer set by `JumpTo` and cleared on the next non-`JumpTo` dispatch.
- Define `Action` as a discriminated union of the 8 PRD set-action labels plus `JumpTo`. Seven set-action labels (`Increment`, `Stay`, `Decrement`, `Complete`, `Hold`, `Done`, `Skipped`) are no-payload; `Failed` carries `actualReps: number`; `JumpTo` carries `exerciseIdx: number`. Exact representation (e.g., `{ type: 'Failed', actualReps: number }` vs. an enum + payload tuple) is implementer's call as long as the union exhaustively covers all nine labels and TypeScript narrows correctly inside switch statements.
- Define `NextTarget = { weight?: number, reps?: number, duration?: number, exerciseIdx: number, setIdx: number }` — the return shape of `nextTarget`, the structured render target the UI consumes.
- Define `PostSessionPrompt` as a discriminated union of `{ case: 'A', exerciseIdx, originalStartingWeight, lowest, highest, ending, stayOption: number, rollUpOption: number }` and `{ case: 'B', exerciseIdx, originalStartingWeight, lowest, highest, ending, newStartingWeight: number }`. The discriminator field name (`case` vs `kind` vs `type`) is implementer's call; downstream UI is unchanged regardless. (No `exerciseName` field — consumers resolve the name via `routine.exercises[prompt.exerciseIdx].name` when they need it, keeping display data out of the FSM's classification output.)
- Export `initialState = (): SessionState => ({ setLogs: [] })`.
- Export the four stubs with full signatures, each throwing.
- In the spec file, set up the five top-level `describe` blocks (`applyAction`, `undo`, `nextTarget`, `classifyPostSession`, `PRD fixtures`). Inside each, add a single placeholder `it.todo()` so Jest reports the structure but doesn't fail.

**Patterns to follow:**
- Import style: `import { ... } from 'src/core/session-machine'` (matches `apps/swole/src/lib/logger.ts:4`).
- Type-export style: prefer `export type` for the discriminated unions and result shapes used here (interfaces work too — there is no lilnas-wide convention, and other apps mix both freely).

**Test scenarios:**
- Test expectation: none for this unit by itself — U1 only creates the API shell. The U1 spec file is structure-only (`it.todo()` placeholders) until U2–U6 fill it in.

**Verification:**
- `pnpm --filter @lilnas/swole type-check` passes (the exports compile; the stubs satisfy the signatures).
- `pnpm --filter @lilnas/swole lint` passes (no unused imports, no missing return types, ESLint clean).
- `pnpm --filter @lilnas/swole test session-machine` runs and reports five `describe` blocks with `it.todo()` entries.

---

- U2. **Implement `applyAction` with the exhaustive (action × type × position) test matrix**

**Goal:** Make `applyAction(state, action, routine) → SessionState` correctly append a new `SetLog` per R6–R9 and the PRD set-action semantics. The test matrix is the contract — every cell the PRD permits has a named test; every cell the PRD forbids has a throw test.

**Requirements:** R6, R7, R8, R9, R18, R21

**Dependencies:** U1

**Files:**
- Modify: `apps/swole/src/core/session-machine.ts`
- Modify: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- In `applyAction`, branch on `action.type` first. For `JumpTo`, see U2b — this unit handles only the eight set-action labels.
- Compute the current `(exerciseIdx, setIdx)`: if `state.cursorOverride != null`, that's the active exercise; otherwise the active exercise is the first `routine.exercises[i]` where `setLogs.filter(l => l.exerciseIdx === i).length < exercises[i].sets`. The next `setIdx` is the count of logs for that exercise.
- Validate `(exercise.type, isLastSet, action)` against the valid-action matrix in High-Level Technical Design. Throw `Error(...)` with a message naming the cell on any invalid combination (e.g., `"Invalid action 'Increment' on bodyweight exercise at exerciseIdx=1"`).
- Build the new log: weight per the R7 lookup table (Increment/Decrement adjust prior weight; Stay/Complete/Failed leave it unchanged; first-set-of-exercise uses `routine.exercises[exerciseIdx].startingWeight`); reps = `routine.exercises[exerciseIdx].targetReps` for weighted/bodyweight; actualReps = reps for non-Failed, `action.actualReps` for Failed; duration = `routine.exercises[exerciseIdx].durationSeconds` for time-based/cardio.
- Return `{ setLogs: [...state.setLogs, newLog] }` — `cursorOverride` is intentionally omitted from the returned object, which clears it. This is how the override "sticks" only until the next non-JumpTo dispatch. Do not mutate `state.setLogs`.

**Execution note:** Implement test-first per scenario in the matrix below — the spec file is the contract for this unit, so writing the failing test and then the code keeps the rule visible. The brainstorm's framing ("exhaustive tests pin every cell") supports this posture.

**Technical design:** *(directional — see High-Level Technical Design for the matrix tables)*

The implementation is essentially: derive `(exerciseIdx, setIdx, isLastSet)` → validate → build new log fields → append. The "build fields" step is a `switch` on `exercise.type` with a nested `switch` on `action.type`. Treat the valid-action matrix as one named constant table referenced by validation logic, even if inlined.

**Patterns to follow:**
- Pure-function style: no mutation of input, no module-level state, no closures over time.
- Use TypeScript narrowing inside the action switch: `if (action.type === 'Failed') { const { actualReps } = action }` so the discriminated union type-checks cleanly.

**Test scenarios:**

R18's "every (action × exercise type × set position) cell the PRD permits" expands to the following tests. Each test name follows the pattern `"<ExerciseType>, <Action> on <set position> → <expected outcome>"`. Use `describe.each` over a table if the boilerplate beats explicit `it()` blocks.

Weighted, first set (no prior log for this exercise):
- Happy: `Increment` → new log records weight = SW, action = 'Increment', reps = target, actualReps = target.
- Happy: `Stay` → new log records weight = SW, action = 'Stay'.
- Happy: `Decrement` → new log records weight = SW, action = 'Decrement' (note: first-set Decrement still records SW; the decrement effect lands on set 2).
- Happy: `Failed` with `actualReps: 7` (target was 10) → new log records weight = SW, action = 'Failed', actualReps = 7, reps = 10.

Weighted, middle set (prior log exists for this exercise):
- Happy: prior action = `Increment` (weight 100, inc 5), current = `Increment` → new log weight = 105, action = 'Increment'.
- Happy: prior `Stay` (weight 100), current = `Stay` → new log weight = 100, action = 'Stay'.
- Happy: prior `Decrement` (weight 100, inc 5), current = `Decrement` → new log weight = 95, action = 'Decrement'.
- Happy: prior `Failed` (weight 100), current = `Stay` → new log weight = 100 (R8: Failed → Stay-equivalent), action = 'Stay'.
- Happy: prior `Increment` (weight 100, inc 5), current = `Stay` → new log weight = 105 (the bumped weight, which is what the user actually did set 2 at), action = 'Stay'.
- Happy: prior `Failed` (weight 100, inc 5), current = `Increment` → new log weight = 100 (Failed leaves weight unchanged for this set; the Increment label affects the NEXT set), action = 'Increment'.
- Happy: prior `Failed` (weight 100, inc 5), current = `Decrement` → new log weight = 100, action = 'Decrement'.
- Happy: prior `Decrement` (weight 100, inc 5), current = `Increment` → new log weight = 95 (the decremented weight, which is what the user actually did set 2 at), action = 'Increment'.
- Happy: prior `Decrement` (weight 100, inc 5), current = `Stay` → new log weight = 95, action = 'Stay'.
- Happy: prior `Increment` (weight 100, inc 5), current = `Decrement` → new log weight = 105 (bumped from set 1), action = 'Decrement'.
- Error: prior `Stay`, current = `Complete` on middle (non-last) set → throws ("Invalid action 'Complete' on non-last set of weighted exercise; expected one of: Increment, Stay, Decrement, Failed").

Weighted, last set:
- Happy: prior `Stay` (weight 100), current = `Complete` → new log weight = 100, action = 'Complete'.
- Happy: prior `Increment` (weight 100, inc 5), current = `Complete` → new log weight = 105, action = 'Complete'.
- Happy: prior `Stay` (weight 100), current = `Stay` on last set → new log weight = 100, action = 'Stay' (Stay still valid on last set per PRD).
- Happy: prior `Stay` (weight 100), current = `Decrement` (inc 5) on last set → new log weight = 95, action = 'Decrement' (Decrement still valid on last set per PRD).
- Happy: prior `Stay`, current = `Failed` with actualReps = 6 on last set → new log weight = prior, action = 'Failed', actualReps = 6.
- Error: prior `Stay`, current = `Increment` on last set → throws ("Invalid action 'Increment' on last set of weighted exercise; expected 'Complete'").

Weighted, edge cases:
- Edge: prior weight = 5, inc = 10, current = `Decrement` → new log weight = -5 (no clamp; FSM records as-is).
- Edge: prior weight = 0, inc = 5, current = `Decrement` → new log weight = -5.

Weighted, single-set exercise (sets = 1; first set IS also the last set):
- Happy: `Complete` on the single set, no prior log → new log weight = SW, action = 'Complete'.
- Happy: `Stay` on the single set, no prior log → new log weight = SW, action = 'Stay'.
- Happy: `Decrement` on the single set, no prior log → new log weight = SW, action = 'Decrement'.
- Happy: `Failed` on the single set with actualReps = 6, no prior log → new log weight = SW, actualReps = 6, action = 'Failed'.
- Error: `Increment` on the single set → throws (because it IS the last set; Increment is replaced by Complete on the last set of weighted, even when that last set is also the first).

Bodyweight (all sets behave the same — only `Complete` and `Failed` valid):
- Happy: `Complete` on first set (target reps 15) → new log records reps = 15, actualReps = 15, action = 'Complete', no weight, no duration.
- Happy: `Failed` on first set with actualReps = 12 → new log records reps = 15, actualReps = 12, action = 'Failed'.
- Happy: `Complete` on middle set → new log records reps = target, action = 'Complete'.
- Happy: `Complete` on last set → new log records reps = target, action = 'Complete'.
- Error: `Increment` on bodyweight → throws ("Invalid action 'Increment' on bodyweight exercise").
- Error: `Stay` on bodyweight → throws.
- Error: `Decrement` on bodyweight → throws.
- Error: `Hold` on bodyweight → throws.
- Error: `Done` on bodyweight → throws.
- Error: `Skipped` on bodyweight → throws.

Time-based:
- Happy: `Hold` on first set (target duration 30) → new log records duration = 30, action = 'Hold', no weight, no reps, no actualReps, no actualDuration.
- Happy: `Failed` on first set with payload value = 20 → new log records duration = 30, `actualDuration = 20`, action = 'Failed', no actualReps. The `Failed` action's payload is named `actualReps` in the `Action` union (R5) but is stored as `actualDuration` on the `SetLog` for time-based exercises — applyAction routes the payload to the appropriate `SetLog` field based on `exercise.type`.
- Happy: `Hold` on middle set → new log records duration = target.
- Happy: `Hold` on last set → new log records duration = target.
- Error: `Increment`/`Stay`/`Decrement`/`Complete`/`Done`/`Skipped` on time-based → throws.

Cardio (exercise has `sets = 1` per PRD):
- Happy: `Done` on the single set → new log records duration = target, action = 'Done'.
- Happy: `Skipped` on the single set → new log records duration = target, action = 'Skipped'.
- Error: `Increment`/`Stay`/`Decrement`/`Complete`/`Hold`/`Failed` on cardio → throws (Failed throws on cardio because PRD exercise-type table lists only Done/Skipped).

Cross-exercise transitions:
- Happy: after completing weighted exercise 0 (last log on it), dispatching the next exercise's first action — applyAction looks at the new exercise's `startingWeight` (not the previous exercise's last weight). E.g., Bench Press (SW 100) completed, then Squat (SW 200) first action → new log weight = 200.

Purity invariants:
- Edge: `applyAction(state, ...)` does not mutate `state.setLogs` (assert `state.setLogs.length` unchanged after dispatch).
- Edge: returned state's `setLogs` array is a NEW reference (`!==` input's `setLogs`).
- Edge: returned state is itself a NEW object (`!==` input state).

**Verification:**
- Every test in the matrix above passes.
- `pnpm --filter @lilnas/swole test session-machine` reports the new tests green; only `undo`, `nextTarget`, `classifyPostSession`, `PRD fixtures` describe blocks still hold `it.todo()` placeholders.
- `pnpm --filter @lilnas/swole test:cov` shows `session-machine.ts`'s `applyAction` function at ~100% line and branch coverage (other functions still 0% — they land in U3–U5).
- `pnpm --filter @lilnas/swole lint` and `type-check` pass.

---

- U2b. **Implement `JumpTo` action in `applyAction` plus cursor-override behavior**

**Goal:** Make `applyAction(state, { type: 'JumpTo', exerciseIdx }, routine)` return `{ setLogs: state.setLogs, cursorOverride: exerciseIdx }` — i.e., set the cursor override without appending a log. Also pin that the next non-JumpTo dispatch clears `cursorOverride`, and that `nextTarget` honors `cursorOverride` when present.

**Requirements:** R3 (cursorOverride field), R5 (JumpTo in Action union), R6 (JumpTo branch in applyAction)

**Dependencies:** U1, U2 (U2 establishes the basic applyAction shape; this unit adds the JumpTo branch)

**Files:**
- Modify: `apps/swole/src/core/session-machine.ts`
- Modify: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- In `applyAction`, add a `JumpTo` case at the top of the action-type switch: validate that `action.exerciseIdx` is in `[0, routine.exercises.length)` (throws on out-of-range with an error message naming the cell), then return `{ setLogs: state.setLogs, cursorOverride: action.exerciseIdx }`. Do not append a log.
- Non-JumpTo branches return objects that omit `cursorOverride`, which clears it.
- `nextTarget` reads `state.cursorOverride` first: if set, the active exercise is `routine.exercises[cursorOverride]` and `setIdx` is the count of logs already on that exercise. The R7 weight derivation then uses the last log for the jumped-to exercise (or `startingWeight` if no prior log).

**Patterns to follow:**
- Same purity/no-mutation contract as U2. JumpTo's path is structurally simpler — no log built, no validation matrix consulted.

**Test scenarios:**
- Happy: `applyAction(initialState(), { type: 'JumpTo', exerciseIdx: 2 }, routine)` → `{ setLogs: [], cursorOverride: 2 }`. No log appended.
- Happy: `nextTarget` after a JumpTo to exercise 2 (with empty `setLogs`) → returns exercise 2's first-set target (using exercise 2's `startingWeight`, `targetReps`/`durationSeconds`, etc.) — not exercise 0's.
- Happy: state with logs on exercise 0 only, then JumpTo exercise 2, then `applyAction` of a normal action — the new log records `exerciseIdx: 2, setIdx: 0` (jumped-to exercise's first set), and the returned state omits `cursorOverride`.
- Happy: after the dispatch in the previous scenario, `nextTarget` returns exercise 2's setIdx 1 (normal walk; the override is cleared).
- Happy: JumpTo into the middle of a partially-completed exercise (e.g., 1 log already on exercise 2, JumpTo exercise 2). The override is set; subsequent action writes `exerciseIdx: 2, setIdx: 1` — the existing log count is honored.
- Happy: JumpTo "back" to a fully-completed exercise (e.g., exercise 0 has all 3 logs, user JumpTo 0). The override is set; `nextTarget` returns exercise 0 setIdx 3 (past the last set). The next applyAction must either reject (because exercise 0 has no slot for setIdx 3) or accept and write setIdx 3 — chosen behavior: reject (throws "exercise 0 has 3 sets; cannot write setIdx 3"). This makes JumpTo-to-completed-exercise an error path that the UI's drawer can surface as "this exercise is done".
- Happy: two JumpTos in a row (`JumpTo 2`, then `JumpTo 1` with no intervening write) — the override updates to the latest target (1). Pinning this prevents an implementation bug that throws or no-ops on consecutive jumps.
- Edge: JumpTo into the currently-active exercise (the normal-walk cursor already points there). The override is set; behavior is identical to a no-op JumpTo. No log appended; the next non-JumpTo dispatch clears the override and the cursor walk continues normally.
- Error: JumpTo to an out-of-range `exerciseIdx` (`-1`, `routine.exercises.length`, `routine.exercises.length + 1`) → throws ("JumpTo target exerciseIdx out of range: <n> (routine has <N> exercises)").
- Error: JumpTo to an out-of-range index on an empty routine (`{ exercises: [] }`) → throws.
- Edge: applyAction with a non-JumpTo action on a state that has `cursorOverride` set, but the override points at an exercise that has been fully completed since the JumpTo was issued — should throw the same "exercise <n> has <sets> sets; cannot write setIdx <sets>" error.
- Invariant: `applyAction(state, { type: 'JumpTo', ... }, routine).setLogs === state.setLogs` (same reference — JumpTo does not touch the log array).

**Verification:**
- All new tests pass.
- `JumpTo`'s branch + the cursor-override branch in `nextTarget` together hit 100% coverage.
- The U2 matrix tests still pass (they should not regress because non-JumpTo branches omit `cursorOverride`, matching the existing behavior for states that have never seen a JumpTo).

---

- U3. **Implement `undo` with round-trip tests**

**Goal:** Make `undo(state) → SessionState` remove the last `SetLog` and return a no-op on empty state per R10–R11, R20. The round-trip property (dispatch → undo → equality with pre-dispatch state) is the strongest spec test here because it pins behavior against any future applyAction change.

**Requirements:** R10, R11, R20

**Dependencies:** U1, U2, U2b (round-trip tests require `applyAction` to be working; cursor-override clearing tests require `JumpTo` to exist)

**Files:**
- Modify: `apps/swole/src/core/session-machine.ts`
- Modify: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- `undo` removes the most recent `SetLog`. If `setLogs.length === 0`, return input unchanged. Otherwise return `{ setLogs: state.setLogs.slice(0, -1) }` (omitting any `cursorOverride` — an undo unwinds back to "normal walk" semantics, which means clearing the override; the override only exists in the window between a JumpTo and the next non-JumpTo write).
- `undo` does NOT reverse a `JumpTo`. JumpTo doesn't append a log, so there is no log to remove. To "undo a JumpTo" the caller dispatches another `JumpTo` (or simply lets the next non-JumpTo write clear the override naturally).
- The empty-state branch returns the input state unchanged. Returning the same reference is allowed (no-op semantics); the spec test does not require a new object on no-op.

**Patterns to follow:**
- Mirror `applyAction`'s purity contract: never mutate input.

**Test scenarios:**
- Happy: dispatch one action on empty state → undo → state deep-equals `initialState()`.
- Happy: dispatch two actions → undo once → state.setLogs has length 1 and matches the first applyAction's output.
- Edge: `undo(initialState())` returns input unchanged (`===` is also acceptable; no-throw).
- Edge: undo across an exercise boundary — sequence dispatches that complete exercise 0 then start exercise 1, then undo. Result should reflect removal of the most recent log only (the first log of exercise 1), not unwinding exercise 0. Also assert that `nextTarget(state, routine)` after the undo points back at the un-done set (exercise 1, setIdx 0) — not exercise 0, not exercise 1 setIdx 1 — and that a subsequent `applyAction` writes to exercise 1 setIdx 0 again. This pins the cursor's correctness against a bug that caches the highest-seen exerciseIdx or assumes monotonic cursor movement.
- Round-trip property (R20): for at least 4 representative `(state, action, routine)` triples covering each exercise type, `undo(applyAction(s, a, r))` deep-equals `s` *for non-JumpTo actions*. Pick triples that span: weighted first set, weighted with prior log, bodyweight, time-based, cardio.
- Edge: undo twice on a state with one log — second undo returns empty state unchanged (no error).
- Edge: `undo` on a state with `cursorOverride` set and a non-empty `setLogs` — removes the last log AND clears `cursorOverride`. The result has neither the popped log nor the override. (Validates that undo unwinds to "normal walk" cleanly.)
- Edge: `undo` after a `JumpTo` with no subsequent write — `state.setLogs` is unchanged so undo is a no-op on the log array, but `cursorOverride` is cleared. The result has the same logs but no override.
- Edge: round-trip for JumpTo specifically — `undo(applyAction(s, { type: 'JumpTo', exerciseIdx: 2 }, r))` returns a state with the same `setLogs` as `s` but no `cursorOverride`. If `s` itself had a `cursorOverride`, undo does NOT restore it (this is intentional — `cursorOverride` is single-write, not stack-based).

**Verification:**
- All new tests pass.
- `undo`'s branch coverage hits 100% (both the empty and non-empty branches).
- Lint, type-check still pass.

---

- U4. **Implement `nextTarget` with cursor advance and cardio edge case**

**Goal:** Make `nextTarget(state, routine) → NextTarget | null` return the UI's render target per R12–R13. The cursor logic must handle: first exercise / first set (empty state), mid-exercise advance, cross-exercise advance, single-set cardio advance, and full-session completion (return `null`).

**Requirements:** R12, R13

**Dependencies:** U1, U2, U2b (test scenarios require `applyAction` to produce realistic states; cursor-override branch was implemented in U2b and is tested there — U4 may add coverage for nextTarget's normal-walk path independently)

**Files:**
- Modify: `apps/swole/src/core/session-machine.ts`
- Modify: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- If `state.cursorOverride != null`, the active exercise is `routine.exercises[state.cursorOverride]`. Count logs on that exercise; `setIdx = count`. If `count >= sets` (the user jumped to an already-completed exercise), still return that exercise/setIdx — the consumer can decide how to render it, and a subsequent applyAction will throw. (Returning `null` here would conflate "session complete" with "JumpTo target is done", which the UI needs to distinguish.)
- Otherwise (the normal walk), iterate `routine.exercises` in order. For each exercise at index `i`, count `state.setLogs.filter(l => l.exerciseIdx === i).length`. If `count < exercise.sets`, this is the active exercise; `setIdx = count`. Otherwise advance to the next exercise.
- If every exercise's count equals its `sets`, return `null` (session complete).
- For the active exercise, derive the next target:
  - Weighted: weight per R7 lookup against the last log for this exercise (or `startingWeight` if no logs yet); reps = `targetReps`.
  - Bodyweight: reps = `targetReps`; no weight, no duration.
  - Time-based: duration = `durationSeconds`; no weight, no reps.
  - Cardio: duration = `durationSeconds`; no weight, no reps.
- Return `{ weight?, reps?, duration?, exerciseIdx, setIdx }`.

**Patterns to follow:**
- **Required extraction:** factor R7's weight-derivation logic into a private `deriveNextWeight(state, routine, exerciseIdx): number | undefined` helper used by both `applyAction` (for the new log's weight) and `nextTarget` (for the preview weight). The plan's Problem Frame argues against rule-duplication "no rule lives in two places" — that argument applies within this module too. Inlining the logic in both functions invites silent drift on future edits to R7, and the 100% branch coverage requirement does not catch this kind of divergence because both branches can pass tests individually.
- Add an explicit U4 spec test that pins agreement: drive any state through `nextTarget(state, routine)` to read the preview weight, then call `applyAction(state, { type: 'Stay' }, routine)` and assert that the resulting log's `weight` equals the preview. This catches any future divergence at test time.

**Test scenarios:**
- Happy: `nextTarget(initialState(), routineWithWeightedFirst)` → `{ weight: SW, reps: targetReps, exerciseIdx: 0, setIdx: 0 }`.
- Happy: state with one log on exercise 0 (action = 'Increment') → next target's weight = SW + increment, setIdx = 1.
- Happy: state with one log on exercise 0 (action = 'Stay') → next target's weight = SW, setIdx = 1.
- Happy: state with one log on exercise 0 (action = 'Decrement') → next target's weight = SW − increment, setIdx = 1.
- Happy: state with one log on exercise 0 (action = 'Failed') → next target's weight = SW (R8: Failed → Stay-equivalent).
- Happy: state with `exercise.sets` logs on exercise 0 → next target advances to exercise 1, setIdx = 0.
- Happy: state with full exercise 0 + one log on exercise 1 → next target on exercise 1, setIdx = 1.
- Edge: bodyweight routine — next target has reps but no weight.
- Edge: time-based routine — next target has duration but no weight, no reps.
- Edge: cardio exercise as exercise 0 (sets = 1), state with one Done log → next target advances to exercise 1 (resolves brainstorm's Outstanding Question #4: single-set advance via the normal "past last set" path).
- Edge: cardio as the only exercise (sets = 1), state with one Done log → returns `null`.
- Edge: cardio sandwiched between weighted exercises (routine `[weighted-3sets, cardio-1set, weighted-3sets]`). Drive `applyAction` through the full sequence (3 weighted logs on ex0 → 1 Done on ex1 → 3 weighted logs on ex2) and assert `nextTarget` at each step. After the cardio Done log, `nextTarget` must point at exercise 2 setIdx 0 with exercise 2's `startingWeight` (not exercise 0's). Composition coverage for "advance into a single-set exercise" + "advance out of a single-set exercise" in the same test.
- Edge: full routine completed (every exercise's count == sets) → returns `null`.
- Edge: empty routine (`{ exercises: [] }`) → returns `null` (degenerate but well-defined; no special-case needed in the implementation — the walk exits with no active exercise found).
- Agreement: for any state and routine, `applyAction(state, { type: 'Stay' }, routine).setLogs.at(-1).weight` equals `nextTarget(state, routine).weight`. Pins that the shared `deriveNextWeight` helper is the single source of weight derivation across both functions.
- Edge: weighted exercise 0 just completed, exercise 1 is weighted with a different SW — next target on exercise 1 uses exercise 1's SW, NOT the last weight from exercise 0.

**Verification:**
- All new tests pass.
- `nextTarget`'s branch coverage hits 100%.
- Lint, type-check still pass.

---

- U5. **Implement `classifyPostSession` with Case A / Case B branching**

**Goal:** Make `classifyPostSession(state, routine) → PostSessionPrompt[]` emit one prompt per weighted exercise that has at least one logged set, per R14–R16 and PRD F3. Non-weighted exercises emit no prompt regardless of what was logged.

**Requirements:** R14, R15, R16

**Dependencies:** U1, U2 (test scenarios need realistic states)

**Files:**
- Modify: `apps/swole/src/core/session-machine.ts`
- Modify: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- Iterate `routine.exercises` in order. For each `exercise` with `type === 'weighted'`:
  - Collect logs with matching `exerciseIdx`. If the list is empty, skip (no prompt).
  - Compute `lowest = min(log.weight)`, `highest = max(log.weight)`, `ending = lastLog.weight`.
  - Compare `lowest` against `originalStartingWeight = exercise.startingWeight`.
  - If `lowest >= originalStartingWeight`: emit Case A — `{ case: 'A', exerciseIdx, originalStartingWeight, lowest, highest, ending, stayOption: originalStartingWeight, rollUpOption: originalStartingWeight + exercise.increment }`.
  - Else: emit Case B — `{ case: 'B', exerciseIdx, originalStartingWeight, lowest, highest, ending, newStartingWeight: lowest }`.
- Skip non-weighted exercises entirely (no entry in the returned array).
- Default return order: `routine.exercises` order (predictable for the UI). Per Open Questions / Deferred to Implementation, implementer may switch to first-appearance order if a downstream constraint demands it.

**Patterns to follow:**
- Pure-function style.
- Reuse the `weight` extraction logic — every weighted log has `weight` defined (per U2's invariants), so `log.weight!` is safe inside this function with a runtime invariant-check if the implementer prefers explicit assertions.

**Test scenarios:**

PRD F3 directly enforces specific cases here; these scenarios cover each branch plus the no-prompt cases for non-weighted types.

Single weighted exercise:
- Covers AE F3-A: Bench Press SW=100, inc=5, sets logged at 100, 105, 110 → Case A prompt: `exerciseIdx=0, originalStartingWeight=100, lowest=100, highest=110, ending=110, stayOption=100, rollUpOption=105`.
- Happy: Bench Press SW=100, sets logged all at 100 → Case A: `lowest=100, ending=100, stayOption=100, rollUpOption=105`.
- Covers AE F3-B: Bench Press SW=100, sets logged at 100, 95 (dropped at set 2) → Case B prompt: `lowest=95, ending=95, newStartingWeight=95`.
- Happy: Bench Press SW=100, sets logged at 100, 95, 95, 95 → Case B: `newStartingWeight=95`.
- Happy: Bench Press SW=100, sets logged at 100, 105, 100, 95 → Case B: `lowest=95, highest=105, ending=95, newStartingWeight=95`.

Multiple exercises (one weighted, others non-weighted):
- Happy: Routine = Bench Press (weighted) + Pushups (bodyweight) + Plank (time-based). Logs for all three. Result: exactly one prompt — for Bench Press. Bodyweight and time-based emit no prompt (R16).
- Happy: Routine = Bench Press + Squat (both weighted). Logs for both. Result: two prompts in routine order — Bench Press first, Squat second.

Edge cases:
- Edge: weighted exercise present in routine but no logs for it (e.g., session abandoned before reaching it) → no prompt for that exercise (R14: "had at least one set logged").
- Edge: empty state → empty array.
- Edge: all-cardio routine → empty array (no weighted exercises).
- Edge: Bench Press SW=100, single set logged at 95 (lowest = ending = 95) → Case B with `newStartingWeight=95`.
- Edge: Bench Press SW=100, lowest exactly equals SW (100, 100, 100) → Case A (boundary: `lowest >= originalStartingWeight` is true).

**Verification:**
- All new tests pass.
- `classifyPostSession`'s branch coverage hits 100%.
- Lint, type-check still pass.

---

- U6. **PRD F2 and F3 named fixture tests**

**Goal:** Land the two named fixtures the brainstorm calls out as success criteria (R19): the F2 walkthrough as one big end-to-end test asserting the final `SessionState`, and the F3 cases A and B as targeted post-session-prompt fixtures. These tests exercise multiple functions together and catch regressions where individual-function tests would pass but the integration would not.

**Requirements:** R19

**Dependencies:** U2, U2b, U3, U4, U5

**Files:**
- Modify: `apps/swole/src/core/session-machine.spec.ts`

**Approach:**
- Add a `describe('PRD fixtures', ...)` block (already stubbed in U1).
- F2 fixture: define `routinePushDay` with Bench Press (weighted 3×10@100, +5), Pushups (bodyweight 3×15), Plank (time-based 3×30s). Dispatch the PRD-verified action sequence — `Increment, Stay, Complete, Failed(actualReps=12), Complete, Complete, Hold, Hold, Hold` — through `applyAction` in order. Assert the final `SessionState.setLogs` equals the expected 9-log array (listed below).
- F3 Case A fixture: build a `SessionState` with three Bench Press logs at 100, 105, 110 (actions don't matter for `classifyPostSession`, only `weight`). Call `classifyPostSession(state, routine)`. Assert the result is `[{ case: 'A', exerciseIdx: 0, originalStartingWeight: 100, lowest: 100, highest: 110, ending: 110, stayOption: 100, rollUpOption: 105 }]`.
- F3 Case B fixture: build a `SessionState` with four Bench Press logs at 100, 100, 95, 95. Call `classifyPostSession(state, routine)`. Assert the result is `[{ case: 'B', exerciseIdx: 0, originalStartingWeight: 100, lowest: 95, highest: 100, ending: 95, newStartingWeight: 95 }]`.

**Patterns to follow:**
- Use the same routine and exercise objects across the fixture's setup and assertions — define once, reuse — so the test reads as one narrative.
- Snapshot tests are not appropriate here — the assertions are exact-shape comparisons of small structured values, and the F2/F3 expected arrays are the contract the PRD pins literally.

**Test scenarios:**

- Covers F2 (entire walkthrough): Routine "Push Day" with three exercises as above. Dispatch sequence: `Increment`, `Stay`, `Complete` (Bench Press 3 sets); `Failed(actualReps=12)`, `Complete`, `Complete` (Pushups 3 sets); `Hold`, `Hold`, `Hold` (Plank 3 sets). Expected final `setLogs` (9 entries, in dispatch order):
  - `{ exerciseIdx: 0, setIdx: 0, weight: 100, reps: 10, actualReps: 10, action: { type: 'Increment' } }`
  - `{ exerciseIdx: 0, setIdx: 1, weight: 105, reps: 10, actualReps: 10, action: { type: 'Stay' } }`
  - `{ exerciseIdx: 0, setIdx: 2, weight: 105, reps: 10, actualReps: 10, action: { type: 'Complete' } }`
  - `{ exerciseIdx: 1, setIdx: 0, reps: 15, actualReps: 12, action: { type: 'Failed', actualReps: 12 } }`
  - `{ exerciseIdx: 1, setIdx: 1, reps: 15, actualReps: 15, action: { type: 'Complete' } }`
  - `{ exerciseIdx: 1, setIdx: 2, reps: 15, actualReps: 15, action: { type: 'Complete' } }`
  - `{ exerciseIdx: 2, setIdx: 0, duration: 30, action: { type: 'Hold' } }`
  - `{ exerciseIdx: 2, setIdx: 1, duration: 30, action: { type: 'Hold' } }`
  - `{ exerciseIdx: 2, setIdx: 2, duration: 30, action: { type: 'Hold' } }`
- After the F2 dispatch sequence completes, also assert: `nextTarget(state, routine)` returns `null` (session complete) and `classifyPostSession(state, routine)` returns `[{ case: 'A', exerciseIdx: 0, originalStartingWeight: 100, lowest: 100, highest: 105, ending: 105, stayOption: 100, rollUpOption: 105 }]` (only Bench Press emits; Pushups and Plank don't).
- Covers F3 Case A: Bench Press session at 100/105/110 → prompt offers `Stay` at 100 or `Roll up` to 105.
- Covers F3 Case B: Bench Press session at 100/100/95/95 → informational prompt with `newStartingWeight = 95`.

**Verification:**
- F2 fixture passes — the final `setLogs` array matches exactly.
- F3 Case A and Case B fixtures pass.
- `pnpm --filter @lilnas/swole test:cov` — in the per-file table, confirm `session-machine.ts` shows 100% Branches. Other files (`src/app/api/health/route.ts`, `src/app/metrics/route.ts`, `src/lib/logger.ts`) appear in the same report with 0% coverage because they have no tests yet; this is expected and does not indicate failure. Read only the `session-machine.ts` row.
- `pnpm --filter @lilnas/swole lint` and `type-check` pass.
- Spot-check by re-running the PRD F2 walkthrough manually against the test's expected output — every weight, every actualReps, every action matches the PRD verification section step 3.

---

## System-Wide Impact

- **Interaction graph:** This module is the *single* consumer of routine semantics at the per-set level. Survivor 4's active-session component will dispatch set-actions into `applyAction`; the exercise-list/drawer will dispatch `JumpTo { exerciseIdx }` to move the cursor; Survivor 4's `/session/[id]/actions.ts` server action will persist `setLogs` to `set_logs` (after Survivor 3 lands the schema). The post-session prompt UI will render `classifyPostSession` output. No other module reads or mutates session state. Note that `cursorOverride` is a transient, single-write field — it never appears in persisted state because Survivor 4 only persists `setLogs` (the session-complete payload), and by definition no override survives the next action.
- **Error propagation:** `applyAction` throws on invalid action (R21). Callers in Survivor 4 must let these throws propagate to a top-level error boundary in the runner UI — they are programmer errors, not user errors, and surfacing them as crashes during development is the point. The active-session UI's `useOptimistic` boundary will need to catch these in production to avoid breaking the optimistic update flow; that catching layer is Survivor 4's concern, not this module's.
- **State lifecycle risks:** None within the FSM (no I/O, no async). The shape contract — `setLogs` as the only field, append-only via `applyAction`, pop-only via `undo` — means there is no partial-write or duplicate-log scenario possible from this module alone. Risks emerge at the persistence seam in Survivor 4 (e.g., a server action that partially writes set logs and crashes); those belong in Survivor 3's transaction-boundary plan.
- **API surface parity:** None. This is the first place the rules are codified. Future contributors who want to write a "next weight calculator" or "did the user succeed at this set?" check should import from this module, not re-implement.
- **Integration coverage:** The F2 fixture in U6 is the highest-value integration test — it exercises `applyAction`, `nextTarget`, and `classifyPostSession` together over a 9-dispatch sequence. Unit-level mocks won't prove that the three functions agree; the fixture does.
- **Unchanged invariants:** The foundation PR's contract — `/api/health` returns 200, `/metrics` exposes prom-client metrics, the logger writes to stdout/file per `LOG_FILE_PATH` — is untouched. This PR adds files; it does not modify any existing file in `apps/swole/src/`. Survivor 4 may later co-locate `src/db/` and `src/app/session/` work, but those are separate PRs.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| PRD's set-action semantics drift between this module and Survivor 4's UI. | The module is the canonical source. Survivor 4 imports from it and must not re-derive next-weight logic in client components. A code review checkpoint at Survivor 4 enforces this. |
| FSM types use camelCase (`startingWeight`, `targetReps`, `durationSeconds`); Drizzle's `$inferSelect` from a snake_case schema produces snake_case TS types. At Survivor 3 reconciliation, every fixture in `session-machine.spec.ts` and every downstream consumer of `Exercise` / `Routine` would need a rename pass if the camelCase ↔ snake_case mismatch is not addressed by Drizzle config. | Survivor 3 picks one of: (a) Drizzle config `casing: 'snake_case'` — exposes camelCase TS types over snake_case columns natively, no rename pass needed (recommended); (b) rename Drizzle columns to camelCase (unconventional for SQL); (c) keep snake_case TS types and rename every FSM fixture at reconciliation. Either FSM types become the source of truth and Drizzle aligns, or Drizzle's `$inferSelect` shapes become canonical and the FSM imports them — defer the final choice to Survivor 3 when both shapes exist concretely. |
| 100% branch coverage requirement could mask logic bugs if the test matrix has holes. | The R18 matrix (action × type × position) is enumerated explicitly in U2's test scenarios. Add a coverage-tool-level branch coverage check (`pnpm --filter @lilnas/swole test:cov` shows the report); manually inspect for any line/branch not covered before claiming the unit done. Coverage threshold enforcement in `jest.config.js` is intentionally deferred per Scope Boundaries (this is a single-file module; threshold enforcement makes more sense once Survivor 3/4 broaden the surface). |
| `Failed` payload semantics on time-based exercises (actualReps vs actual seconds) was a known PRD inconsistency. | Resolved at the FSM layer by splitting `SetLog` into separate `actualReps?` and `actualDuration?` fields. The `Failed` action's payload field name (`actualReps`) is fixed by R5; `applyAction` routes the payload to the right `SetLog` field based on `exercise.type`. Survivor 3's `set_logs` schema gets `actual_reps` and `actual_duration_seconds` as separate columns naturally; downstream UI does not need `exercise.type`-aware rendering. |
| Implementer reaches for `useReducer`/`useOptimistic` adapters inside this module, breaking the no-React rule. | The R1 contract is explicit ("no React, no NestJS, no Drizzle"). Code review must reject any `import 'react'` in `session-machine.ts`. ESLint will not catch this on its own — the reviewer must. |
| `JumpTo` and `cursorOverride` introduce a second state dimension (cursor) parallel to `setLogs`, complicating the "any prefix of setLogs is a valid state" invariant. | The override is single-write: it's cleared by every non-JumpTo dispatch and by `undo`. Therefore at most one bit of additional state exists at any time, and it is cleared by the next action. Tests pin clearing behavior explicitly (U2b's "subsequent dispatch clears the override" scenario, U3's "undo clears the override" scenario). The append-only history invariant on `setLogs` is unchanged. |
| Subtle off-by-one in `nextTarget`'s "past last set" logic causes the cardio single-set case to misbehave. | U4 explicitly tests this with a dedicated scenario. The same "past last set" logic is tested at multiple positions (mid-exercise, end-of-exercise, end-of-routine) so any indexing bug shows in more than one test. |

---

## Documentation / Operational Notes

- No README change. The module is consumed by code, not by humans reading the README. Survivor 4 may add a "Session Runner" section to `apps/swole/README.md` when the UI lands.
- No ADR. ADR-001 covers the data-flow direction; this module sits cleanly inside that decision and adds no new architectural choice worth recording.
- No `docs/solutions/` entry per Scope Boundaries.
- No operational rollout, no feature flag, no migration. The module is added; no existing path is rewired. Survivor 4 will pick it up when ready.
- After this PR merges, the next swole PR (Survivor 3 schema or Survivor 4 runner UI) will be the first consumer. Reviewers of those PRs should verify the consumer imports from `src/core/session-machine` and does not duplicate any rule.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-26-swole-session-machine-requirements.md](../brainstorms/2026-05-26-swole-session-machine-requirements.md)
- **Upstream PRD:** [docs/prds/swole.md](../prds/swole.md) — set-action semantics, F2/F3 fixtures, exercise-type table
- **Foundation plan (Survivor 1, prerequisite, merged):** [docs/plans/2026-05-26-001-feat-swole-infra-foundation-plan.md](2026-05-26-001-feat-swole-infra-foundation-plan.md)
- **ADR-001 (data flow):** [apps/swole/docs/adr/001-data-flow.md](../../apps/swole/docs/adr/001-data-flow.md)
- **Jest config (test layout reference):** `apps/swole/jest.config.js`
- **Existing pure-logic Jest precedent:** `apps/tdr-bot/src/message-handler/utils/__tests__/message-utils.spec.ts`
- **Import-path convention precedent:** `apps/swole/src/lib/logger.ts:4` (`import { EnvKeys } from 'src/env'`)
