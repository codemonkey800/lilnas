---
title: Wrap read-then-write mutations in BEGIN IMMEDIATE for better-sqlite3 + Drizzle
date: 2026-05-27
category: conventions
module: swole/db
problem_type: convention
component: database
severity: high
applies_when:
  - "Using better-sqlite3 with Drizzle ORM in a Next.js server-action codebase"
  - "A mutation reads a row (existence check, archived check, prior value) and then UPDATEs or INSERTs based on what it read"
  - "Multiple writers can target the same row concurrently (UI double-tap retries, multi-tab edits, useOptimistic rollback fires)"
  - "A future swap to libSQL/Turso or another genuinely-async driver is plausible"
  - "A bad write is durable — there is no rollback once the wrong value lands on disk"
related_components:
  - service_object
  - testing_framework
tags:
  - sqlite
  - drizzle
  - better-sqlite3
  - transactions
  - concurrency
  - swole
---

# Wrap read-then-write mutations in BEGIN IMMEDIATE for better-sqlite3 + Drizzle

## Context

`swole` is a single-user Next.js-everywhere workout tracker. Per [`apps/swole/docs/adr/001-data-flow.md`](../../../apps/swole/docs/adr/001-data-flow.md), server actions are the transactional boundary — every UI mutation crosses into the data layer through one of the `apps/swole/src/db/*.ts` functions, and those functions own atomicity. The DB driver is `better-sqlite3`; `client.ts` wraps it in `drizzle-orm/better-sqlite3`.

The risk this convention addresses is a classic TOCTOU race in read-then-write mutations. The default transaction mode in `drizzle-orm/better-sqlite3` is `BEGIN DEFERRED`, which holds only a shared read lock until the first write statement. Two transactions can both `SELECT existing`, both pass an existence/archived/completed check, and both then `UPDATE` — with the second silently overwriting the first. There is no error, no rollback; just a lost write.

The triggers in `swole` are real, not theoretical. The UI is built on React 19 `useOptimistic`, so a double-tap, a navigation that re-submits, or a retry will fire two server actions in flight at once. A second tab on the same routine produces the same shape. And because the FSM's persistence step writes to disk with no in-memory rollback (see [the FSM↔DB integration test](../../../apps/swole/src/db/__tests__/__integration__/prd-walkthrough.spec.ts)), a wrong write is durable: the user sees the optimistic UI succeed while the DB lands in a state the FSM can't recover from.

The convention was proposed during the original `/ce-plan` deepening pass before any code landed (session history). A `ce-data-integrity-guardian` reviewer walked the race concretely: T1 begins `undoLastSetLog(sessionId)` and reads `progressions WHERE reason = 'session_progression'` → count = 0; T2 begins `commitProgressionDecision` in another request, inserts a `session_progression` row, commits; T1 deletes the most recent `set_log` and commits. Result: an orphaned `session_progression` row pointing at a now-deleted set log — violating the FSM↔DB invariant. better-sqlite3's WAL snapshot isolation makes T1's *read* repeatable, but doesn't prevent T1's *write* from racing T2. The fix that became the convention: every read-then-write mutation runs under `{ behavior: 'immediate' }`.

## Guidance

**The rule.** Every mutation function in `apps/swole/src/db/*.ts` that reads a row and then writes based on what it read must wrap its body in:

```ts
db.transaction(callback, { behavior: 'immediate' })
```

Bare `db.transaction(callback)` is forbidden for read-then-write paths.

**The footgun.** Inside the callback, every DB access must go through `tx` — never the outer `db`. Drizzle does not stop you from calling `db.*` inside a transaction callback, but those calls commit unconditionally and bypass the rollback. The comment at [`exercises.ts:172-174`](../../../apps/swole/src/db/exercises.ts) flags this explicitly: *"All DB calls inside the callback MUST use `tx`, never the outer `db`. A stray `db.*` inside this callback would commit unconditionally even if the tx rolls back — silent footgun."*

**Wrong vs right.** Using `completeSession` as a worked example:

