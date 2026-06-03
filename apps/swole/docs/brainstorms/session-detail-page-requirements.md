# Session Detail Page — Requirements

- **Status:** Ready for planning
- **Date:** 2026-06-02
- **App:** `apps/swole`
- **Scope:** Standard

## Problem

A completed session has no viewable page today:

- The home **"Recent sessions"** strip links each session to `/routines/{id}` —
  which for a live routine is the **edit form**, not the workout
  (`src/components/home/RecentSessionsStrip.tsx`).
- `/session/[id]` shows a neutral *"session not active"* message once the
  session is completed (`src/app/session/[id]/page.tsx:24` — "null covers both
  unknown and completed sessions").
- The per-exercise history journal on `/stats/[exerciseId]` answers *"how has
  this exercise progressed?"* — not *"how did this whole workout go?"*
- `/session/[id]/complete` is a one-time celebration that auto-redirects home;
  it is not revisitable.

There is no way to look back at a single workout in full.

## Goal

A read-only, **immutable** retrospective of one completed session — the
permanent record you land on after finishing and return to from history. The
only mutation is deleting an accidental session (guarded).

## Decisions (locked)

| Area | Decision |
|------|----------|
| **Routing** | Reuse `/session/[id]`. It branches: *active* → runner (unchanged), *completed* → this detail page. The `/complete` flow runs its progression prompts, then lands here instead of redirecting home. |
| **Mutability** | **Immutable.** No per-set or session edits. This matches the existing data-layer contract — completed sessions already reject `appendSetLog` (`SessionAlreadyCompleted`) and `undoLastSetLog` (`UndoBlockedBySessionCompleted`). No new mutation surface on logs. |
| **Delete** | One escape hatch: delete an entire session, **blocked if the session earned a `session_progression`** (mirrors the "undo blocked by committed progression" rule). In practice only no-progress / accidental sessions are deletable. |
| **Header** | Routine name + date (absolute + relative) + duration (`startedAt`→`completedAt`) + total volume (Σ `weight × actualReps` over weighted sets). |
| **Body** | Grouped by exercise in routine order; set rows rendered via the existing `formatSetRow` (hit/shortfall coloring reused). |
| **Entry points** | Home recent-strip (fix the mislink) + stats history-journal date headers. Heatmap cells and a per-routine history list are deferred. |

## Page contents

**Header**

- Routine name
- `formatJournalSessionDate(completedAt)` + a relative label (e.g. "2 days ago")
- Session duration (`completedAt − startedAt`)
- Totals: # exercises, # sets, total volume (weighted)

**Body** — one block per exercise, in routine order:

- Exercise name + configured scheme (`formatExerciseConfig`)
- Set rows via `formatSetRow` (handles weighted / bodyweight / time-based /
  cardio, including the shortfall fraction color)
- Archived exercises still render (data layer supports `includeArchived`)

**Footer / overflow**

- Delete action (guarded) with confirmation. On success → revalidate and return
  to home.

## States

- **No sets logged** (finished early): "No sets logged this session."
- **Degraded hydration** (`failedSetLogIds` non-empty): small warning, rest of
  the session still renders — mirror the runner's behavior.
- **Archived routine / exercise:** still renders, read-only.
- **Active session id:** unchanged — the runner.
- **Unknown / non-integer id:** existing neutral not-active / not-found path.

## Data-layer needs

- **Generalize hydration.** `buildSessionState` currently filters to active
  sessions via `getActiveSession`. Add a completed-capable read composed from
  `getSession` + `getSetLogsForSession` + `getProgressionsForSession` +
  `getRoutineWithExercises({ includeArchived: true })`. `getSetLogsForSession`
  is already completion-agnostic.
- **New `deleteSession`** server action + data function: transactionally delete
  child `set_logs`, then the session row; **refuse** when a
  `session_progression` row references the session (FK `restrict` on
  `progressions` backstops). Returns the existing discriminated-union error
  envelope.
- **`/complete` flow:** change the terminal `router.push('/')` →
  `router.push('/session/{id}')`.
- **Recent-strip:** link `/session/{session.id}` instead of
  `/routines/{routine.id}`.
- **Stats journal date headers:** link to `/session/{id}`.

## Out of scope

- Per-set / session editing (immutable by decision).
- Progression / starting-weight recomputation from edits.
- Share, export, or "repeat this workout."
- Heatmap-cell and per-routine-history entry points (revisit later if wanted).
- Per-session PR detection in the header.

## Open questions (minor — safe to settle in planning)

- **First arrival after finishing:** keep a lightweight "Session complete"
  accent (reuse the trophy from `CompleteRunner`) as a one-time header flourish,
  or land plainly? *Lean: subtle one-time accent, no blocking animation.*
- **Volume for non-weighted types:** show weighted volume only, or add a
  per-type total line? *Lean: weighted volume only; the set/exercise counts
  cover the rest.*

## Success criteria

- Tapping a recent session opens its full retrospective — no more routine-editor
  dead-end.
- Every set from a completed session is visible, correctly formatted per
  exercise type, with hit/miss coloring.
- Finishing a workout lands on this same revisitable page.
- Deleting an accidental (no-progression) session works; deleting a session that
  earned a progression is blocked with a clear message.
- No new mutation surface on completed-session logs; existing immutability
  invariants stay intact.
