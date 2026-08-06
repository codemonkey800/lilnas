---
title: "Atomicity tests must reach the write phase, not stop at a pre-write guard"
date: 2026-06-03
category: conventions
module: swole/db
problem_type: convention
component: testing_framework
related_components:
  - database
severity: medium
applies_when:
  - "Writing a rollback/atomicity test for a db.transaction() whose guards throw before any write"
  - "The function under test performs a multi-step write (delete children, then parent) that must be all-or-nothing"
  - "You need to verify the store actually rolls back a partial write on a mid-transaction failure"
tags:
  - testing
  - transactions
  - atomicity
  - rollback
  - sqlite
  - drizzle-orm
  - jest
  - vacuous-test
---

# Atomicity tests must reach the write phase, not stop at a pre-write guard

## Context

A transactional mutation has two distinct phases: the **guard phase** (pre-condition
checks that abort *before* any write) and the **write phase** (the multi-step
mutation the transaction exists to protect). An atomicity test is only meaningful
if it exercises the *write* phase and then forces a failure partway through it — so
the assertion "the partial write was undone" can only hold if the store genuinely
rolled back.

The `apps/swole` session-detail branch shipped a test that looked correct but
exercised the wrong phase. `deleteSession` ([`apps/swole/src/db/sessions.ts:229`](../../../apps/swole/src/db/sessions.ts))
runs under `db.transaction(cb, { behavior: 'immediate' })` and deletes leaf-first:
child `set_logs`, then the `sessions` row. It has two guards that throw *before* any
delete — a state guard (`completedAt != null` → `SessionNotCompleted`) and an
FK-safety guard (no `session_progression` row → `SessionHasProgression`). The
original test, named `'atomicity: forced mid-transaction failure leaves no partial
state'`, inserted a `session_progression` row so the FK-safety guard threw, then
asserted the session and its `set_logs` were still present. Its own comment admitted
the misdirection: *"Instead, we verify the positive case."*

A 10-lens code review flagged it (corroborated by 4 independent lenses): the
production code was genuinely atomic — only the test failed to prove it. *(session history)*

## Guidance

### Spot the smell with one question

> **Would this test still pass if I deleted the transaction wrapper and ran the
> writes as plain sequential statements?**

If yes, the test is **vacuous** — it asserts nothing about atomicity. The tell-tale
signs:

- The seeded state triggers a guard that fires before any write runs.
- The test asserts "nothing changed" but never wrote anything in the first place.
- A comment hedges away from the test's name (*"we verify the positive case"*).

### Make the test genuine in three moves

1. **Seed state so every guard passes.** Each pre-write guard is a path diversion;
   the seeded data must satisfy *all* of them so execution reaches the write phase.
   For `deleteSession`: a completed session (state guard passes) with `set_logs` and
   **zero** progressions (FK-safety guard passes).

2. **Inject the fault *after* a real write, *inside* the transaction.** The failure
   must land when the transaction already holds dirty state, so rollback has
   something to undo.

3. **Assert the undo, not the no-op.** "`set_logs` still has length 1" is only a
   meaningful claim when a real delete physically ran and was reversed.

### Two ways to inject a mid-transaction fault — pick by what's available

**(a) A natural constraint violation (no test double).** When a real `CHECK`/`FK`/
`UNIQUE` constraint can fire *after* the first write, let it. `progressions.spec.ts`'s
`'mid-tx rollback …'` test ([`apps/swole/src/db/__tests__/progressions.spec.ts:249`](../../../apps/swole/src/db/__tests__/progressions.spec.ts))
inserts a `session_progression` row, then drives an inner `exercises` update that
violates a bodyweight `startingWeight` `CHECK` — SQLite aborts the transaction and
rolls back the already-inserted progression. Prefer this when the schema offers a
real constraint: it tests the production failure path with zero mocking.

**(b) A spyable seam at the write boundary.** When no natural constraint can
interrupt the sequence (a plain leaf-first delete has none), extract the first write
into a **named, exported** function that takes the transaction handle as a parameter,
then spy on it. `deleteSession` does this with `deleteSessionSetLogs`
([`apps/swole/src/db/setLogs.ts:51`](../../../apps/swole/src/db/setLogs.ts)),
mirroring the existing `deleteRoutineChildren` seam ([`apps/swole/src/db/exercises.ts:71`](../../../apps/swole/src/db/exercises.ts)).
The `executor` parameter (`{ delete: typeof db.delete }`) is what lets the same
function run against the live `tx` in production and be spied in the test:

```ts
// apps/swole/src/db/setLogs.ts — the extracted seam
type DeleteExecutor = { delete: typeof db.delete }

// Extracted as a named export so rollback tests can spy on it
// (matching the deleteRoutineChildren pattern in exercises.ts).
export function deleteSessionSetLogs(executor: DeleteExecutor, sessionId: number): void {
  executor.delete(setLogs).where(eq(setLogs.sessionId, sessionId)).run()
}
```

The production caller passes `tx`: `deleteSessionSetLogs(tx, args.sessionId)`.

> **Avoid the dead-end:** don't reach for `jest.mock('src/db/schema')` to fabricate a
> failing write — an earlier attempt did this and died on a `TS6133` unused-import
> error. Spy on a real exported seam (option b) or use a real constraint (option a).
> *(session history)*

