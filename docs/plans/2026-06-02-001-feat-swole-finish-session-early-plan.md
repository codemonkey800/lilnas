---
title: "feat: Swole — finish a session early"
type: feat
status: active
date: 2026-06-02
origin: docs/brainstorms/2026-06-02-swole-finish-early-requirements.md
---

# feat: Swole — finish a session early

## Overview

Add a way to end an in-progress workout before every prescribed set is logged. Today the active-session runner only reaches the completion handoff when `nextTarget` returns `null` (every set logged), so the only exit mid-workout is the resumable pause (`←`), which leaves the session active and — via the `one_active_session_per_routine` partial unique index — blocks starting that routine fresh.

This feature adds two surfaces and nothing else:

1. An always-visible, low-emphasis **Finish** text control in the top bar (far-right, after the drawer trigger), disabled until ≥1 set is logged.
2. A **"Finish early?"** confirm bottom sheet showing a summary (exercises trained · sets logged) plus a one-line progression note, with **Keep going** / **Finish session** actions.

On confirm, it routes to the **existing** `/session/[id]/complete` handoff — the same destination as the terminal "Finish session →" button — which auto-commits progression for trained exercises and seals the session. No new completion or progression write path is introduced; the feature reuses `completeSession`, `classifyPostSession`, and `commitProgressionDecision` unchanged.

---

## Problem Frame

Progress is already durable: every set action persists immediately via `appendSetLog` (`apps/swole/src/components/session/SessionRunner.tsx`), so finishing early never needs to *save* anything — only to *seal*. And the complete flow already handles partial sessions: `classifyPostSession` (`apps/swole/src/core/session-machine.ts:378`) skips exercises with zero logs, and `CompleteRunner` auto-commits whatever prompts it emits. So an early finish reuses `/complete` with no new logic.

The user-visible gap: leaving mid-workout keeps the session active (`completedAt IS NULL`), which blocks starting that routine fresh. "Finish early" gives a two-tap exit that keeps logged sets, advances the weights earned, and unblocks the routine.

See origin: `docs/brainstorms/2026-06-02-swole-finish-early-requirements.md`.

---

## Requirements Trace

- R1. Always-visible **Finish** control in the top bar, far-right (after the drawer trigger), low-emphasis text button, present on the active runner (not behind a menu). → U3
- R2. Control unavailable until ≥1 logged set; at zero logs the only exit is the resumable pause (`←`). → U3
- R3. Control visually distinct from and spatially separated from the per-set action grid (bottom thumb-zone), so it cannot be mistaken for a set action. → U3 (top-bar placement)
- R4. Tapping **Finish** opens a confirm sheet titled "Finish early?" with primary "Finish session" and secondary "Keep going"; no session is sealed without this confirm. → U2, U3
- R5. Confirm shows a summary (count of exercises trained, total sets logged) plus a one-line note that progression applies only to trained exercises. → U1, U2
- R6. "Keep going" / dismiss closes the sheet with no write and returns to the same active set; session stays active. → U2, U3
- R7. "Finish session" routes to the existing `/session/[id]/complete` handoff (auto-commit + seal + home). No new completion or progression write path. → U3
- R8. Finishing early keeps every logged set; progression derived from logged sets via `classifyPostSession` (trained-only); remaining sets stay unlogged. → reused `/complete` (unchanged)
- R9. Top-bar **Finish** and terminal "Finish session →" coexist and converge on the same `/complete` destination; natural end of routine unchanged. → U3
- R10. After finishing early, the existing "Session Complete" celebration shows and lands home — identical to a normal finish. → reused `CompleteRunner` (unchanged)
- R11. Control label reads "Finish" in every state; only the confirm title frames it as "early". → U3

**Success criteria (from origin):** A lifter who must leave mid-workout closes out in two taps (Finish → confirm), keeps every logged set, advances weights for trained exercises, and can immediately start that routine fresh. `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` pass; the existing active-session and complete suites pass unchanged.

