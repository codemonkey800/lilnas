---
date: 2026-05-26
topic: swole-session-machine
---

# Swole — Session State Machine (Survivor 2)

## Problem Frame

The active-session screen, the post-session weight-progression prompt, and the server action that persists a completed session all need to agree on the rules of the game: when Increment bumps the next set's weight, what Stay means on the last set, how Failed interacts with the next set's weight. Bugs in this logic corrupt history permanently — it is the only place in v1 where a slip writes wrong data to SQLite forever.

The fix is to extract the rules into one pure TypeScript module that both the UI and the persistence layer import. Exhaustive tests pin every (action × exercise type × set position) cell. No React, no NestJS, no SQLite. The data model in Survivor 3 then emerges from the FSM's needs rather than being designed in the abstract.

---

## Requirements

**Module location and exports**

- R1. Module lives at `apps/swole/src/core/session-machine.ts`. Pure TypeScript: no React, no NestJS, no Drizzle, no `better-sqlite3` imports.
- R2. Public API: four pure functions — `applyAction`, `undo`, `nextTarget`, `classifyPostSession`. Plus types: `SetLog`, `SessionState`, `Action`, `Routine`, `Exercise`, `PostSessionPrompt`.

**State shape**

- R3. `SessionState = { setLogs: SetLog[] }`. No other fields. Cursor, current weight/target, and "is the session finished" are all derived — never stored.
- R4. `SetLog` shape: `{ exerciseIdx, setIdx, weight?, reps?, actualReps?, duration?, action }`. Matches the future SQLite `set_logs` row shape exactly so persistence is a 1:1 map at session-complete time.

**Action vocabulary**

- R5. `Action` is a discriminated union of the eight PRD button labels: `Increment`, `Stay`, `Decrement`, `Complete`, `Hold`, `Done`, `Skipped`, `Failed`. The first seven have no payload; `Failed` carries `{ actualReps: number }` — the modal collects this value before dispatch, so the action itself is fully resolved when it reaches `applyAction`.

**Behavior — `applyAction`**

- R6. `applyAction(state, action, routine) → SessionState` appends one new `SetLog` to `state.setLogs` and returns a new state. Pure; no mutation of the input.
- R7. The weight for the *new* log is computed from the *last* `SetLog` belonging to the same exercise (`exerciseIdx`): `Increment` → prior weight + increment, `Decrement` → prior weight − increment, anything else → prior weight unchanged. If no prior log exists for that exercise yet, use the routine's `starting_weight` for the exercise. Bodyweight / time-based / cardio exercises ignore weight entirely.
- R8. `Failed` records `actualReps` in the new log. The *next* set's weight is computed as if the prior action were `Stay` (per PRD `Set actions — semantics`).
- R9. `applyAction` is responsible only for appending the correct log. It does not validate cursor advance, cross-exercise transitions, or "is the session finished" — those concerns are derived via `nextTarget`.

**Behavior — `undo`**

- R10. `undo(state) → SessionState` returns a new state with the last `SetLog` removed. If `setLogs` is empty, returns the input state unchanged.
- R11. There is no separate undo stack. There is no redo in v1.

**Behavior — `nextTarget`**

- R12. `nextTarget(state, routine) → { weight?, reps?, duration?, exerciseIdx, setIdx } | null` returns what the UI should render for the next set. Reads `state.setLogs` and `routine` to compute the next exercise + set index, then applies R7's rules to derive the target.
- R13. Returns `null` when every (exerciseIdx, setIdx) prescribed by the routine has a corresponding `SetLog` — i.e., the session is complete.

**Behavior — `classifyPostSession`**

- R14. `classifyPostSession(state, routine) → PostSessionPrompt[]` returns one prompt per *weighted* exercise that had at least one set logged this session.
- R15. For each weighted exercise, compute lowest, highest, and ending weight across its set logs. Lowest ≥ original starting weight → emit Case A prompt (offer `Stay` at original SW or `Roll up` to `starting_weight + increment`). Lowest < original starting weight → emit Case B prompt (informational; new SW = lowest used).
- R16. Bodyweight, time-based, and cardio exercises emit no prompt regardless of what happened during the session.

**Tests**

- R17. Test file at `apps/swole/src/core/session-machine.spec.ts` (adjacent), matching whichever Jest convention the foundation PR settled on.
- R18. Exhaustive table covering every (action × exercise type × set position) cell that the PRD permits. Each test name encodes the cell — e.g., `"Weighted, Increment on first set → next set weight = start + increment"`.
- R19. Named fixture tests literally encoding PRD F2 (Bench Press → Pushups → Plank walkthrough) and PRD F3 (cases A and B).
- R20. Undo tests: dispatch action → undo → assert state equals the pre-dispatch state. Plus undo-on-empty returns input unchanged.
- R21. Invalid-action tests: dispatching an action that does not belong to the current exercise's type (e.g., `Increment` on a bodyweight exercise) throws.

---

## Success Criteria

- `pnpm --filter @lilnas/swole test session-machine` passes with 100% branch coverage on `session-machine.ts`.
- The PRD F2 walkthrough is one test that asserts the final `SessionState` after dispatching the full action sequence (Increment, Stay, Complete, Failed(actualReps=12), Complete, Complete, Hold, Hold, Hold).
- The PRD F3 Case A fixture asserts the post-session prompt for Bench Press offers `Stay` at 100 or `Roll up` to 105.
- The PRD F3 Case B fixture (lowest set dipped to 95) asserts the prompt is informational and the implied new SW is 95.
- `pnpm --filter @lilnas/swole lint` and `pnpm --filter @lilnas/swole type-check` both pass.
- The next PR (Survivor 3 schema, or Survivor 4 runner UI) imports from `apps/swole/src/core/session-machine.ts` without modifying the module and without duplicating any of its rules in a server action or React component.