Always `spy.mockRestore()` in a `finally` block so the double can't leak into other
tests.

## Why This Matters

A vacuous atomicity test is worse than no test: it shows green and broadcasts false
confidence. It stays green if someone removes the `transaction` wrapper, reverses the
delete order, or swallows the error after a partial write — exactly the regressions an
atomicity test exists to catch. The danger compounds here because the operation under
test is an **irreversible delete**: the day a partial delete commits half a
transaction in production, this suite would never have warned you. The name, the
structure, and the assertions all *look* right; only the injected fault — the entire
mechanism — is missing. A genuine rollback test fails when the transaction is broken
and passes when it works; a vacuous one does neither.

## When to Apply

Any test that claims to verify atomicity, rollback, or "all-or-nothing" semantics.
The reasoning is store- and framework-agnostic — it applies equally to Postgres via
pg/Prisma, Redis pipelines, or any multi-step write wrapped in a compensating
transaction. The recipe never changes: **pass all guards → perform a real write →
inject the fault after that write → assert the write was undone.** The seam
extraction is also a design win on its own: named write helpers with an explicit
`executor` parameter read clearly and are testable independent of transaction
context.

Reach for it the moment you see a "rollback" test that seeds guard-triggering state,
hedges in a comment, or asserts data is unchanged without ever having changed it.

## Examples

**Before — vacuous (guard refuses; the write phase never runs):**

```js
it('atomicity: forced mid-transaction failure leaves no partial state', async () => {
  const { deleteSession, getSession } = await import('src/db/sessions')
  const { getSetLogsForSession } = await import('src/db/setLogs')
  const { progressions } = await import('src/db/schema')
  // Inserting a progression makes the FK-safety guard throw SessionHasProgression — BEFORE any delete runs.
  testDb.db.insert(progressions).values({
    exerciseId, sessionId, startingWeight: 105, reason: 'session_progression',
  }).run()
  await expect(deleteSession({ sessionId })).rejects.toThrow()
  // "Nothing changed" is trivially true: nothing was ever written.
  expect(await getSession({ id: sessionId })).not.toBeNull()
  expect(await getSetLogsForSession({ sessionId })).toHaveLength(1)
})
```

**After — genuine (guards pass, a real delete runs, rollback is exercised):**
[`apps/swole/src/db/__tests__/sessions.spec.ts:507`](../../../apps/swole/src/db/__tests__/sessions.spec.ts)

```js
it('atomicity: throw after set_logs delete rolls back the whole transaction', async () => {
  // beforeEach seeds a completed session + 1 set_log with no progressions,
  // so both guards pass and the delete phase actually executes.
  const sessionsModule = await import('src/db/sessions')
  const setLogsModule = await import('src/db/setLogs')
  const { getSession } = sessionsModule
  const { getSetLogsForSession } = setLogsModule

  const realDeleteSessionSetLogs = setLogsModule.deleteSessionSetLogs
  const spy = jest.spyOn(setLogsModule, 'deleteSessionSetLogs')
    .mockImplementationOnce((executor, sId) => {
      realDeleteSessionSetLogs(executor, sId)     // real delete runs inside the tx
      throw new Error('injected mid-tx failure')  // fault fires before the sessions delete
    })

  try {
    await expect(sessionsModule.deleteSession({ sessionId }))
      .rejects.toThrow(/injected mid-tx failure/)
    // These pass ONLY if SQLite rolled back the real set_logs delete.
    expect(await getSession({ id: sessionId })).not.toBeNull()
    expect(await getSetLogsForSession({ sessionId })).toHaveLength(1)
  } finally {
    spy.mockRestore()
  }
})
```

The spy runs the real implementation — `set_logs` is physically deleted inside the
transaction — then throws before `sessions` is deleted. SQLite rolls back the whole
transaction, so `set_logs` length 1 falsifies if the rollback is absent or broken.

> **Why the spy actually intercepts the in-module call — and when it wouldn't.**
> This works because `swole` runs on `ts-jest` (CommonJS): `sessions.ts`'s
> `import { deleteSessionSetLogs }` compiles to a namespace read at the call site,
> so `jest.spyOn(setLogsModule, 'deleteSessionSetLogs')` replaces the function the
> production code actually calls. Under native-ESM Jest (`jest.unstable_mockModule` /
> VM modules) or a Babel transform that binds named imports to local constants, the
> spy patches the module export while the caller keeps calling the original — the spy
> never fires, the injected fault never throws, and the test passes *vacuously again*.
> If your spy won't intercept, that's the cause: reach for `jest.unstable_mockModule`,
> or have the caller invoke the seam through the namespace (`setLogsModule.fn(...)`).

## Related

- [`begin-immediate-for-read-then-write-mutations-2026-05-27.md`](./begin-immediate-for-read-then-write-mutations-2026-05-27.md)
  — the convention that makes these mutations transactional in the first place. Its
  "Pair with atomicity tests" prescription is exactly what this doc operationalizes.
- Sibling fault-injection technique: the `CHECK`-constraint approach in
  [`apps/swole/src/db/__tests__/progressions.spec.ts:249`](../../../apps/swole/src/db/__tests__/progressions.spec.ts).
- Seam precedent: `deleteRoutineChildren` ([`apps/swole/src/db/exercises.ts:71`](../../../apps/swole/src/db/exercises.ts)).