```ts
// WRONG — BEGIN DEFERRED (the drizzle/better-sqlite3 default)
return db.transaction(tx => {
  const existing = tx
    .select()
    .from(sessions)
    .where(eq(sessions.id, args.sessionId))
    .get()                                         // shared read lock
  if (!existing) throw new NotFoundError('Session', args.sessionId)
  if (existing.completedAt) return existing
  return tx
    .update(sessions)
    .set({ completedAt: new Date() })
    .where(eq(sessions.id, args.sessionId))
    .returning()
    .get()                                         // write lock acquired HERE
})
// Two concurrent invocations both read `existing.completedAt === null`,
// both reach the UPDATE, both succeed; the second `completedAt` overwrites
// the first. No error is thrown — the lost write is invisible.

// RIGHT — BEGIN IMMEDIATE
return db.transaction(
  tx => {
    const existing = tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, args.sessionId))
      .get()
    if (!existing) throw new NotFoundError('Session', args.sessionId)
    if (existing.completedAt) return existing      // idempotent re-read
    return tx
      .update(sessions)
      .set({ completedAt: new Date() })
      .where(eq(sessions.id, args.sessionId))
      .returning()
      .get()
  },
  { behavior: 'immediate' },                        // write lock at BEGIN
)
```

Under `IMMEDIATE`, the second caller blocks at `BEGIN` until the first commits, then re-reads `existing` and sees `completedAt` already non-null, and returns the existing row. The idempotent re-read is what makes the racer safe; the lock is what makes the re-read see the committed state.

**Supporting prescriptions.**

- **Idempotent mutations should re-read inside the tx and short-circuit.** `completeSession` ([`sessions.ts:148`](../../../apps/swole/src/db/sessions.ts)) returns the existing row when `existing.completedAt` is set rather than re-stamping it. This pairs with the lock: serialized callers will see the committed completed state and skip the UPDATE.

- **Shared count/check helpers must take an `Executor`.** Helpers that read shared state from both transactional and non-transactional callers should accept an `Executor` (the `tx` or outer `db`) so they can be invoked either way. See the `Executor` type and `activeSessionCountForRoutine` at [`exercises.ts:21-35`](../../../apps/swole/src/db/exercises.ts), called with `tx` from `archiveExercise` and `reorderExercises`.

- **Pair with a partial unique index where the constraint is structural** (session history). The original review proposed `BEGIN IMMEDIATE` *and* the partial unique index `one_active_session_per_routine` as paired defenses — the index catches the structural invariant at the DB level (raising `SQLITE_CONSTRAINT_UNIQUE`, which `sessions.ts` translates to `RoutineAlreadyHasActiveSession`); `IMMEDIATE` protects the non-constraint-backed checks like archived-routine state. Use both when both apply.

- **Pair with atomicity tests.** The pattern is committed alongside tests that simulate concurrent writers (commit `4a76e7e feat(swole): add transactional mutations with BEGIN IMMEDIATE and atomicity tests`). Tests live in `apps/swole/src/db/__tests__/` and lock the contract in.

## Why This Matters

**Correctness against double-tap / retry.** React 19's `useOptimistic` updates the UI synchronously while the server action is in flight. A user double-click, a stuck-button retry, or a React re-render that resubmits will fire two server actions for the same row. Under `DEFERRED`, both can pass an existence/state guard and both can run the UPDATE — the optimistic UI says "done," the DB agrees with whichever write won, and any audit invariant (timestamps, progression rows) is now inconsistent. Under `IMMEDIATE`, the second caller waits, re-reads, and either returns the existing row (idempotent) or sees the new state and errors out (`SessionAlreadyCompleted`, `RoutineArchived`, etc., per [`errors.ts`](../../../apps/swole/src/db/errors.ts)).

**Forward driver portability.** The same convention pairs with the deliberately-`async` signatures ([`routines.ts:144-146`](../../../apps/swole/src/db/routines.ts)): mutations return `Promise<T>` even though `better-sqlite3` is sync, so a libSQL/Turso swap is a non-breaking change for consumers. `IMMEDIATE` survives that swap cleanly because libSQL inherits SQLite's locking model — the call site doesn't change.

**The cost.** `IMMEDIATE` serializes writers on the database file. Read-only transactions still proceed concurrently, but two concurrent mutations always queue. For `swole` — single user, one active session at a time — that's invisible. For a high-write multi-tenant app the answer would be finer-grained locking, optimistic concurrency with version columns, or a different driver — not bare `DEFERRED`.

## When to Apply

Apply `BEGIN IMMEDIATE` when:

- The mutation reads a row (existence check, archived check, completedAt check, prior value comparison) and then writes based on what it found.
- The mutation performs **paired writes** that must roll back together — e.g., `createExercise` inserts an `exercises` row and (for weighted exercises) an initial `progressions` row; both succeed or neither does.
- Multiple concurrent writers can plausibly hit the same row — tabs, retries, `useOptimistic` re-fires, background jobs, FSM persistence.
- The driver is `better-sqlite3` (or any SQLite-on-disk variant exposing the `behavior` selector).
- A bad write is durable — there is no rollback once the wrong value lands on disk.

