---
date: 2026-05-28
topic: swole-active-session
---

# Swole — Active Session Runner

## Problem Frame

Home already routes `Start session` and `Resume →` to `/session/[id]`, and the
three layers underneath that route are built and tested: the session FSM
(`apps/swole/src/core/session-machine.ts`), the data layer
(`apps/swole/src/db/*`), and the server actions (`apps/swole/src/actions/*`).
But `/session/[id]` does not exist — there is no `apps/swole/src/app/session/`
directory. The core loop of the entire app — walk a routine set by set,
deciding after each set whether to bump the weight up, hold, drop, or record a
miss — has no UI.

This brainstorm scopes that screen: the in-session runner. It is the last
load-bearing piece of the end-to-end PRD F2 walkthrough and the first surface
where the user spends an entire workout — one thumb, glancing, between sets.
Everything beneath it is done, so the runner is **thin client glue** over the
FSM (the pure rules) and the existing server actions (persistence). Its job is
to render the one actionable set, dispatch the PRD's set actions, advance the
cursor, and let the user navigate or undo — nothing more. It invents no rules
the FSM doesn't already own.

The runner loop ends where the FSM says the session is complete (`nextTarget`
returns `null`) by surfacing a `Finish session →` hand-off. The post-session
weight prompt (PRD F3) behind that button, and the `completeSession` write that
seals the session, are a **separate follow-up brainstorm** and are explicitly
out of scope here.

---

## Key Flows

