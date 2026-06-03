---
title: Pure-TypeScript FSM Core for Stateful Domain Logic
date: 2026-05-27
category: architecture-patterns
module: swole/session-machine
problem_type: architecture_pattern
component: service_object
severity: medium
related_components:
  - testing_framework
  - documentation
applies_when:
  - Building stateful domain logic that needs undo, replay, or audit history
  - "Domain has a finite, enumerable matrix of (action × context) transitions worth exhaustively testing"
  - The same logic must run in both UI and server paths without divergence
  - Spec contains multiple cross-referenced rules where contradictions are likely
  - Future migration to event sourcing or server-side persistence is plausible
tags:
  - finite-state-machine
  - pure-functions
  - append-only-state
  - exhaustive-testing
  - table-driven-tests
  - undo-support
  - typescript
  - swole
---

# Pure-TypeScript FSM Core for Stateful Domain Logic

## Context

The `apps/swole` workout app has three downstream consumers that must agree on the rules of one game: the active-session client component (renders the next target, dispatches actions when the user taps a set button), the `/session/[id]` server action that persists a completed session's set logs to SQLite, and the post-session prompt UI that asks the user whether to roll their starting weight up next session. If any two of these diverge — e.g., the UI bumps weight on `Increment` but the server action persists the pre-bump weight, or the post-session prompt's "lowest weight" calculation drifts from the runner's "stay at SW" notion — the SQLite row written is wrong. There is no rollback in v1; the user lives with corrupted history.

The plan called this out as the only place in v1 where a logic slip writes wrong data to SQLite forever — making "logic correctness" the dominant risk, not infrastructure.

## Guidance

Extract per-feature business rules into one pure-TypeScript module with no framework imports. The module is the single source of truth; UI components, server actions, and persistence layers consume it unchanged.

### Module shape

`apps/swole/src/core/session-machine.ts` — 421 lines. No `import 'react'`, no NestJS decorators, no Drizzle, no `better-sqlite3`. Five public exports:

```ts
export function initialState(): SessionState
export function applyAction(state: SessionState, action: Action, routine: Routine): SessionState
export function undo(state: SessionState): SessionState
export function nextTarget(state: SessionState, routine: Routine): NextTarget | null
export function classifyPostSession(state: SessionState, routine: Routine): PostSessionPrompt[]
```

### State shape — append-only log plus a single escape hatch

Every derived question (current target weight, "is the session finished") is computed on read, not stored:

```ts
export type SessionState = {
  setLogs: SetLog[]
  cursorOverride?: number
}
```

Any prefix of `setLogs` is itself a valid `SessionState` — the invariant that makes undo trivial.

### Action union — discriminated, matches the product surface 1:1

The PRD's eight set-action button labels plus one out-of-order navigation primitive. The discriminated union lets TypeScript narrow inside the dispatch switch:

```ts
export type Action =
  | { type: 'Increment' }
  | { type: 'Stay' }
  | { type: 'Decrement' }
  | { type: 'Complete' }
  | { type: 'Hold' }
  | { type: 'Done' }
  | { type: 'Skipped' }
  // Failed is split by exercise kind so the field name matches the units.
  // Weighted / bodyweight: actualReps. Time-based: actualDuration (seconds).
  // Both variants share `type: 'Failed'` for the schema enum; consumers use
  // `'actualDuration' in action` to discriminate when needed.
  | { type: 'Failed'; actualReps: number }
  | { type: 'Failed'; actualDuration: number }
  | { type: 'JumpTo'; exerciseIdx: number }
```

### `applyAction` — pure, throws on invalid input

No input mutation. Returns a new state object. Invalid actions (e.g., `Increment` on a bodyweight exercise) throw rather than silently no-op — callers are expected to guard before dispatching:

```ts
export function applyAction(
  state: SessionState,
  action: Action,
  routine: Routine,
): SessionState {
  if (action.type === 'JumpTo') {
    if (action.exerciseIdx < 0 || action.exerciseIdx >= routine.exercises.length) {
      throw new Error(/* ... */)
    }
    return { setLogs: state.setLogs, cursorOverride: action.exerciseIdx }
  }
  // ... validate, build newLog ...
  return { setLogs: [...state.setLogs, newLog] }
}
```

### `undo` — log pop, override cleared

The log *is* the undo stack:

```ts
export function undo(state: SessionState): SessionState {
  if (state.setLogs.length === 0) {
    if (state.cursorOverride == null) return state
    return { setLogs: [] }
  }
  return { setLogs: state.setLogs.slice(0, -1) }
}
```

### `cursorOverride` — single-write, transient