Do NOT apply when:

- The mutation is a pure insert or delete with no preceding read and no paired write. (Drizzle still hands you a tx, but `DEFERRED` is fine.)
- Concurrency is impossible — a single-threaded fixture loader, a one-shot migration script, a CLI tool that owns the DB. `DEFERRED` is slightly cheaper.

## Examples

### 1. `completeSession` against UI double-clicks

[`sessions.ts:136-163`](../../../apps/swole/src/db/sessions.ts). Idempotent shape: re-read inside `IMMEDIATE`, return the existing row when `completedAt` is already set, else `UPDATE`. Two concurrent double-click invocations serialize on the write lock; the second sees a non-null `completedAt` and returns the existing row instead of restamping the timestamp. Without `IMMEDIATE`, both would race past the `existing.completedAt` check and both stamp — corrupting the audit timestamp.

### 2. `updateExercise` against concurrent `commitProgressionDecision`

[`exercises.ts:214-274`](../../../apps/swole/src/db/exercises.ts). The function reads `existing` inside the tx so the "did `starting_weight` change?" comparison can't race with a concurrent `commitProgressionDecision` in another tab — which also writes `exercises.starting_weight`. Without `IMMEDIATE`, both transactions could read the old `startingWeight`, both could decide the value changed, and both could insert a progression row (`manual_edit` and `session_progression`) referencing values that no longer hold — breaking R19's invariant that the latest progression row's `startingWeight` equals `exercises.starting_weight`.

### 3. `archiveRoutine` against `startSession` racing the archive

[`routines.ts:205-255`](../../../apps/swole/src/db/routines.ts). Counts active sessions inside the tx and throws `ArchiveBlockedByActiveSession` if any exist. Without `IMMEDIATE`, a concurrent `startSession` ([`sessions.ts:94-134`](../../../apps/swole/src/db/sessions.ts)) could insert an active session after the count and before the archive `UPDATE`, leaving the routine marked archived but with a live session pointing at it. That state corrupts both the active-session invariant `startSession` itself relies on and the audit trail. `IMMEDIATE` on both sides forces them to serialize on the write lock: whichever commits first wins, and the second one's guard check sees the committed state and fails cleanly.

### 4. `createExercise` for paired-write atomicity (not just read-then-write)

[`exercises.ts:166-212`](../../../apps/swole/src/db/exercises.ts). Inserts the `exercises` row and (for weighted exercises) an initial `progressions` row in one tx — both succeed or both roll back. Uses `IMMEDIATE` even though there's no preceding read, because the paired-write atomicity matters and the file-level footgun warning ("stray `db.*` inside the callback commits unconditionally") applies to any tx, read-then-write or not. The `IMMEDIATE` here is belt-and-suspenders against a second writer extending the pair.

## Related

- [`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`](../architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md) — the layer above this one. The FSM stays persistence-agnostic; this convention explains why that separation is safe. The FSM doc notes "the only place in v1 where a logic slip writes wrong data to SQLite forever" — `IMMEDIATE` closes the racier failure mode on the same write path.
- [`apps/swole/docs/adr/001-data-flow.md`](../../../apps/swole/docs/adr/001-data-flow.md) — establishes Next.js server actions as the transactional boundary (no NestJS REST layer), which is *why* `useOptimistic` double-tap concurrency is the realistic hazard model.
- [`apps/swole/src/db/errors.ts`](../../../apps/swole/src/db/errors.ts) — the tagged error hierarchy (`kind` discriminator: `validation | not_found | conflict | forbidden_transition | hydration`) that callers exhaustive-switch on. Domain conflicts surfaced from inside `IMMEDIATE` transactions reach consumers as discriminated `DataLayerError` subclasses, not generic `SqliteError`.
- [`docs/solutions/conventions/type-guards-over-nonnull-assertions-on-db-rows-2026-05-30.md`](./type-guards-over-nonnull-assertions-on-db-rows-2026-05-30.md) — the sibling `swole` data-layer convention. Generalizes the same discriminated-union technique as the `DataLayerError` `kind` hierarchy above, applied to nullable DB columns; the `isNotNull`-guaranteed `CompletedSessionLogEntry` type lives in the same `setLogs.ts` that uses this `IMMEDIATE` convention.
- Commits: `4a76e7e feat(swole): add transactional mutations with BEGIN IMMEDIATE and atomicity tests`, `e39880c feat(swole): PRD F2/F3 walkthrough integration test pinning the FSM↔DB contract`.