**Origin actors:** the single lifter (one human actor).
**Origin flows:** F1 — Finish a workout early; F2 — No progress yet (gate).
**Origin acceptance examples:** AE1 (covers R7, R8 — partial-session progression), AE2 (covers R2 — zero-set gate), AE3 (covers R4, R5, R6 — confirm summary + dismiss).

---

## Scope Boundaries

- **No discard / abandon path.** Finishing early always *keeps* logged sets and *applies* progression. A "close out without progression" path — and clearing an accidental 0-set session that blocks its routine — is a separate future brainstorm.
- **No change to the resumable pause (`←`):** it stays instant, no confirm, non-destructive.
- **No new completion semantics.** Same `completeSession` seal and same auto-committed progression as a normal finish. No "partial" flag or distinct session status; an early-finished session is just a completed session with fewer sets.
- **No per-exercise weight-delta UI in the confirm** — that is the post-session screen's job, and it auto-commits.
- **No editing or bulk-skipping of remaining sets** as part of finishing; unfinished sets stay unlogged.
- **No new FSM action, server action, DB write, or schema migration.** The feature is purely additive at the UI layer plus one pure view-model helper.
- **No rest timer, notes, new analytics/telemetry, or new theme tokens** — consistent with prior swole scope. Reuse `neutral-*` / `orange-*` Tailwind utilities.
- **No new `.tsx` test harness** (jsdom / React Testing Library). The codebase deliberately leaves components untested and tests pure logic in `core/`/`lib/`; this feature follows that split (see Key Technical Decisions).

---

## Context & Research

### Relevant Code and Patterns

- **`apps/swole/src/components/session/SessionRunner.tsx`** — the client runner. Holds `optimistic.setLogs` via `useOptimistic` (line 58). Existing precedents to mirror:
  - `failedSheetOpen` transient `useState(false)` (line 73) → model `finishSheetOpen` the same way.
  - `canUndo = optimistic.setLogs.length > 0 && !isPending` (line 223) → exact precedent for `canFinish = optimistic.setLogs.length > 0 && !isPending` (the `&& !isPending` term is load-bearing — see U3).
  - `onFinish` callback (lines 202-205): `() => router.push(`/session/${session.id}/complete`)`, currently passed to `TerminalCard` (line 276). **This is the navigation the early-finish confirm reuses** (R7/R9).
  - `FailedSheet` is rendered as a sibling (lines 293-300) with `open` + `onConfirm`/`onCancel`.
- **`apps/swole/src/components/session/TopBar.tsx`** — two-row top bar. Row 1: back `←` → routine name/progress (`min-w-0 flex-1`) → undo → drawer (`FitnessCenterIcon`, line 77-84). New control slots **after the drawer button, inside Row 1** (flex spacer pushes it far-right). Undo button's `cns()` conditional-color toggle (lines 67-72) is the disabled-state precedent.
- **`apps/swole/src/components/session/FailedSheet.tsx`** — the bottom-sheet primitive to mirror exactly: `Drawer anchor="bottom"`, `PaperProps={{ className: 'rounded-t-2xl !bg-neutral-900 border-t border-neutral-800' }}`, title `Typography component="h2" variant="h6" className="!font-bold"`, two-button row `flex gap-3` (outlined secondary + contained primary, both `fullWidth`). **Plain controlled `open`/`onClose` — no `history.pushState`.**
- **`apps/swole/src/components/session/TerminalCard.tsx`** — the existing terminal "Finish session →" button + the `{n} exercise(s) · {m} set(s)` singular/plural copy format to reuse.
- **`apps/swole/src/lib/runner.ts`** — pure view-model module ("so the .tsx tree stays dumb and testable", lines 1-2). `countLogsForExercise(setLogs, idx)` is exported (line 213). `deriveSessionSummary` (line 350) returns `exerciseCount: routine.exercises.length` — **the full routine length, which overcounts a partial session** — so a new helper is required for the confirm.
- **`apps/swole/src/app/session/[id]/complete/page.tsx` + `CompleteRunner.tsx`** — the reused handoff. Auto-commits progression, seals via `completeSession`, shows "Session Complete", returns home. Already correct on partial sessions. **Not modified.**
- **`apps/swole/src/db/sessions.ts` / `setLogs.ts` / `schema.ts`** — `completeSession` only stamps `completedAt` (idempotent, `BEGIN IMMEDIATE`); `appendSetLog` persists per-tap; `one_active_session_per_routine` partial unique index unblocks the routine on seal. **Not modified.**