---

## Scope Boundaries

- No persistence. The FSM never writes to SQLite. Saving a completed session's `setLogs` is the job of the active-session server action (Survivor 4).
- No React or UI bindings. The FSM does not import `react`. Consumers wire it to `useReducer` / `useOptimistic` themselves.
- No SQLite schema work. The `SetLog` *shape* matches the planned `set_logs` table, but the table itself lands in Survivor 3.
- No out-of-order exercise jumps. If the runner UI needs them later, add a `JumpTo` action then; deferring keeps this PR's surface small.
- No routine validation. `applyAction` and friends assume the caller passes a well-formed routine (exercise types and required fields per the PRD's exercise-type table). Validation belongs in the routine builder.
- No redo.
- No in-flight session recovery across browser reloads. (If desired later, the caller can dump `state.setLogs` to `localStorage` on each action — but that decision belongs to Survivor 4.)
- No `docs/solutions/` entry. The FSM is internal swole logic, not a monorepo-wide reusable pattern. The first `docs/solutions/` entry is reserved for Survivor 3's SQLite-in-monorepo writeup.

---

## Key Decisions

- **State is `{ setLogs: SetLog[] }`, not an abstract action log.** A `SetLog` already carries everything an event would (action type plus the values resolved at dispatch time). Using set logs *as* state means the FSM's in-memory shape and the SQLite shape are the same — no second representation, no `derive(actions) → setLogs` step at session-complete, no risk of the two diverging.
- **True undo via `setLogs.pop()`, no separate undo stack.** The running log *is* the undo stack. The property "any prefix of `setLogs` is a valid `SessionState`" holds by construction; nothing parallel to keep consistent.
- **No `currentTarget` field on state; derived via `nextTarget(state, routine)`.** Tradeoff: UI calls `nextTarget` per render instead of reading state directly. For ~60 sets per workout the cost is invisible. Benefit: zero fields that could disagree with `setLogs`.
- **Action vocabulary uses the PRD's eight labels verbatim.** Every UI tap maps 1:1 to a log entry; "user tapped X" is recoverable from history. Rejected: collapsing to semantic actions (`BumpUp` / `Hold` / `Skip` / etc.) — loses the user-intent trace and forces a translation layer in the UI for no gain.
- **`Failed` carries `actualReps` as payload.** The modal collects this value before the action ever reaches `applyAction`, which keeps `applyAction` synchronous and pure — no "waiting for input" intermediate state to model.
- **`classifyPostSession` lives in the same module as `applyAction`.** Same rules of the game, tested side by side. A separate file would let the post-session rules drift away from the per-set rules they depend on.
- **Routine is an argument, not state.** It does not change during a session, so threading it through `applyAction(state, action, routine)` and `nextTarget(state, routine)` is fine. Closures or factory functions ("`createMachine(routine)`") would hide the dependency without simplifying tests.

---

## Dependencies / Assumptions

- The `Routine` and `Exercise` types are defined inside `session-machine.ts` for now. Survivor 3 lands the Drizzle schema; at that point the FSM's `Routine`/`Exercise` types are reconciled with Drizzle-generated types (probably by importing from the schema module and dropping the local definitions).
- The eight PRD action labels are stable. A label change ripples to every dispatch site and every test.
- The PRD's set-action semantics in `Set actions — semantics` and the F3 case A/B rules are final. Confirmed by the PRD's "Resolved decisions" section: decrements below starting weight are allowed, and the new SW in case B is the lowest weight used.
- The FSM is single-session. The caller owns session lifecycle ("start a session", "discard a session", "switch routines"); the FSM is unaware of more than one session at a time.
- The caller treats `SessionState` as opaque. Reading or mutating `setLogs` directly bypasses the FSM contract; the spec tests pin behavior only against the four public functions.
- The infra-foundation PR (Survivor 1) has merged before this PR opens. That PR removes NestJS and locks the data-flow ADR, so this module ships into a stable scaffold.

---

## Outstanding Questions

### Resolve Before Planning

_None. Product and design decisions are settled._

### Deferred to Planning

- [Affects R1, R17] Final module and test paths. `apps/swole/src/core/session-machine.ts` matches the PRD's post-revision file structure, but if the foundation PR moved shared logic to `src/lib/` (alongside `logger.ts`), align with that. Same call for `__tests__/` subdirectory vs adjacent `.spec.ts`.
- [Affects R7] `Decrement` clamping. PRD allows unlimited decrements. The FSM applies `prior − increment` literally; if a routine has a 50 lb increment and the user decrements past zero, the log records a non-positive weight. Planner decides whether to clamp at zero or let the value flow through unmodified (preferred default: no clamp; a non-positive weight in a SetLog is a routine-config bug, not an FSM bug).
- [Affects R21] Throw vs return-error on invalid action. Default: throw. The UI should never present an invalid button for the current exercise type, so any invalid dispatch is a caller bug worth crashing on. Confirm during planning if there is a reason to soften this (e.g., a defensive product-action layer).
- [Affects R12, R13] Cardio `nextTarget` after the single Done/Skipped log. After the one cardio set, `nextTarget` advances to the next exercise via normal "past last set" path. Enumerate this case during test layout to be sure the index math handles single-set exercises.
- [Affects R2] Whether to export an `initialState()` helper (`{ setLogs: [] }`) for symmetry with `applyAction`/`undo`. Trivial; planner picks. Default: yes, for discoverability.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
