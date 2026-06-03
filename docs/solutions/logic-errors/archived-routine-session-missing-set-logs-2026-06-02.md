---
title: Archived routine sessions must log all exercises, not just spec.logs entries
date: 2026-06-02
category: logic-errors
module: swole
problem_type: logic_error
component: development_workflow
severity: medium
symptoms:
  - "Exercises absent from spec.logs show zero set_logs rows across all archived routine sessions"
  - Stats page shows omitted exercises as never performed despite routine membership
  - "Seeded set counts and target_reps are swapped when positional tuple indices (ex[3]/ex[4]) are used"
root_cause: logic_error
resolution_type: seed_data_update
related_components:
  - apps/swole/scripts/seed-home.mjs
tags:
  - swole
  - seed-data
  - archived-routines
  - set-logs
  - parameter-swap
  - stats-page
  - iteration-order
---

# Archived routine sessions must log all exercises, not just spec.logs entries

## Problem

`archivedWeightRoutine` in `apps/swole/scripts/seed-home.mjs` only created `set_logs` rows for exercises listed in each session's `spec.logs` array. Exercises omitted from `spec.logs` received zero `set_logs` rows, making them appear to have never been performed on the stats page. The same helper also contained a parameter-swap bug: array index positions `ex[3]` (reps) and `ex[4]` (startingWeight) were passed in the wrong order to `logWeighted`, silently producing malformed set counts and rep targets across all seeded archived sessions.

## Symptoms

- On the stats page (`/stats/<exerciseId>`), exercises that were part of archived routines but absent from every `spec.logs` entry displayed "Sessions performed: 0" and the empty-state placeholder despite having completed sessions at the routine level.
- A concrete example: Box Jump in the Functional Fitness archived routine showed as never performed — zero `set_logs` rows — despite six seeded sessions for that routine. (session history)
- Every seeded weighted set had `target_reps` populated with the starting weight value and its loop iteration count driven by the reps value, producing wrong set/rep data across all archived weighted routines.

## What Didn't Work

No failed approaches were recorded in git history. The bug was caught by inspecting seeded data directly (noticing Box Jump had zero `set_logs` rows) rather than through a user-visible failure report. The `spec.logs`-driven loop was written with deliberate intent — `spec.logs` is a per-session progression schedule, so it appeared correct to only log entries for exercises scheduled to progress that session. The flaw was that exercises absent from `spec.logs` were meant to receive a "Stay at starting weight" log entry, not to be omitted entirely. (session history)

## Solution

**Before** (buggy inner loop):

```js
spec.logs.forEach(([exIdx, weight, action], i) => {
  const ex = exercises[exIdx]
  // Bug 1: iterates only spec.logs entries — exercises absent from spec.logs get no rows
  // Bug 2: ex[3] = reps, passed as sets — drives the wrong insert-loop count; ex[4] = startingWeight, passed as target_reps — wrong column value
  logWeighted(sid, exIds[exIdx], ex[3], ex[4], weight, action, startedAt + i * 15 * minMs)
  if (action === 'Increment') bump(exIds[exIdx], sid, weight + ex[5], completedAt)
})
```

**After** (fixed version):

```js
const specByExIdx = new Map(spec.logs.map(([exIdx, weight, action]) => [exIdx, { weight, action }]))

exerciseDefs.forEach(([, , sets, reps, startW, inc], exIdx) => {
  const log = specByExIdx.get(exIdx) ?? { weight: startW, action: 'Stay' }
  logWeighted(sid, exIds[exIdx], sets, reps, log.weight, log.action, startedAt + exIdx * 15 * minMs)
  if (log.action === 'Increment') bump(exIds[exIdx], sid, log.weight + inc, completedAt)
})
```

The iteration driver changed from `spec.logs` (partial) to `exerciseDefs` (complete), with `spec.logs` demoted to a lookup map for progression overrides. Missing entries fall back to `{ weight: startW, action: 'Stay' }`. Named destructuring at the `forEach` call site replaces positional index access.

## Why This Works

The root cause was a **loop-owner mismatch**: `spec.logs` is a sparse progression spec (only exercises whose weight or action advances that session), but the loop that wrote `set_logs` rows used that sparse array as its iteration source. The number of exercises logged per session equalled the number of entries in `spec.logs`, not the number of exercises in the routine.

The parameter swap was a positional indexing error. The `exerciseDefs` tuple is `[name, order, sets, reps, startW, inc]`, so `ex[3]` = reps and `ex[4]` = startingWeight. `logWeighted`'s signature is `(sessionId, exerciseId, sets, reps, weight, action, baseTs)`, so passing `ex[3]` as `sets` and `ex[4]` as `reps` transposed them. Destructuring by name at the call site makes the mapping to function parameters visually verifiable and eliminates positional errors entirely.

## Prevention

- **Drive session loops from the complete exercise list, not the progression spec.** Any helper that seeds or constructs session records should iterate `exerciseDefs` and use `spec.logs` only as an override lookup, never as the loop source.
- **Use named destructuring instead of positional index access.** Tuple elements accessed by numeric index (`ex[3]`, `ex[4]`) are fragile when the tuple has more than 2–3 fields. Destructuring at the call site (`[, , sets, reps, startW, inc]`) makes the mapping to function parameters visually verifiable and catches swaps at a glance.
- **Assert `set_logs` row counts in seed validation or integration tests.** A test verifying every exercise in every archived session has at least one `set_logs` row would catch both the coverage gap and wrong-column data immediately. No test harness currently exists for `seed-home.mjs` — the natural home is `apps/swole/scripts/__tests__/seed-home.test.mjs`; until then, validation is manual inspection of console output after running the seed.
- **Comment the sparse-spec contract at the definition site.** The `spec.logs` field should carry a comment clarifying it is a progression-only override list, not an exhaustive exercise manifest, so future callers do not assume that omitting an exercise from `spec.logs` is a no-op.

## Related Issues

- [`begin-immediate-for-read-then-write-mutations-2026-05-27.md`](../conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md) — adjacent context: discusses `set_log` orphan risk and archived-routine state checks in the same DB layer (TOCTOU/transaction concern, orthogonal to iteration correctness)