### Institutional Learnings

- **`docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`** — `completeSession` / `commitProgressionDecision` are idempotent read-then-write mutations under `BEGIN IMMEDIATE`. *Application:* the feature adds no DB code, so this is satisfied by reuse; no new transaction surface.
- **`docs/solutions/ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md`** — a `Drawer` that pushes a browser-history marker (for Back-to-dismiss) broke the Back button. *Application:* mirror `FailedSheet`'s plain controlled `Drawer` (no `history.pushState`); **do not** add back-to-dismiss history handling. This avoids the entire bug class.
- **`docs/solutions/conventions/type-guards-over-nonnull-assertions-on-db-rows-2026-05-30.md`** — avoid `!` / `as` on nullable rows. *Application:* the new helper operates on already-typed `SessionState.setLogs`; keep it free of `!`/`as`.
- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — decision logic belongs in the pure FSM/view-model layer. *Application:* the trained-exercise count goes in `lib/runner.ts` (pure, tested), not the component. Note: this learning's suggestion to add an *early-finish FSM action* does **not** apply here — see Key Technical Decisions.
- **`docs/solutions/logic-errors/consistency-percent-window-mismatch-2026-05-30.md`** — stats count any session with `completedAt != null`. *Application:* an early-finished session counts in stats/consistency exactly like any completed session. This is intended (origin: "just a completed session with fewer sets"); see System-Wide Impact.

### External References

None — local patterns are directly applicable. External research was skipped.

---

## Key Technical Decisions