- F1. **Run a set**
  - **Trigger:** User is on `/session/[id]` with an actionable set.
  - **Steps:** The card shows the current exercise, set position, and target. The user does the set in real life and taps one action button. The client computes the new `SetLog` via `applyAction`, advances the optimistic state immediately, and persists via the `appendSetLog` server action. The card re-renders on the next set.
  - **Outcome:** One `set_logs` row exists; the runner shows the next set (or the next exercise's first set, or the terminal state).
  - **Covered by:** R3, R5, R6, R9, R10, R20.

- F2. **Record a failed set**
  - **Trigger:** User taps `Failed` (weighted / bodyweight / time-based).
  - **Steps:** A modal opens asking how many reps (or how many seconds, for time-based), defaulting to the target. The user adjusts and confirms; the client dispatches `Failed{actualReps}` or `Failed{actualDuration}`. Cancel closes without logging.
  - **Outcome:** The set logs with actual below target; the next set's weight behaves as if `Stay` was chosen (FSM rule R8 of the session-machine brainstorm).
  - **Covered by:** R10, R11.

- F3. **Jump to another exercise**
  - **Trigger:** User opens the exercises drawer and taps an exercise.
  - **Steps:** The drawer lists every exercise with its state and set progress. Tapping an exercise with sets remaining moves the active set there (`JumpTo`). Tapping a finished exercise opens a read-only review of its logged sets with `← Back to current set`.
  - **Outcome:** The active set becomes the chosen exercise's next unlogged set, or the user is reviewing a finished exercise read-only.
  - **Covered by:** R12, R13, R14, R15.

- F4. **Undo the last set**
  - **Trigger:** User taps undo in the top bar.
  - **Steps:** The client pops the last `SetLog` (optimistic) and calls `undoLastSetLog`. The active set steps back to the just-undone position, crossing an exercise boundary if needed.
  - **Outcome:** The last `set_logs` row is gone; the runner sits exactly in the pre-tap state.
  - **Covered by:** R16, R17.

- F5. **Leave and resume**
  - **Trigger:** User taps `←` (or navigates away) mid-session.
  - **Steps:** Routes to home. The session stays `completed_at IS NULL`. Home's `ResumeBanner` resurfaces it; tapping `Resume →` returns to `/session/[id]` at the same active set.
  - **Outcome:** No data loss and no explicit abandon — leaving is just navigation.
  - **Covered by:** R18.

- F6. **Reach the end**
  - **Trigger:** The last prescribed set is logged and `nextTarget` returns `null`.
  - **Steps:** The card swaps to a terminal "all sets done" state with a session summary and a primary `Finish session →` button. Undo still pulls the user back into the runner.
  - **Outcome:** The user is one tap from the (future) post-session prompt; the hand-off target may stub during interim dev.
  - **Covered by:** R23, R24.

---

## Requirements

**Route, hydration, and state ownership**

- R1. The runner lives at `apps/swole/src/app/session/[id]/page.tsx` (a new `session/` directory). The page is a server component that hydrates via `buildSessionState({ sessionId })` and passes the `{ session, routine, sessionState }` bundle into a client runner component.
- R2. When `buildSessionState` returns `null` (unknown id, or the session is already completed — `getActiveSession` filters `completed_at IS NULL`), the page renders a "this session isn't active" state with a link back to home rather than throwing. A completed session id is not resumable through the runner.
- R3. The runner is a client component driven by React 19's `useOptimistic` over `SessionState`, per ADR-001 and the PRD. Each action updates the optimistic state synchronously, then a server action persists. The FSM functions (`applyAction`, `undo`, `nextTarget`) are the only source of advance/target/validity rules; the runner duplicates none of them.
- R4. `cursorOverride` (the `JumpTo` cursor) is client-only optimistic state — it is never persisted and hydration never reproduces it (per the `apps/swole/src/db/hydration.ts` contract). The runner owns it for the lifetime of the screen.

**Current-set card**

- R5. The card renders the active position from `nextTarget(state, routine)`: exercise name, set position (`Set {setIdx + 1} of {sets}`), and the target formatted by type — weighted `{weight} lb × {reps}`, bodyweight `{reps} reps`, time-based / cardio duration via the existing `apps/swole/src/lib/format.ts` helpers. Single-set cardio omits the `of N` set line.
- R6. Above the buttons, a quiet previous-set peek shows the current exercise's last logged set and the action taken (e.g., `last · 105 lb × 10 · Increment`). On the first set of an exercise it shows starting context instead (weighted: `starting weight {startingWeight} lb`; non-weighted: omitted).
- R7. Action buttons render as an **equal-size grid** — meaning carried by color + icon, not size. Stable semantic treatment: `Increment` accent/▲, `Stay` neutral/=, `Decrement` amber/▼, `Failed` distinct red, `Complete` accent/✓, `Hold` neutral, `Done` accent, `Skipped` neutral. `Increment` carries the accent on weighted mid-sets.
- R8. Button **positions are stable** across exercise types and set positions so muscle memory transfers: the advance/happy-path action holds one fixed slot (`Complete` takes `Increment`'s slot on the last set), and `Failed` holds one fixed slot. Two-button types (bodyweight / time-based / cardio) occupy the same anchor slots rather than re-centering.
- R9. On **weighted mid-sets only**, each weight-changing button shows its consequence — the resulting next-set weight: `Increment →{w+inc}`, `Stay →{w}`, `Decrement →{w−inc}` — computed from `nextTarget().weight` and the exercise's `increment`. Previews are not shown on the last set, bodyweight, time-based, or cardio.

**Set actions and the Failed modal**

- R10. The button set shown is exactly what the FSM permits for the (type × set-position) cell: weighted mid `Increment / Stay / Decrement / Failed`, weighted last `Complete / Stay / Decrement / Failed`, bodyweight `Complete / Failed`, time-based `Hold / Failed`, cardio `Done / Skipped`. The runner never presents an action `applyAction` would reject.
- R11. `Failed` opens a modal (bottom sheet on mobile): weighted / bodyweight → "How many reps did you get?" defaulting to `targetReps`; time-based → "How long did you hold?" in seconds defaulting to `durationSeconds`. A stepper (± and tap-to-type) collects the value; Confirm dispatches `Failed{actualReps}` or `Failed{actualDuration}`; Cancel closes and logs nothing.

**Exercise navigation and review**

- R12. A bottom-sheet drawer (opened from the top bar) lists every exercise in routine order with: name, type, set progress (`2/3`, `✓` when done, `○` when unstarted), and the current exercise highlighted.
- R13. Tapping an exercise with sets remaining issues a `JumpTo`: the active set becomes that exercise's next unlogged set, and the drawer closes. Tapping the current exercise just closes the drawer.
- R14. Tapping a **fully-logged** exercise opens a read-only review card for it: its logged sets (per set — weight/reps/duration plus the action taken), no action buttons, and a `← Back to current set` control that returns to the natural active position (clearing the override).
- R15. Normal logging **always advances to the next incomplete set**, clearing any override — the runner never strands the user on a completed exercise. The read-only review state (R14) is reached only by deliberately tapping a finished exercise in the drawer, never by finishing the set you are on.

**Top bar, undo, progress, and exit**

- R16. The top bar shows, left to right: `←` close, the routine name, a session progress indicator (`Exercise {i + 1}/{n}` plus a thin completed-sets bar), an undo control, and the drawer trigger. The progress indicator is derived from the optimistic `SessionState` + `routine`, so it updates on every action and undo with no server round-trip.
- R17. Undo is enabled once at least one set is logged this session and requires **no confirmation** (it is instantly re-doable by re-tapping). It pops the last `SetLog` optimistically and calls `undoLastSetLog({ sessionId })`; the active set steps back to the undone position, across exercise boundaries (undoing a `Complete` returns to that exercise's last set).
- R18. `←` routes to home (`/`) with **no confirmation**. Leaving is non-destructive: the session stays `completed_at IS NULL`, and home's `ResumeBanner` brings the user back to the same active set. There is no abandon/discard control in this scope.

**Reconciliation, errors, and degraded data**

- R20. On a successful `appendSetLog` / `undoLastSetLog`, no further UI work is required — the optimistic state already reflects it; the runner does not re-fetch on the happy path.
- R21. Error handling by failure mode: a generic `appendSetLog` failure rolls the optimistic set back and shows a retry toast; `DuplicateSetLog` (a re-fired or raced write) triggers a re-hydration from the server (the persisted row wins) with a "synced" notice; `SessionAlreadyCompleted` (another tab finished or sealed the session) stops input and routes home with a "completed elsewhere" notice.
- R22. When hydration reports a non-empty `failedSetLogIds` (one or more set logs could not be reconstructed), the runner shows a dismissible warning strip ("some earlier sets couldn't be loaded — your position may be off") and stays usable, mirroring home's degraded handling.

**Terminal hand-off**

- R23. When `nextTarget` returns `null`, the card area swaps to a terminal state: an "all sets done" headline, a short session summary (exercises performed and total sets logged), and a primary `Finish session →` button.
- R24. `Finish session →` is the boundary of this scope. It hands off to the post-session prompt (PRD F3) plus `completeSession`, which are a separate follow-up brainstorm. Until that lands, the hand-off target may route to a stub/placeholder (e.g., `/session/[id]/complete`) — acceptable interim behavior, exactly as home's links may 404 during in-flight Survivor 4. Undo remains available in the terminal state and pulls the user back into the runner.

---

## Visual sketch

Active set — weighted mid-set (Bench Press, set 1 of 3, +5 increment):

```
┌──────────────────────────────────────────────┐
│ ←   Push Day        Ex 1/3  ▕▏    ↶      ≡    │  ← R16 top bar
│                     ▰▰▱▱▱▱▱▱▱▱  (sets bar)     │
├──────────────────────────────────────────────┤
│                                              │
│              Bench Press                     │  ← R5
│              Set 1 of 3                       │
│                                              │
│              100 lb × 10                      │  ← target (big)
│                                              │
│     last · starting weight 100 lb            │  ← R6 peek (set 1)
│                                              │
│   ┌───────────────┐   ┌───────────────┐      │
│   │ ▲ Increment   │   │ = Stay        │      │  ← R7/R8 equal grid
│   │     →105      │   │     →100      │      │     R9 previews
│   ├───────────────┤   ├───────────────┤      │
│   │ ▼ Decrement   │   │ ✕ Failed      │      │
│   │     →95       │   │               │      │
│   └───────────────┘   └───────────────┘      │
│                                              │
└──────────────────────────────────────────────┘
```

Last set swaps `Complete` into the advance slot; previews drop:

```
│   │ ✓ Complete    │   │ = Stay        │       │
│   ├───────────────┤   ├───────────────┤       │
│   │ ▼ Decrement   │   │ ✕ Failed      │       │
```

Drawer (R12–R14) and terminal state (R23):

```
  ≡ Exercises                     all sets done 💪
  ● Bench Press      3/3 ✓        Push Day · 3 exercises · 9 sets
  ○ Pushups          1/3
  ○ Plank            0/3   ○          [  Finish session →  ]
  (tap ✓ row → read-only review)      (↶ undo returns to runner)
```

---

## Acceptance Examples

- AE1. **Covers R5, R9.** Given Bench Press (weighted, 3×10 @ 100 lb, +5) on set 1, the card target reads `100 lb × 10` and the buttons read `Increment →105`, `Stay →100`, `Decrement →95`, `Failed` (no preview on `Failed`).
- AE2. **Covers R7, R8, R10.** On Bench Press set 3 (last set), the button set is `Complete / Stay / Decrement / Failed`; `Complete` occupies the slot `Increment` held on earlier sets, and no `→weight` previews are shown.
- AE3. **Covers R11.** Given Pushups (bodyweight, target 15) and the user taps `Failed`, the modal defaults to 15; entering 12 logs `actualReps = 12` and advances. (Bodyweight has no weight, so no next-weight effect.)
- AE4. **Covers R14, R15.** After tapping `Complete` on Bench Press's last set, the runner shows Pushups set 1 (auto-advance), not a Bench review. Separately, opening the drawer and tapping the now-`3/3 ✓` Bench row shows a read-only review of its three logged sets with `← Back to current set`.
- AE5. **Covers R17.** After `Complete` advanced Bench → Pushups, tapping undo deletes that `Complete` log and returns the active set to Bench set 3, with the target re-derived from the prior sets.
- AE6. **Covers R23.** After the last set of the last exercise is logged, the card shows "all sets done", a summary line (`3 exercises · 9 sets`), and a primary `Finish session →` button.
- AE7. **Covers R21.** Given a second browser tab completed this session, when the user taps an action in the first tab, `appendSetLog` throws `SessionAlreadyCompleted`; the runner stops accepting input and routes home with a "completed elsewhere" notice.

---

## Success Criteria

- The full PRD F2 "Push Day" walkthrough runs end-to-end in the browser: Bench Press `Increment`/`Stay`/`Complete`, Pushups `Failed(12)`/`Complete`/`Complete`, Plank `Hold`×3 — with correct targets, button previews, and progress at each step — and reaches the terminal `Finish session →`. Leaving mid-way and tapping `Resume →` from home lands on the exact set with no data loss.
- The runner imports the FSM (`applyAction`, `undo`, `nextTarget`) and the existing server actions (`appendSetLog`, `undoLastSetLog`) without modifying either and without duplicating any FSM rule in a component.
- `pnpm --filter @lilnas/swole lint`, `pnpm --filter @lilnas/swole type-check`, and `pnpm --filter @lilnas/swole test` all pass; the Survivor 1–3 + home suites still pass unchanged.
- The next brainstorm (PRD F3 post-session prompt) starts from a working `Finish session →` hand-off without re-litigating the runner's card, buttons, navigation, or error handling.

---

## Scope Boundaries

- No PRD F3 post-session weight prompt and no `completeSession` / `commitProgressionDecision` call beyond the `Finish session →` hand-off button. That screen and its writes are a separate follow-up brainstorm. `classifyPostSession` is not consumed here.
- No abandon / discard control. Leaving mid-session is plain navigation to home; the session stays resumable via the existing banner.
- No rest timer, no per-set free-text notes, no arbitrary/free-text weight entry — all PRD non-goals. Weight is always FSM-derived from the chosen action; the only weight controls are the action buttons.
- No inline editing of past sets. The only mutation of session history is undo (pop the last log); the read-only review (R14) is strictly read-only.
- No new FSM functions and no new data-layer queries. The runner is glue over the existing pure functions and server actions. (`getActiveSession`, `buildSessionState`, `appendSetLog`, `undoLastSetLog` already exist and are tested.)
- No routine builder (`/routines/new`), stats pages (`/stats/[exerciseId]`), per-routine detail (`/routines/[id]`), or per-session detail page. Links to not-yet-built routes may 404 during interim deploys, consistent with home.
- No handling of multiple concurrent active sessions beyond the single id in the route; the cross-tab `SessionAlreadyCompleted` path (R21) is the only multi-actor case covered.
- No PWA, offline mode, or native shell. Mobile-first responsive HTML only.
- No analytics or per-tap telemetry beyond the existing `/metrics` Prometheus surface.
- No new theme tokens or global CSS. Reuse the dark / deep-orange MUI theme and `cns()`.

---

## Key Decisions

- **Scope is the runner loop only; F3 splits off.** A runner that hands off cleanly at "all sets done" is a complete, testable deliverable, while F3 is a distinct screen with its own write path (`commitProgressionDecision`). Splitting keeps each PR's surface small, matching the Survivor sequencing the prior brainstorms established.
- **Composition A — focused current-set card + drawer.** Gym ergonomics favor one calm decision with big targets; the FSM only ever exposes one actionable cell, so the UI must not imply otherwise. History visibility belongs to the future stats pages (F4) — the same trade the home brainstorm used to reject a dashboard.
- **Equal-grid buttons with color + icon + stable positions, not a size hierarchy.** At N=1, positional muscle memory plus semantic color beats a size tier and never shrinks the button you need (including `Failed`). It also absorbs the last-set `Complete`-for-`Increment` swap and the 4→2 button reductions without moving anything.
- **Consequence previews on weighted mid-set buttons.** The up/stay/down choice is really "what weight next set?"; showing the resulting weight answers that more directly than showing where you've been, and it is free to compute from `nextTarget().weight` and `increment`.
- **Previous-set peek over always-on within-exercise history.** Orientation without clutter. The full per-exercise history is surfaced on demand in the read-only review (option ii) and lives permanently in stats — so it is not duplicated mid-set.
- **Jump-to-done is a read-only review, not a blocked tap.** Lets the user review a finished exercise mid-workout while sidestepping the FSM's "set index past last set throws" edge. Because normal logging always auto-advances, the user is never stranded on a full exercise.
- **Leaving is non-destructive, with no abandon and no confirm.** Resume is already designed (home banner); a confirmation on a reversible, data-safe action is pure friction; an abandon control above the fold was explicitly rejected for home and has no home in this scope.
- **Optimistic UI with explicit reconciliation per error mode.** `appendSetLog` deliberately throws on duplicates ("the caller compares field-by-field and decides whether to re-hydrate") and seals completed sessions. The runner honors those contracts (re-hydrate / stop + route home) rather than swallowing them.

---

## Dependencies / Assumptions

- Survivors 1–3 and the home page are merged. The FSM, the data layer, the server actions (`appendSetLog`, `undoLastSetLog`, `startSession`, `completeSession`, `commitProgressionDecision`), and `buildSessionState` all exist and are tested. Verified against the working tree.
- `buildSessionState({ sessionId })` runs from a server component and returns `{ session, routine, sessionState, progressions, failedSetLogIds }`; `cursorOverride` is UI-transient and never hydrated. Verified in `apps/swole/src/db/hydration.ts`.
- `appendSetLog` accepts a fully-resolved log (`weight`, `targetReps`, `actualReps`, `durationSeconds`, `actualDurationSeconds`, `action`) — so the client FSM computes the `SetLog` and sends resolved fields while the server persists and guards races (`BEGIN IMMEDIATE`, sealed-session check, `UNIQUE` duplicate detection). Verified in `apps/swole/src/db/setLogs.ts`.
- The eight PRD action labels plus `JumpTo` are the FSM's stable vocabulary; `PersistableAction` excludes `JumpTo` (UI-only). Verified in `apps/swole/src/core/session-machine.ts` and `apps/swole/src/db/setLogs.ts`.
- The existing `apps/swole/src/lib/format.ts` helpers cover target/duration formatting; a small runner-specific formatter may be added but introduces no new domain logic.
- The dark / deep-orange MUI 7 theme (`apps/swole/src/theme.tsx`) plus Tailwind and `cns()` are sufficient; mobile-first. Forward-auth at Traefik is the only auth gate; the runner makes no per-request authorization checks.
- `/routines/[id]`, `/routines/new`, and the F3 completion target may not exist yet; runner links to them may 404 during interim deploys (acceptable, matching home).

---

## Outstanding Questions

### Resolve Before Planning

_None. All product and interaction decisions are settled._

### Deferred to Planning

- [Affects R1, R3][Technical] Exact client/server split — a single client runner subtree vs. a thin server page wrapping it — and where the server actions are imported. ADR-001 path; planner picks the cleanest boundary.
- [Affects R11][Technical] Failed-modal primitive (MUI `Dialog` vs. `SwipeableDrawer`/bottom sheet) and the stepper increment for time-based (`±1s` vs `±5s`).
- [Affects R7, R9][Technical] Exact color tokens and icons per action, and how the consequence preview renders within a button (subtitle line vs. trailing chip) without crowding the equal grid at narrow widths.
- [Affects R12, R16][Technical] Drawer primitive (MUI `Drawer` / bottom sheet) and whether the progress bar counts sets or exercises; how `Exercise i/n` reads when the cursor is on a jumped-to exercise.
- [Affects R21][Technical] The re-hydration mechanism on `DuplicateSetLog` (router `refresh()` vs. re-invoking `buildSessionState` through a server action) and the exact copy for each toast.
- [Affects R23, R24][Technical] Final hand-off target for `Finish session →` (a real `/session/[id]/complete` route vs. an inline disabled placeholder) — settles when the F3 brainstorm runs; pick the cheapest interim that doesn't mislead the user.
- [Affects R6][Editorial] Whether the previous-set peek prints the action label verbatim (`Increment`) or a friendlier gloss; align with whatever the stats pages adopt.
- [Affects R5][Technical] Single-set cardio card phrasing (`set 1/1` vs. no set line); confirm against the runner's first manual test.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