`JumpTo` writes it. Every other action returns a new object that omits the field, naturally clearing it. The override never persists into SQLite because only `setLogs` are persisted, and by definition no override survives the next set-action dispatch.

This shape was **not** in the original brainstorm (session history). It was added during plan review when a scope reviewer flagged that the JumpTo product requirement had no home in the original state model. U2b was added to the plan as a dedicated unit for it.

### `nextTarget` and `classifyPostSession` — pure derivations

Both take `(state, routine)` and return a plain value. `nextTarget` returns `null` when the session is complete; `classifyPostSession` emits one Case A / Case B prompt per weighted exercise with at least one logged set.

The R7 weight-derivation rule (Increment → prior + increment, Decrement → prior − increment, Stay/Complete/Failed → prior unchanged, no prior log → routine's `startingWeight`) lives in **one** private helper that both `applyAction` (computing the new log's weight) and `nextTarget` (computing the preview weight) call. No rule lives in two places, even within the module.

## Why This Matters

**Testability.** The spec file is 1836 lines, 122 tests, executing in plain Jest with no React renderer, no DB, no Docker, no fixtures spun up. The whole correctness contract — every (action × exercise type × set position) cell the PRD permits, plus the F2 walkthrough and F3 Case A/B fixtures — runs as fast as a pure-function test should. When the runner UI wires the FSM into `useOptimistic` and a server action, those layers get their own tests, but the rule layer is already pinned and stays still.

**Plan-implementation feedback loop.** The brainstorm and plan were exhaustive (R1–R21, six implementation units U1–U6, hundreds of named test scenarios), but the test-first discipline still caught a contradiction the prose didn't. U2's last-set matrix prescribed "prior Stay, current Decrement on last set → weight = 95", which contradicted R7's by-prior-action rule. The commit message records: "Resolved in favor of R7; replaced the anomalous scenario with two clearer tests pinning by-prior-action semantics." A plan that hadn't been tested couldn't have caught this. A plan that was tested through a UI couldn't have isolated it.

**Refactor safety.** The FSM is an internal interface. React components, server route handlers, and persistence sit on top, but none re-implement any rule. The next chunk lifts the `SetLog` shape into Drizzle; persistence becomes a name-rename map plus housekeeping columns. The chunk after that imports `applyAction` into a `useReducer`. If a future PR wants to change how `Failed` behaves on time-based exercises, it changes one switch arm in one file and watches 122 tests tell it whether anything broke.

**Coverage as a correctness contract — with caveats.** 100% lines/functions, 95.45% branches. Uncovered branches are defensive guards against hand-constructed states the type system already forbids. The plan deliberately did **not** enforce a coverage threshold in `jest.config.js` — the threshold is enforced socially via the matrix being enumerated explicitly in the plan, scenario by scenario, before any code was written. "100% branches" without a matrix would be Goodhart's law; "100% branches earned by enumerating the matrix" is a real guarantee.

**Honest caveat — exhaustive matrices still miss things.** A post-commit code review (session history) flagged a P1 gap in `classifyPostSession`: it ignored `Failed` action logs entirely, so a session where the user failed every set would classify the same as a clean session. The exhaustive *action × exercise type × set position* matrix caught every transition rule but didn't probe the *classification* function deeply against all action types. Lesson: matrix-cover the inputs to every public function, not just the dominant one. The pattern doesn't make code review obsolete — it makes the surface for review small enough that review actually finds things.

**The cost.** One extra indirection vs. inlining the rule in a React component or server action. For trivial forms with no derived rules, this cost is not worth paying. The pattern pays off when (a) the same rules drive both UI and persistence, (b) the rules are non-trivial enough that a 122-test matrix is justified, (c) bad outcomes are durable (write-to-disk, send-to-network, charge-a-card) rather than ephemeral.

## When to Apply

- When per-set / per-step / per-event business rules are non-trivial and the same rule must be enforced in two or more places — UI render + server-side persist is the canonical case.
- When the same logic drives both a UI render decision (e.g., "what to show as the next target") and a post-action classification (e.g., "did the user meet their starting weight").
- When undo is a product requirement — the append-only log makes undo a `slice(0, -1)`.
- When the cost of a logic slip is durable corruption (writes to disk, charges a card, sends an email) rather than a transient UI glitch.
- When the data shape that comes out of the FSM is approximately the shape that goes into persistence — collapsing two representations into one removes a `derive(actions) → rows` step that could disagree with the FSM.

**Don't apply when:** the form is trivial (no derived rules), the UI is the only consumer (no persistence layer to keep in sync), or the rule lives in one component and is unlikely to be needed elsewhere. The indirection cost wins.