- **Reuse the existing navigate-to-`/complete` callback (renamed `goToComplete`); no new FSM action or write path.** Finishing early produces the exact same input to `/complete` as any partial session, and `/complete` already operates correctly on a partial `setLogs` prefix (`classifyPostSession` skips zero-log exercises; `completeSession` seals regardless). The pure-FSM learning's suggestion to encode an early-finish *rule* in the FSM is deliberately **not** followed: a partial session is already a valid FSM state, so adding an action would introduce a new write path the origin explicitly forbids. (Resolves the apparent tension between the learning and the origin's "no new write path" scope.)
- **New pure helper `deriveEarlyFinishSummary` rather than reusing `deriveSessionSummary`.** `deriveSessionSummary.exerciseCount` is `routine.exercises.length` (the whole routine) and would overcount a partial session — the single most likely correctness bug (e.g. AE3 would render "5 exercises" instead of "3"). The new helper counts only exercises with ≥1 log. Lives in `lib/runner.ts`, unit-tested.
- **Confirm primitive: `Drawer anchor="bottom"` mirroring `FailedSheet`** (origin's deferred R4 question). Aligns with the established sheet idiom *and*, because it uses no history marker, sidesteps the documented drawer Back-button bug.
- **Gate by disabling, not hiding** (origin's deferred R2 question). R1 says "always-visible" and R2 says "unavailable" → visible-but-disabled. Matches the existing undo button's disabled affordance (`disabled` + `cns()` color toggle), which reads less like a bug than a control that pops in after the first set.
- **Text `Button` labeled "Finish" in every state** (origin's deferred R1/R11 questions). R11 mandates a stable "Finish" label, so a bare icon won't do; a low-emphasis text `Button size="small"` styled like `ReviewCard`'s back-link fits the precedent. The routine-name block already truncates (`min-w-0 flex-1 !truncate`) to absorb the extra width.
- **Resolve the `onFinish` name collision with explicit, intention-revealing prop names so the top-bar control opens the sheet and never navigates.** The existing `onFinish` navigates to `/complete`; the new top-bar control must open the confirm. Rename the existing navigate callback to `goToComplete` (fed to both `TerminalCard` and the sheet's `onConfirm`), and name the new `TopBar` prop `onRequestFinish` (wired to `() => setFinishSheetOpen(true)`). Distinct names make the load-bearing rule — **only the sheet's confirm navigates** (R4) — enforced at the type level rather than by convention: a miswire of an irreversible seal can't hide behind a same-named prop.
- **Test strategy honors the codebase's dumb-tsx/tested-lib split.** All testable logic is the new derivation (U1), which is unit-tested. The sheet (U2) and the control wiring (U3) are presentational/wiring shells with no extractable logic beyond the trivial gate (mirroring the already-untested `canUndo`); per the documented convention and the origin's Success Criteria (which require lint/type-check/test to pass and existing suites unchanged, not new component tests), they are verified by type-check, lint, and manual check rather than new `.tsx` tests.

---

## Open Questions

### Resolved During Planning

- **Top-bar layout with a 6th element (R1/R3):** low-emphasis text `Button size="small"` ("Finish") after the drawer trigger; routine name truncates via existing styles. Final pixel check at narrow width deferred to implementation (below).
- **Confirm primitive (R4):** `Drawer anchor="bottom"` mirroring `FailedSheet`, no history marker.
- **Hidden vs disabled at zero sets (R2):** disabled, matching the undo affordance.
- **Confirm copy (R5):** title "Finish early?"; summary "{n} exercise(s) · {m} set(s) logged"; note "Weighted exercises you trained advance; the rest stay put."; buttons "Keep going" / "Finish session".
- **Close the sheet before navigating on confirm (R10):** the sheet's `onConfirm` closes the Drawer (`setFinishSheetOpen(false)`) then calls `goToComplete`, so it doesn't linger over the `/complete` mount (avoids a transition flash). Resolved from a prior deferral — the sheet overlays the runner, unlike the terminal button which has no sheet to close.

### Deferred to Implementation

- **Narrow-width visual check:** confirm the 6-element top bar reads cleanly at ~360px (routine name not over-truncated, "Finish" not clipped). Eyeball against a real mobile width; if too tight, the established fallback is an icon — but R11's stable "Finish" label makes the text button the default. Decision belongs at the device, not in the plan.

---

## Implementation Units

- U1. **Pure `deriveEarlyFinishSummary` helper + unit tests**

**Goal:** Add a pure view-model function that returns the count of exercises *trained* (≥1 logged set) and the total sets logged, for the confirm sheet's summary (R5). This is the feature's only extractable logic and the only new tested code.

**Requirements:** R5 (and AE3).

**Dependencies:** None.

**Files:**
- Modify: `apps/swole/src/lib/runner.ts` (add `deriveEarlyFinishSummary` + its return type, beside `deriveSessionSummary`)
- Test: `apps/swole/src/lib/__tests__/runner.spec.ts` (add a `describe` block beside the existing `deriveSessionSummary` tests)

**Approach:**
- Signature mirrors the other view-model derivers: `deriveEarlyFinishSummary(effectiveState: SessionState, routine: Routine): { trainedCount: number; totalSetsLogged: number }`.
- `trainedCount` = number of `routine.exercises` indices where `countLogsForExercise(effectiveState.setLogs, idx) > 0` (reuse the exported `countLogsForExercise`, `runner.ts:213`).
- `totalSetsLogged` = `effectiveState.setLogs.length`.
- Count **all** trained exercise types (weighted, bodyweight, time-based, cardio), not only weighted — AE3's summary says plain "exercises". (This intentionally differs from `classifyPostSession`, which emits progression only for *weighted* trained exercises; the summary is a broader "what you touched" count.)
- Do **not** reuse `deriveSessionSummary` — its `exerciseCount` is the full routine length and overcounts partials.
- No `!` / `as`; operate on the already-typed `SetLog[]`.

**Patterns to follow:**
- `deriveSessionSummary` / `deriveExerciseList` in `apps/swole/src/lib/runner.ts` (shape, naming, export style).
- Existing tests in `apps/swole/src/lib/__tests__/runner.spec.ts`: module-level fixtures (`bench`, `pushups`, `plank`, `run`, `routine`), the `stateWith(logs, exerciseIdx, routine)` builder, AE-named `describe`/`it` blocks, `toEqual` assertions.

**Test scenarios:**
- Happy path — partial mixed session: 3 exercises trained, 7 sets logged → `{ trainedCount: 3, totalSetsLogged: 7 }`. **Covers AE3.**
- Happy path — all exercises trained: every exercise has ≥1 log → `trainedCount === routine.exercises.length`, `totalSetsLogged` equals total logs.
- Edge case — single set: one log on one exercise → `{ trainedCount: 1, totalSetsLogged: 1 }` (verifies the singular-copy boundary the component renders).
- Edge case — zero logs: empty `setLogs` → `{ trainedCount: 0, totalSetsLogged: 0 }` (robustness; the gate prevents this path in the UI, but the pure function must not divide-by-zero or miscount).
- Edge case — non-contiguous trained exercises: logs on exercise indices 0 and 2 but not 1 → `trainedCount === 2` (a partially-skipped-middle session counts only logged exercises, not a contiguous prefix).
- Edge case — mixed types: a trained bodyweight or cardio exercise counts toward `trainedCount` (confirms type-agnostic counting, distinct from weighted-only progression).

**Verification:** New tests pass; existing `runner.spec.ts` tests unchanged and green; `type-check` clean.

---

- U2. **`FinishEarlySheet` confirm component**

**Goal:** A presentational bottom sheet that displays the early-finish summary and offers "Keep going" / "Finish session" (R4, R5, R6). No internal logic — props in, two callbacks out.

**Requirements:** R4, R5, R6.

**Dependencies:** None (receives counts as props; does not import U1 directly).

**Files:**
- Create: `apps/swole/src/components/session/FinishEarlySheet.tsx`

**Approach:**
- Props: `{ open: boolean; trainedCount: number; totalSetsLogged: number; onConfirm: () => void; onCancel: () => void }`. One piece of internal state — `const [navigating, setNavigating] = useState(false)` — guards against a double-tap: the "Finish session" handler sets `navigating` true then calls `onConfirm`, and the button renders `disabled={navigating}` so a second tap can't fire a duplicate navigation (mirrors `FailedSheet`'s `disabled={isPending}` confirm guard). No `isPending` prop is threaded — the guard is local because confirm is a one-way `router.push`. The `FailedSheet` reset-on-reopen effect is not needed (no editable numeric field).
- Structure mirrors `FailedSheet` exactly: `Drawer anchor="bottom"`, same `PaperProps` className, inner `<div className="flex flex-col gap-6 px-5 pb-8 pt-5">`.
- Title: `Typography component="h2" variant="h6" className="!font-bold"` → "Finish early?".
- Summary line: `{trainedCount} {trainedCount === 1 ? 'exercise' : 'exercises'} · {totalSetsLogged} {totalSetsLogged === 1 ? 'set' : 'sets'} logged` (reuse `TerminalCard`'s singular/plural format).
- Note line: `Typography variant="caption" color="text.secondary"` → "Weighted exercises you trained advance; the rest stay put." The note speaks only to weighted advancement because `classifyPostSession` advances weighted exercises only; `trainedCount` still counts all trained types (per AE3), so the count and the note describe different things deliberately — a bodyweight-only session would otherwise be promised weight changes that never happen.
- Button row `flex gap-3`: outlined secondary "Keep going" (`onClick={onCancel}`, styled `!border-neutral-700 !text-neutral-300 hover:!border-neutral-500`) + contained primary "Finish session" (`onClick`: `setNavigating(true)` then `onConfirm()`; `disabled={navigating}`, `!font-semibold`), both `fullWidth`.
- `onClose={onCancel}` (backdrop/Esc dismiss = "Keep going", R6). **No `history.pushState`** — avoids the documented drawer Back-button bug.
- Combine class strings with `cns()` only where ≥2 fragments/conditional apply; single static classNames stay plain strings (matching `FailedSheet`).

**Patterns to follow:**
- `apps/swole/src/components/session/FailedSheet.tsx` (primitive, paper styling, button row).
- `apps/swole/src/components/session/TerminalCard.tsx` (singular/plural count copy).

**Test scenarios:** Test expectation: none — presentational `.tsx` shell; the only logic is the trivial `navigating` double-tap guard, and the counts are derived upstream in U1. Per the codebase convention (`lib/runner.ts:1-2`; no jsdom/RTL installed) `.tsx` components are not unit-tested. Verified by `type-check`, `lint`, and manual check that the sheet renders the summary, the confirm button disables after the first tap, and both buttons fire their callbacks.

**Verification:** Sheet opens from a boolean prop, shows "Finish early?" + summary + note + two buttons; "Keep going" / backdrop fire `onCancel`; "Finish session" fires `onConfirm` once and then disables. `type-check` and `lint` clean.

---

- U3. **Wire the Finish control through `TopBar` and `SessionRunner`**

**Goal:** Add the always-visible, gated **Finish** control to the top bar and integrate the confirm sheet in the runner, converging on the existing `/complete` navigation (R1, R2, R3, R6, R7, R9, R11). Lands as one atomic change because the `TopBar` prop and the `SessionRunner` wiring are only meaningful together.

**Requirements:** R1, R2, R3, R6, R7, R9, R11 (and AE1, AE2 verification).

**Dependencies:** U1 (summary helper), U2 (sheet component).

**Files:**
- Modify: `apps/swole/src/components/session/TopBar.tsx` (add control + props)
- Modify: `apps/swole/src/components/session/SessionRunner.tsx` (state, derive summary, render sheet, resolve callback naming)

**Approach:**
- **`TopBar.tsx`:** extend `TopBarProps` with `canFinish: boolean` and `onRequestFinish: () => void` ("user tapped Finish" — opens the confirm sheet, does **not** navigate). Render a low-emphasis `Button size="small"` after the drawer `IconButton` (inside Row 1's `flex items-center gap-1`), label "Finish" in all states (R11), `disabled={!canFinish}`, `onClick={onRequestFinish}`. When disabled, set a `title` (e.g. "Log a set to finish early") so the inactive state is explained on hover and to assistive tech. Style via `cns()` combining a base low-emphasis class (`!text-neutral-400 hover:!text-white`, per `ReviewCard`'s back-link) with a conditional disabled-color class (`!text-neutral-700`), mirroring the undo button's `cns()` toggle. Top-bar placement satisfies R3 (away from the bottom-zone action grid).
- **`SessionRunner.tsx`:**
  - Add `const [finishSheetOpen, setFinishSheetOpen] = useState(false)` beside `failedSheetOpen` (line 73).
  - Resolve the `onFinish` collision: rename the existing navigate callback (lines 202-205) to `goToComplete`; pass it to `TerminalCard` (replacing the current `onFinish`) and to the new sheet's `onConfirm`. Wire `TopBar`'s new `onRequestFinish` to `() => setFinishSheetOpen(true)` and `canFinish` to `optimistic.setLogs.length > 0 && !isPending` — the `&& !isPending` term mirrors `canUndo` (line 223) exactly and disables the control while a set append/undo transition is in flight, so the user cannot navigate to `/complete` (which re-reads from the DB) before the last `appendSetLog` commits.
  - Import `deriveEarlyFinishSummary` from `src/lib/runner` (add to the existing import block, lines 27-35); compute `const finishSummary = deriveEarlyFinishSummary(effectiveState, routine)` in the component body.
  - Render `<FinishEarlySheet open={finishSheetOpen} trainedCount={finishSummary.trainedCount} totalSetsLogged={finishSummary.totalSetsLogged} onCancel={() => setFinishSheetOpen(false)} onConfirm={() => { setFinishSheetOpen(false); goToComplete() }} />` as a sibling beside `<FailedSheet>` (around lines 293-300) — closing the sheet before navigating so the Drawer doesn't linger over the `/complete` mount.
- Only the sheet's confirm navigates (R4); the top-bar tap merely opens the sheet (R6 dismiss = `setFinishSheetOpen(false)`, no write).

**Technical design:** *(directional — illustrates the two finish entry points converging; not implementation spec)*

```
 top-bar "Finish" (canFinish) ─tap─▶ onRequestFinish() ─▶ setFinishSheetOpen(true)
                                          │
 FinishEarlySheet ── "Keep going" ───────┤─▶ setFinishSheetOpen(false)   (no write, R6)
                  └─ "Finish session" ───┐
 TerminalCard "Finish session →" ────────┴─▶ goToComplete()  ─▶ router.push('/session/{id}/complete')
                                                                  (R7, R9 — single destination)
```

**Patterns to follow:**
- `failedSheetOpen` state + `<FailedSheet>` render wiring in `SessionRunner.tsx` (lines 73, 293-300).
- `canUndo` derivation (line 223); undo button `cns()` color toggle and `IconButton`/`Button` styling in `TopBar.tsx`.
- `onExit` / existing `onFinish` callback shape (lines 201-205).

**Test scenarios:** Test expectation: none for new `.tsx` tests — per the codebase's dumb-tsx convention, the runner and top bar are not unit-tested (the gate `setLogs.length > 0` mirrors the already-untested `canUndo`; the rest is prop wiring). The relevant acceptance examples are integration assertions over reused, already-tested code:
- **AE1 (R7, R8):** partial 5-exercise session (1–3 trained, 4–5 untouched) → trained exercises advance per logged sets (Failed holds starting weight), 4–5 unchanged, session sealed, lands home. Behavior of the reused `/complete` + `classifyPostSession` path — covered by the existing `session-machine.spec.ts` / complete suites, which must pass unchanged (origin Success Criteria). No new test; verify manually that finishing early reaches the same outcome.
- **AE2 (R2):** freshly started session, zero logs → **Finish** disabled; only exit is `←`; no completed session recorded. Enforced by `canFinish = optimistic.setLogs.length > 0`; verify by inspection + manual check.
- **AE3 (R4, R5, R6):** 3 trained / 7 logged → sheet reads "3 exercises · 7 sets logged" + the note; "Keep going" dismisses with no write, back on the same set. Count derivation covered by U1's test; copy + dismiss verified manually.

**Verification:** With ≥1 set logged, the top-bar **Finish** is enabled; tapping it opens "Finish early?" with the correct counts; "Keep going" returns to the same set with the session still active; "Finish session" lands on the "Session Complete" celebration then home, and the routine is immediately startable fresh. At zero sets the control is disabled. The terminal "Finish session →" still works unchanged. `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` pass; existing active-session and complete suites pass unchanged.

---

## System-Wide Impact

- **Interaction graph / convergence:** Two finish entry points (top-bar control, terminal card) now invoke one navigate callback → `/session/[id]/complete`. The terminal flow (reaching the natural end of a routine) is unchanged (R9). No other entry points affected.
- **State lifecycle:** No new DB writes. Sealing reuses `completeSession` (idempotent, `BEGIN IMMEDIATE`); progression reuses `commitProgressionDecision` via `CompleteRunner`. The append-only `setLogs` invariant is preserved — finishing early just navigates on an existing valid prefix.
- **Concurrency:** No new surface beyond what the terminal button already exercises. The `canFinish` gate carries `&& !isPending` (U3), so the control is disabled while a set append/undo transition is in flight — the user can't navigate to `/complete` (which re-reads from the DB) before the last `appendSetLog` commits; the sheet's confirm also disables after first tap (U2). Once the confirm navigates, the runner unmounts; the sheet sits over the runner, so undo isn't reachable while it's open. The `undoLastSetLog`↔`commitProgressionDecision` race noted in learnings is not newly exposed.
- **Stats / consistency (intended, not a bug):** An early-finished session seals `completedAt`, so it counts in the recent-sessions strip, history, and consistency tile exactly like any completed session (origin: "just a completed session with fewer sets"). The consistency numerator/denominator both treat it as completed, so no ratio skew. Flagged for awareness; no action.
- **Unchanged invariants:** `/complete` page, `CompleteRunner`, `completeSession`, `classifyPostSession`, `commitProgressionDecision`, the DB schema, and the session FSM are all untouched. The resumable pause (`←`) is unchanged. No new theme tokens.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Reusing `deriveSessionSummary` for the confirm → overcounts exercises on a partial session (e.g. "5 exercises" instead of "3" in AE3). | Dedicated `deriveEarlyFinishSummary` counting only ≥1-log exercises; unit-tested against AE3 (U1). |
| Top-bar control wired to navigate directly → finish-early seals without the confirm (violates R4, irreversible). | Top-bar tap opens the sheet only; **only** the sheet's "Finish session" calls `goToComplete`. Explicitly-named callbacks (`onRequestFinish` opens the sheet, `goToComplete` navigates) make the collision impossible to reintroduce silently (U3). |
| Tapping Finish while a set append/undo is in flight navigates to `/complete` before the write commits → last logged set dropped from the seal. | `canFinish` carries `&& !isPending` (mirrors `canUndo`), disabling the control during any in-flight transition (U3); the sheet's confirm also disables after first tap (U2). |
| Confirm sheet adds a browser-history marker (à la the documented `Drawer` bug) → breaks Back. | Mirror `FailedSheet`'s plain controlled `Drawer` (no `history.pushState`); no back-to-dismiss handling (U2). |
| 6th top-bar element crowds the routine name at narrow width. | Existing `min-w-0 flex-1 !truncate` absorbs width; pixel check deferred to implementation against a real mobile width. |
| Adding a `.tsx` test harness to "cover" U2/U3 → scope creep against origin Success Criteria and codebase convention. | Logic extracted to U1 (tested); U2/U3 verified by type-check/lint/manual, per the documented dumb-tsx split. |

**Dependencies (all verified present in the working tree):** the `/complete` page + `CompleteRunner`, `completeSession`, `commitProgressionDecision`, `classifyPostSession`, `appendSetLog`, and the `one_active_session_per_routine` index — all reused unchanged.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-02-swole-finish-early-requirements.md](docs/brainstorms/2026-06-02-swole-finish-early-requirements.md)
- Runner + top bar: `apps/swole/src/components/session/SessionRunner.tsx`, `apps/swole/src/components/session/TopBar.tsx`
- Sheet pattern: `apps/swole/src/components/session/FailedSheet.tsx`; terminal copy: `apps/swole/src/components/session/TerminalCard.tsx`
- View-model + tests: `apps/swole/src/lib/runner.ts`, `apps/swole/src/lib/__tests__/runner.spec.ts`
- Reused handoff: `apps/swole/src/app/session/[id]/complete/page.tsx`, `apps/swole/src/components/session/CompleteRunner.tsx`
- Reused persistence: `apps/swole/src/db/sessions.ts`, `apps/swole/src/db/setLogs.ts`, `apps/swole/src/db/schema.ts`, `apps/swole/src/core/session-machine.ts`
- Learnings: `docs/solutions/ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md`, `docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`, `docs/solutions/conventions/type-guards-over-nonnull-assertions-on-db-rows-2026-05-30.md`, `docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`, `docs/solutions/logic-errors/consistency-percent-window-mismatch-2026-05-30.md`
