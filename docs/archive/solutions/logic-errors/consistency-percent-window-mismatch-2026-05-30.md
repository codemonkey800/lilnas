---
title: Consistency % pinned at 100% — numerator and denominator used different time windows
date: 2026-05-30
category: logic-errors
module: swole/stats
problem_type: logic_error
component: frontend_stimulus
symptoms:
  - Overall consistency tile reads 100% for every routine older than four weeks
  - Consistency never drops below 100% regardless of missed sessions
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags:
  - metric
  - ratio
  - time-window
  - consistency
  - rate-calculation
  - clamping
---

# Consistency % pinned at 100% — numerator and denominator used different time windows

## Problem

The "Overall consistency" tile computes `completed ÷ expected`. The denominator, `expectedSessions(routines, now)`, counts scheduled sessions over a trailing **4-week** window. The numerator was passed as `totalSessions` — an **all-time** completed-session count. For any routine with more than four weeks of history the all-time count exceeded the 4-week expectation, the ratio went above 1.0, and `consistencyPct` clamped it to 100%. Consistency therefore looked perfect for every established routine.

## Symptoms

- The consistency tile shows `100%` for any routine older than four weeks, regardless of recent attendance.
- Skipping scheduled sessions never moves the number — it stays pinned at 100%.

## What Didn't Work

- Nothing was tried-and-reverted. The mismatch was introduced when `StatsHeader` was first implemented, went unnoticed through that session, and was caught in review by reading the two sides of the ratio together — not by a failing test. *(session history)*

## Solution

Window the numerator to the same trailing 28 days the denominator uses, in `apps/swole/src/components/stats/StatsHeader.tsx`:

```tsx
const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

// Window numerator to the same 4 weeks that expectedSessions uses as denominator.
const windowStartMs = now.getTime() - FOUR_WEEKS_MS
const sessionsInWindow = sessions.filter(
  s => s.completedAt !== null && s.completedAt.getTime() >= windowStartMs,
).length

const consistency =
  isColdStart || isArchivedScope
    ? null
    : consistencyPct(sessionsInWindow, expectedSessions(routines, now))
//    ^ was consistencyPct(totalSessions, …)
```

`expectedSessions` was already correct — it computes `days/week × min(4, weeksSince)`. Only the numerator needed to match its window.

## Why This Works

A ratio is only meaningful when both sides cover the same population. The denominator answers "how many sessions were scheduled in the last 4 weeks"; the numerator must answer "how many did I complete in the last 4 weeks." Feeding it an all-time count compared two different questions. The `Math.min(100, …)` clamp inside `consistencyPct` then hid the overflow by capping a 300%-style result at a plausible-looking 100% instead of surfacing the absurdity.

## Prevention

- **Derive numerator and denominator of a rate from one shared window/cutoff variable.** Here `windowStartMs` should govern both sides; if a future change moves the denominator's window, the numerator follows automatically.
- **A clamp can legitimately cap a value, but it must not silently absorb a bug.** `min(100, …)` has a real job here — in the first weeks `expectedSessions` age-clamps to `min(4, weeksSince)`, so a young routine can transiently complete more than expected. Keep the clamp, but assert or log in development when the raw ratio exceeds the bound by a wide margin, so a window mismatch surfaces instead of masquerading as a tidy 100%.
- **Matrix-test derived metrics across their inputs, not just the happy path** — the same lesson the session FSM core documents (cover the inputs to *every* public function, not just the dominant one). A test with a routine older than four weeks and a known recent attendance would have pinned the expected percentage. See `architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`.

## Related Issues

- Same code-review batch (commit `88e40cd`): `ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md` and `integration-issues/recharts-categorical-axis-same-day-collapse-2026-05-30.md`.