## Examples

### The design evolved through three rounds before the simple shape won (session history)

The brainstorm session evaluated three state-model options:

1. **Cursor + set logs** — position-tracking cursor alongside an append-only log.
2. **Cursor + set logs + precomputed `currentTarget`** — added a derived/cached field to avoid recomputation.
3. **Event-sourced action log** — `state = Action[]`, undo = `state.slice(0, -1)`. Made undo "free."

Option 3 was initially locked after undo was confirmed as a v1 requirement. The user then pushed back: *"this seems so complicated, why can't we just maintain simple state like weight... it's easy to undo by just decrementing."* The design was stripped back to `SessionState = { setLogs: SetLog[] }`. Set logs were needed anyway for the post-session prompt (F3) and stats (F4); everything else (current weight, cursor, current set) derives from the last set log. The most significant simplification in the prehistory came from the user rejecting over-engineering.

### The U2 / R7 contradiction story

The plan's U2 implementation unit specified, in its weighted-last-set scenarios, "prior `Stay` (weight 100), current = `Decrement` (inc 5) on last set → new log weight = 95." This contradicted R7's by-prior-action rule used consistently across the F2 fixture, U4's `nextTarget` tests, and U5's classification: the *new* log's weight is computed from the *prior* log's action, not the current one. Both readings are internally coherent in isolation but emit different `SetLog.weight` values for the same dispatch sequence, which would fail the F2 9-log equality assertion.

The implementer hit the contradiction during U2 and resolved it in favor of R7 (by-prior-action wins because the F2 fixture and the `nextTarget` agreement test both depend on it). The anomalous scenario was replaced with two clearer tests pinning by-prior-action semantics. Without an exhaustive matrix and a literal F2 fixture, the contradiction would have surfaced months later as a one-off bug report from a user whose 100% completion session showed up in history with weights off by an increment.

### Exhaustive-matrix tests where the table beats repetition

The bodyweight invalid-action enumeration packs six error cases into one table-driven test:

```ts
it.each([
  ['Increment', { type: 'Increment' } as Action],
  ['Stay', { type: 'Stay' } as Action],
  ['Decrement', { type: 'Decrement' } as Action],
  ['Hold', { type: 'Hold' } as Action],
  ['Done', { type: 'Done' } as Action],
  ['Skipped', { type: 'Skipped' } as Action],
])('%s on bodyweight → throws', (_label, action) => {
  expect(() =>
    applyAction(initialState(), action, bodyweightRoutine),
  ).toThrow(/Invalid action/)
})
```

Other matrix tests stay as explicit `it()` blocks where assertions diverge per cell. The rule: prefer explicit `it()` blocks so failures point at named scenarios; reach for `describe.each` / `it.each` only when the table-driven shape genuinely beats repetition.

### The F2 9-log assertion as the integration-level contract

PRD F2 ("Run a session") prescribes a Push Day workout: Bench Press 3 sets, Pushups 3 sets, Plank 3 sets, with a specific action sequence. The F2 fixture test dispatches that sequence — `Increment, Stay, Complete, Failed(12), Complete, Complete, Hold, Hold, Hold` — through `applyAction` and asserts the entire final `setLogs` array deep-equals a 9-entry expected array, log by log, weight by weight. It then chains two further assertions: `nextTarget(final, pushDay)` returns `null` (session complete), and `classifyPostSession(final, pushDay)` returns exactly one Case A prompt for Bench Press only.

One test, three public functions, the entire F2 contract. If any rule drifts — Stay records the wrong weight, Failed forgets `actualReps`, `classifyPostSession`'s lowest/highest math slips — this one test fails loudly.

## Related

- `apps/swole/src/core/session-machine.ts` — the FSM module.
- `apps/swole/src/core/session-machine.spec.ts` — 122-test matrix + F2/F3 fixtures.
- `apps/swole/docs/adr/001-data-flow.md` — the data-flow contract the FSM plugs into (Next.js everywhere, Drizzle in server actions, `useOptimistic` for the runner UI).
- `docs/brainstorms/2026-05-26-swole-session-machine-requirements.md` — R1–R21 requirements.
- `docs/plans/2026-05-26-002-feat-swole-session-machine-plan.md` — U1–U6 implementation slices, named test fixtures.
- `docs/prds/swole.md` — the eight button labels, four exercise types, "single device of truth" persistence model.
- `docs/ideation/2026-05-26-swole-next-build-chunk-ideation.md` — selected the FSM as the next build chunk on the "logic is the bug surface, not infra" rationale.
