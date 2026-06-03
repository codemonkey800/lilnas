---
title: Replace `!` and `as` on nullable DB rows with type guards and query-guaranteed types
date: 2026-05-30
category: conventions
module: swole
problem_type: convention
component: database
severity: medium
related_components:
  - frontend_stimulus
applies_when:
  - A multi-kind table has columns that are non-null only for certain type/kind values
  - "Component or helper code reaches for `!` assertions or `as` casts to satisfy the type checker on nullable columns"
  - A query filter such as isNotNull guarantees a column is non-null for the rows it returns
  - A shared helper threads a row type through and the narrowed type should survive to the other side
tags:
  - typescript
  - type-guard
  - discriminated-union
  - non-null-assertion
  - type-narrowing
  - nullable-columns
  - drizzle
  - as-cast
---

# Replace `!` and `as` on nullable DB rows with type guards and query-guaranteed types

## Context

`ExerciseRow` models several exercise kinds in one table, so columns like `startingWeight`, `increment`, and `durationSeconds` are nullable — only populated for the matching `type`. `SummaryHeader` rendered per-type tiles and reached for `exercise as ExerciseRow & { type: 'weighted' }` casts and `exercise.startingWeight!` non-null assertions to get past the type checker. Casts and `!` tell the compiler "trust me" — they don't verify anything, so a column that is null at runtime (or a `type` that doesn't match the cast) yields `undefined`/`NaN` with no compile-time warning. The same shape showed up at the data layer, where callers wrote `session.completedAt as Date` even though the query already filtered `isNotNull(sessions.completedAt)`.

## Guidance

Encode what you actually know in the **type**, then let the compiler narrow.

**1. Discriminated-union subtypes + type-guard functions.** Define a subtype that makes the conditionally-present columns non-null, and a guard that checks both the discriminant and the columns:

```tsx
type WeightedExerciseRow = Omit<ExerciseRow, 'startingWeight' | 'increment'> & {
  type: 'weighted'
  startingWeight: number
  increment: number
}

function isWeighted(e: ExerciseRow): e is WeightedExerciseRow {
  return e.type === 'weighted' && e.startingWeight !== null && e.increment !== null
}
```

At the call site the guard narrows with no cast, and the child sees `number`, not `number | null`:

```tsx
{isWeighted(exercise) && <WeightedTiles exercise={exercise} logs={logs} />}
// inside WeightedTiles: exercise.startingWeight is `number` — no `!`
```

**2. Bake query guarantees into a row type** instead of asserting at each call site. The query filters `isNotNull(sessions.completedAt)`, so name that:

```ts
// isNotNull(sessions.completedAt) in the query guarantees non-null completedAt.
export type CompletedSessionLogEntry = {
  setLog: SetLogRow
  session: SessionRow & { completedAt: Date }
}
```

Now `HistoryJournal`, `ConsistencyView`, and their callers consume `completedAt: Date` directly — every `as Date` cast deleted.

**3. Make helpers generic so the narrowed type survives.** `groupSetLogsBySession` operated on `SessionRow`, widening the type back and dropping the narrowed `completedAt: Date` for its callers. Parameterize it:

```ts
export function groupSetLogsBySession<S extends SessionRow>(
  rows: Array<{ setLog: SetLogRow; session: S }>,
): SessionGroup<S>[] { /* … */ }
```

**Reach for a guard only when the discriminant implies non-null _columns_.** In this same component the `bodyweight` branch keeps a plain `exercise as ExerciseRow & { type: 'bodyweight' }` cast — there is no `isBodyweight` guard — because its tiles read only always-present columns (`sets`, `targetReps`) and a guard would assert nothing. A discriminant-only narrowing with no nullable fields to verify doesn't need one.

## Why This Matters

`!` and `as` are unchecked assertions: they silence the type checker without adding a runtime guarantee, so the one case where the column really is null fails silently downstream (a `NaN` weight, an `Invalid Date`). Type guards move the check to a single, named, runtime-true location and give every downstream line a genuinely-narrowed type for free. A row type that encodes a query's `isNotNull` guarantee makes the guarantee discoverable and removes the temptation to re-assert it in each consumer.

Skipping the generic helper bites later, not sooner: making `groupSetLogsBySession` generic was only forced on the final type-check pass — two of three type errors came from the helper widening the session type back to `SessionRow`. *(session history)*

## When to Apply

- A multi-kind table has columns that are non-null only for certain `type`/`kind` values.
- You're about to write `as Something` or `value!` to satisfy the compiler on a DB row.
- A query filter guarantees a column is present for the rows it returns — encode it in the return type rather than asserting per call site.
- A shared helper passes rows through and callers need the narrowed type preserved.

## Examples

Before (unsafe — casts and assertions):

```tsx
{exercise.type === 'weighted' && (
  <WeightedTiles
    exercise={exercise as ExerciseRow & { type: 'weighted' }}
    logs={logs}
  />
)}
// …
value={formatWeight(exercise.startingWeight!)}
```

After (guard narrows, no cast):

```tsx
{isWeighted(exercise) && <WeightedTiles exercise={exercise} logs={logs} />}
// …
value={formatWeight(exercise.startingWeight)} // already `number`
```

## Related

- `conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md` — the other `swole` data-layer convention. Its `DataLayerError` hierarchy uses the same discriminated-union-with-`kind` technique this generalizes, and `apps/swole/src/db/setLogs.ts` carries both conventions.
- `architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md` — the FSM's discriminated `Action` union and `'field' in action` narrowing apply the identical TypeScript technique to domain actions.
