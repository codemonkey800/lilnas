---
title: 'feat: Swole active-session runner — current-set card, set actions, navigation, undo, and terminal hand-off'
type: feat
status: active
date: 2026-05-29
origin: docs/brainstorms/2026-05-28-swole-active-session-requirements.md
---

# feat: Swole active-session runner — current-set card, set actions, navigation, undo, and terminal hand-off

## Overview

Build the in-session runner at `apps/swole/src/app/session/[id]/page.tsx` — the route home already links to but that does not yet exist. The runner is **thin client glue** over three already-built, already-tested layers: the pure session FSM (`apps/swole/src/core/session-machine.ts`), the data layer (`apps/swole/src/db/*`), and the server actions (`apps/swole/src/actions/*`). Its job is to render the one actionable set the FSM exposes, dispatch the PRD's set actions, advance the cursor, and let the user navigate or undo — inventing no rules the FSM doesn't already own.

The work splits into pure, testable logic (a runner view-model module + runner formatters/error-mappers, both `.ts` with Jest specs) and untested client `.tsx` glue (the route page plus a `src/components/session/` component tree). This decomposition is deliberate: this app's Jest runs in a **node** environment with **no jsdom and no React Testing Library** (verified in `apps/swole/jest.config.js` and across the monorepo — zero `.tsx` test files exist), so every decision a test could protect lives in a pure module, and the components stay thin enough to verify by running the PRD F2 walkthrough in a browser.

The loop ends where the FSM says the session is complete (`nextTarget` returns `null`) by surfacing a `Finish session →` hand-off. The post-session weight prompt (PRD F3) behind that button, and the `completeSession` write, are a **separate follow-up brainstorm** and are explicitly out of scope (see origin: `docs/brainstorms/2026-05-28-swole-active-session-requirements.md`).

---

## Problem Frame

Home routes `Start session` and `Resume →` to `/session/[id]`, but `apps/swole/src/app/session/` does not exist — the core loop of the entire app has no UI. This is the last load-bearing piece of the end-to-end PRD F2 walkthrough and the first surface where the user spends an entire workout: one thumb, glancing, between sets.

The origin requirements doc settled every product and interaction decision (its "Resolve Before Planning" section is explicitly empty). What remained were technical choices — client/server split, modal/drawer primitives, color/icon tokens, the re-hydration mechanism, and the `Finish` hand-off target — all of which this plan resolves from existing in-repo patterns (the home page, `RoutineCard`'s MUI usage, the `yoink` `useOptimistic` precedent) and ADR-001's constraints. This plan turns the origin's R1–R24 / F1–F6 / AE1–AE7 into ordered, file-by-file slices with explicit test scenarios for the new pure code paths.

---

## Requirements Trace

**Route, hydration, and state ownership**

- R1. Runner at `apps/swole/src/app/session/[id]/page.tsx` (new `session/` dir); page is a server component that hydrates via `buildSessionState({ sessionId })`, fetches the routine name via the existing `getRoutine` (since `buildSessionState`'s `routine` is the name-less `RoutineWithIds`), and passes `{ session, routine, routineName, sessionState, failedSetLogIds }` into a client runner.
- R2. When `buildSessionState` returns `null` (unknown id or completed session), render a "this session isn't active" state with a link home — do not throw. Completed sessions are not resumable through the runner.
- R3. Runner is a client component driven by React 19's optimistic state over `SessionState`. Each action updates optimistic state synchronously, then a server action persists. The FSM (`applyAction`, `undo`, `nextTarget`) is the only source of advance/target/validity rules; the runner duplicates none of them.
- R4. `cursorOverride` (the `JumpTo` cursor) is client-only transient state — never persisted, never hydrated. The runner owns it for the screen's lifetime.

**Current-set card**

- R5. Card renders the active position from `nextTarget(state, routine)`: exercise name, `Set {setIdx + 1} of {sets}`, and the type-formatted target. Single-set cardio omits the `of N` set line.
- R6. A quiet previous-set peek shows the current exercise's last logged set + action (`last · 105 lb × 10 · Increment`). On the first set it shows starting context (weighted: `starting weight {startingWeight} lb`; non-weighted: omitted).
- R7. Action buttons render as an equal-size grid — meaning by color + icon, not size. Stable semantic treatments (R7 table below).
- R8. Button positions are stable across exercise types and set positions; the advance/happy-path action holds one fixed slot (`Complete` takes `Increment`'s slot on the last set), `Failed`/exit holds one fixed slot; two-button types occupy the same anchor slots.
- R9. On weighted mid-sets only, each weight-changing button shows its consequence (`Increment →{w+inc}`, `Stay →{w}`, `Decrement →{w−inc}`) from `nextTarget().weight` and `increment`. No previews on last set, bodyweight, time-based, or cardio.

**Set actions and the Failed modal**

- R10. The button set is exactly what the FSM permits for the (type × set-position) cell. The runner never presents an action `applyAction` would reject.
- R11. `Failed` opens a bottom sheet: weighted/bodyweight → "How many reps did you get?" defaulting to `targetReps`; time-based → "How long did you hold?" (seconds) defaulting to `durationSeconds`. A stepper collects the value; Confirm dispatches `Failed{actualReps}` / `Failed{actualDuration}`; Cancel logs nothing.

**Exercise navigation and review**

- R12. A bottom-sheet drawer lists every exercise in routine order with name, type, set progress (`2/3`, `✓`, `○`), and the current exercise highlighted.
- R13. Tapping an exercise with sets remaining issues a `JumpTo` and closes the drawer; tapping the current exercise just closes it.
- R14. Tapping a fully-logged exercise opens a read-only review card (its logged sets + actions, no action buttons, a `← Back to current set` control).
- R15. Normal logging always advances to the next incomplete set, clearing any override. The read-only review is reached only by deliberately tapping a finished exercise.

**Top bar, undo, progress, and exit**

- R16. Top bar (left→right): `←` close, routine name, session progress (`Exercise {i+1}/{n}` + thin completed-sets bar), undo control, drawer trigger. Progress derives from optimistic `SessionState` + `routine` — updates on every action/undo with no server round-trip.
- R17. Undo is enabled once ≥1 set is logged this session, requires no confirmation, pops the last `SetLog` optimistically + calls `undoLastSetLog({ sessionId })`; the active set steps back across exercise boundaries.
- R18. `←` routes to home with no confirmation; leaving is non-destructive (session stays `completed_at IS NULL`); no abandon/discard control.

**Reconciliation, errors, and degraded data**

- R20. On a successful `appendSetLog` / `undoLastSetLog`, no further UI work — optimistic state already reflects it; no happy-path re-fetch.
- R21. Error handling by failure mode: generic `appendSetLog` failure → roll back + retry toast; `DuplicateSetLog` → re-hydrate (persisted row wins) + "synced" notice; `SessionAlreadyCompleted` → stop input + route home + "completed elsewhere" notice.
- R22. Non-empty `failedSetLogIds` → dismissible warning strip ("some earlier sets couldn't be loaded — your position may be off"); stays usable, mirroring home's degraded handling.

**Terminal hand-off**

- R23. When `nextTarget` returns `null`, the card area swaps to a terminal state: "all sets done" headline, a session summary (exercises performed + total sets logged), and a primary `Finish session →` button.
- R24. `Finish session →` is the scope boundary; it hands off to the future PRD F3 prompt. Until that lands the target may route to a stub. Undo remains available in the terminal state and pulls the user back into the runner.

**Origin actors:** A1 (the single lifter — N=1; the only actor, except the cross-tab "other session" in R21/AE7).
**Origin flows:** F1 (Run a set), F2 (Record a failed set), F3 (Jump to another exercise), F4 (Undo the last set), F5 (Leave and resume), F6 (Reach the end).
**Origin acceptance examples:** AE1 (covers R5, R9), AE2 (R7, R8, R10), AE3 (R11), AE4 (R14, R15), AE5 (R17), AE6 (R23), AE7 (R21).

---

## Scope Boundaries

- No PRD F3 post-session weight prompt and no `completeSession` / `commitProgressionDecision` / `classifyPostSession` call beyond the `Finish session →` hand-off button.
- No abandon / discard control. Leaving mid-session is plain navigation to home.
- No rest timer, no per-set free-text notes, no arbitrary/free-text weight entry. Weight is always FSM-derived; the only weight controls are the action buttons.
- No inline editing of past sets. The only mutation of session history is undo; the read-only review (R14) is strictly read-only.
- **No new FSM functions and no new data-layer queries.** The runner is glue over existing pure functions (`applyAction`, `undo`, `nextTarget`) and existing server actions (`appendSetLog`, `undoLastSetLog`) plus existing reads (`buildSessionState`, `getRoutine`). This constraint is load-bearing — see the Key Technical Decision on the button matrix.
- No routine builder, stats pages, per-routine detail, or per-session detail page. Links to not-yet-built routes may 404 during interim deploys, consistent with home.
- No handling of multiple concurrent active sessions beyond the single id in the route; the cross-tab `SessionAlreadyCompleted` path (R21) is the only multi-actor case covered.
- No PWA, offline mode, or native shell. Mobile-first responsive HTML only.
- No analytics or per-tap telemetry beyond the existing `/metrics` surface.
- No new theme tokens or global CSS. Reuse the dark / deep-orange MUI 7 theme (`apps/swole/src/theme.tsx`), Tailwind's default palette, and `cns()`.
- No `.tsx` rendering tests. This app has no jsdom/RTL harness; the component tree is verified by the manual PRD walkthrough. Test coverage targets the pure modules only (U1, U2).

### Deferred to Follow-Up Work

- The PRD F3 post-session prompt + `completeSession` write at the `Finish session →` target (`/session/[id]/complete`): separate brainstorm + plan. This plan routes to that path with the expectation that F3 consumes the same hydrated `SessionState` the runner already drives.
- A `docs/solutions/` writeup on the React 19 `useOptimistic` + server-action reconciliation pattern and the client-only `cursorOverride` state model: `/ce-compound` follow-up once this PR lands (both were undocumented open questions; see Institutional Learnings).

---

## Context & Research

### Relevant Code and Patterns

- **`apps/swole/src/core/session-machine.ts`** — the pure FSM. Consumed unchanged. Key exports and their exact shapes:
  - `applyAction(state, action, routine): SessionState` — validates the action against the (type × last-set) cell via the internal `isValidActionForCell` and **throws** on an invalid action or a complete session. `JumpTo` returns `{ setLogs, cursorOverride }` (range-checked); every non-`JumpTo` return is `{ setLogs: [...] }` with **no** override (so a normal log clears the override).
  - `undo(state): SessionState` — pops the last log; with no logs but a lone `cursorOverride`, clears the override.
  - `nextTarget(state, routine): NextTarget | null` — `null` is the terminal signal (R23). Otherwise `{ weight?, reps?, duration?, exerciseIdx, setIdx }`. Weighted `weight` comes from the internal `deriveNextWeight` (prior log's action ± `increment`, else `startingWeight`).
  - Types: `Action` (8 persistable variants + `JumpTo`; `Failed` is split `{actualReps}` vs `{actualDuration}` sharing `type: 'Failed'`), `SessionState = { setLogs: SetLog[]; cursorOverride?: number }`, `Exercise` discriminated union, `NextTarget`. **`isValidActionForCell` is NOT exported** — see the button-matrix decision.
- **`apps/swole/src/db/hydration.ts`** — `buildSessionState({ sessionId }): Promise<HydratedSession | null>` returns `{ session, routine: RoutineWithIds, sessionState, progressions, failedSetLogIds }`. Returns `null` for unknown-or-completed ids (`getActiveSession` filters `completed_at IS NULL`). `cursorOverride` is documented UI-transient and never reproduced (lines 75–78). **`routine` is `RoutineWithIds = { exercises: ExerciseWithId[] }` — it has no `name` field**; the routine name must come from `getRoutine` (see page unit).
- **`apps/swole/src/db/mappers.ts`** — `toSetLogArgs(setLog, sessionId, routine): AppendSetLogArgs` converts an FSM `SetLog` → primitive args (`setNumber = setIdx + 1`, `exerciseId` resolved from `routine.exercises[idx].id`, mirrors a time-based `Failed`'s `actualDuration` to the column). `ExerciseWithId`/`RoutineWithIds` exported here. The runner builds args via this — never hand-rolls the mapping.
- **`apps/swole/src/actions/setLogs.ts`** — `appendSetLog(args): Promise<SetLogRow>` and `undoLastSetLog({ sessionId }): Promise<void>`, both `'use server'`, both call `revalidatePath('/session/${sessionId}')` **after** the DB write (so a throw skips revalidation — relevant to R21). Imported directly into the client container.
- **`apps/swole/src/db/setLogs.ts`** — `AppendSetLogArgs` shape; `appendSetLog` runs `BEGIN IMMEDIATE`, throws `SessionAlreadyCompleted` on a sealed session and `DuplicateSetLog` (carrying the `existing` row) on the `UNIQUE(session_id, exercise_id, set_number)` violation. `undoLastSetLog` throws `UndoBlockedBySessionCompleted` / `UndoBlockedByCommittedProgression` in edge cases.
- **`apps/swole/src/db/errors.ts`** — tagged `DataLayerError` hierarchy with a `kind` discriminator (`'validation' | 'not_found' | 'conflict' | 'forbidden_transition' | 'hydration'`). The runner's reconciliation switches on `instanceof` of the concrete classes (`DuplicateSetLog`, `SessionAlreadyCompleted`, …), matching `mapStartSessionError`'s style.
- **`apps/swole/src/lib/format.ts`** — pure display helpers, "consumable from anywhere" (no directive). Holds `formatTimeBasedDuration`, `formatCardioDuration`, `formatBannerSubtitle` (type-exhaustive `switch`), and the `ErrorToast = { message; severity }` + `mapStartSessionError` mapper pattern. U2 extends this file in the same style.
- **`apps/swole/src/app/page.tsx`** — the server/client reference. `export const dynamic = 'force-dynamic'`; hydrates via `buildSessionState` + `getRoutine`, derives display with the pure FSM, passes plain serializable props to client components, guards `null` with a fallback rather than throwing. The runner page mirrors this exactly.
- **`apps/swole/src/components/home/ResumeBanner.tsx`** — server component; `<Button href={`/session/${sessionId}`}>` navigates client-side because the theme defaults `LinkComponent` (no `component={Link}` needed). The runner's home/exit links and `Finish session →` use the same `href` form.
- **`apps/swole/src/components/home/RoutineCard.tsx`** — the client-interaction reference: `'use client'`, `useRouter` + `useTransition` + `useState`, MUI `Dialog`/`Menu`, and the canonical error flow `try { await action() } catch (err) { const { message, severity } = mapXxxError(err); showToast(message, severity) }`. `useCallback` with explicit dep arrays (exhaustive-deps is enforced). The runner's container follows this shape.
- **`apps/yoink/src/app/(library)/admin/admin-content.tsx`** — the only prior `useOptimistic` use in the monorepo: `const [state, addOptimistic] = useOptimistic(serverState, reducer)` + `startTransition(async () => { addOptimistic(msg); await action() })`. The runner generalizes this with an FSM-backed reducer and adds per-error reconciliation (which yoink does not have).
- **`apps/swole/src/components/toast-provider.tsx`** + **`apps/swole/src/hooks/use-toast.ts`** — `useToast()` → `showToast(message, severity?)`; one bottom-center `Snackbar`+`Alert`. All R21/R22 notices route through this.
- **`apps/swole/src/theme.tsx`** + **`apps/swole/src/tailwind.css`** — dark / `deepOrange` MUI 7 theme; `scrollbar-gutter: stable` already set on `html` so the Failed sheet and exercises drawer don't shift the viewport. MUI components supply behavior; Tailwind utilities supply layout/color; `!`-prefixed utilities override MUI's Emotion styles; `cns()` for conditional/multi-source class strings.
- **`apps/swole/src/lib/__tests__/format.spec.ts`** + **`apps/swole/src/db/__tests__/`** — the test-layout precedent (node env, `server-only` auto-stubbed via `moduleNameMapper`, per-type cases). U1/U2 specs follow this.

### Institutional Learnings

- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — establishes that the FSM is the single source of advance/target/validity rules and that the runner is expected to wire it into optimistic state + a server action **without re-implementing any rule**. Confirms `SessionState` is append-only (`undo` is `setLogs.slice(0, -1)`) and `cursorOverride` is client-only / never hydrated. Caveat it records: the FSM's exhaustive test matrix still missed a `classifyPostSession` gap once — a reminder that the FSM tests pin *transitions*, not the runner's UI/reconciliation, so the runner needs its own tests.
- **`docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`** — this convention exists *because of* this runner. It names `useOptimistic` double-tap / retry / re-fire and multi-tab edits as the concurrency hazard and explains why the server actions **deliberately throw** on conflict (so the client decides whether to re-hydrate). The R21 reconciliation honors these throws (re-hydrate / stop+home), never swallows them; `DuplicateSetLog` means the write *landed* (re-hydrate, don't roll back), while a generic failure means it didn't (roll back).

### External References

- **React 19 `useOptimistic` semantics** (official docs, confirmed via Context7 `/reactjs/react.dev`): "React automatically reverts to the original value if the update fails or finishes," and — load-bearing for this plan — "When you call the setter outside an Action, the optimistic state will briefly appear and then immediately revert back to the original value… there's no Transition to 'hold' the optimistic state." This is why `cursorOverride`/`JumpTo` (which never hit the server) **cannot** ride `useOptimistic` and must be plain `useState` (see Key Technical Decisions).
- **Next.js 16 `useOptimistic` + Server Action pattern** (official docs, confirmed via Context7 `/vercel/next.js` v16.2.2 — the app's exact version): the documented forms pattern is `useOptimistic(serverProp, reducer)` with `formAction = async () => { addOptimistic(x); await serverAction() }`; the server prop the hook reconciles to re-bases when the action revalidates the path. This confirms the runner's happy path (R20) needs no explicit client refresh — `appendSetLog`'s `revalidatePath` re-bases the `sessionState` prop — and that `router.refresh()` is only required on the throw path (`DuplicateSetLog`), which skipped revalidation. No broader external research was needed — every other layer has strong in-repo patterns and ADR-001 pins the architecture.

---

## Key Technical Decisions

- **Client/server split: thin server page + one client container + presentational children (resolves origin deferred R1/R3).** `page.tsx` (server, `force-dynamic`) hydrates and passes plain props into `SessionRunner` (`'use client'`), which owns all state and imports the server actions. Children under `src/components/session/` are presentational (props + callbacks). This mirrors `page.tsx` → `ResumeBanner`/`RoutineCard` exactly and keeps the testable logic out of `.tsx`.

- **State model: `useOptimistic` for the persisted `setLogs` dimension; `useState` for `cursorOverride` and the review selection (resolves the central R3/R4 tension).** Per the React 19 docs, optimistic state evaporates the instant no Action is pending — so `JumpTo`/`Back` (no server write) and the read-only review (no server write) **must not** ride `useOptimistic` or they would vanish on the next render. The effective render state composes `{ setLogs: optimistic.setLogs, cursorOverride }`. The `useOptimistic` reducer handles only `action` (a persisted log) and `undo` — both always have a pending server action. This is the single most consequential decision in the plan; getting it wrong (putting `cursorOverride` in `useOptimistic`) produces a screen where jumps silently snap back.

  - **`cursorOverride` clearing discipline (load-bearing — splitting it into `useState` means the FSM's own override-clearing in `undo` is dead code, so the runner must clear it explicitly on every non-log path).** Because `cursorOverride` lives outside the optimistic state, it is cleared by: (a) logging a set — R15, already in the dispatch sketch; (b) **undo** — otherwise R17's "steps back across exercise boundaries" is violated (undo pops a log from another exercise while the screen stays pinned to the jumped one); (c) the **`rehydrate`** branch — `router.refresh()` does **not** clear it (see the re-hydration decision); (d) `Back` clears `reviewExerciseIdx`. The card-area mode switch must also **defensively treat an override pointing at a now-full exercise as "no actionable set"** (clear it / fall through to natural position or terminal), because `nextTarget` — unlike `applyAction` — does not range-check `setIdx` and would otherwise return a phantom "Set N+1 of N" target whose buttons all throw and which suppresses the terminal hand-off.
  - **Single-flight input while a write is pending (R20/R21 concurrency).** The container derives `isPending` from `useTransition()` and disables all action inputs (the button grid and the Failed-sheet Confirm) while a `setLog`/`undo` write is in flight. This is the documented gym-context hazard (double-tap / re-fire from the `BEGIN IMMEDIATE` learning) and it also removes the only path by which a rapid second tap could land after `cursorOverride` was cleared but before the prior write revalidates. Mirrors `RoutineCard`'s existing `disabled={isStartingSession}` pattern.

- **The button matrix is a pure, FSM-parity-tested presentation table (resolves R3-vs-R10 under the "no new FSM functions" boundary).** `isValidActionForCell` is not exported and the scope forbids adding an FSM export. So `deriveButtonConfig` (in `src/lib/runner.ts`) encodes which buttons appear in which slots — a presentation concern. To keep this honest and drift-proof without duplicating the FSM's *computation*, its spec includes a cross-check: for every (type × set-position) cell, the set of actions the table offers must exactly equal the set `applyAction` accepts (probed by dispatching all eight action types and keeping the non-throwing ones), and every offered action must dispatch without throwing. R3's "duplicates none of the FSM rules" holds for advance/target/validity *computation* (always from `nextTarget`/`applyAction`/`undo`); the button *set* is the one unavoidable UI table, and the parity test pins it to the FSM at test time. (Alternative considered: probe `applyAction` via try/catch at runtime to derive the live button set — rejected for using exceptions as control flow and obscuring the stable-slot layout the UI needs anyway.)

- **Reconciliation classification is a pure directive, side effects are thin (R20/R21).** `mapSetLogError(err)` / `mapUndoError(err)` (in `format.ts`) return a discriminated `Reconciliation = { kind: 'rollback' | 'rehydrate' | 'halt'; toast: ErrorToast }`. The container switches on `kind` to do the side effect: `rollback` → nothing (optimistic auto-reverts on throw) + retry toast; `rehydrate` → `router.refresh()` + "synced" toast; `halt` → set a `halted` flag, `router.push('/')`, "completed elsewhere" toast. Classification is unit-tested; the side effects are three lines of glue.

- **Re-hydration on `DuplicateSetLog` uses `router.refresh()` + an explicit `cursorOverride` clear (resolves origin deferred R21).** The happy path needs no explicit refresh — `appendSetLog` already calls `revalidatePath('/session/${id}')`, which re-runs the server component and updates the `sessionState` prop that `useOptimistic` reconciles to. This is the canonical Next.js pattern (confirmed against the v16 docs: `const [optimistic, add] = useOptimistic(serverProp, reducer); formAction = async () => { add(x); await serverAction() }` — the `serverProp` re-bases on revalidation). On `DuplicateSetLog` the action threw *before* its `revalidatePath`, so the client calls `router.refresh()` to re-run the server component, pull the persisted row, and re-base the optimistic `setLogs`. This aligns with ADR-001 (server components + `revalidatePath`, no React Query). **`router.refresh()` preserves client `useState` by design (it merges the new RSC payload "without losing unaffected client-side React"), so it does NOT clear `cursorOverride`** — the `rehydrate` branch must call `setCursorOverride(undefined)` (and `setReviewExerciseIdx(null)`) explicitly, otherwise a stale override pins the card to the jumped exercise after the persisted position should have won.

- **Both the Failed input and the exercises navigation use MUI `Drawer anchor="bottom"` (resolves origin deferred R11/R12).** The origin describes both as bottom sheets; one controlled (non-swipeable) `Drawer` primitive keeps the gym-thumb interaction model consistent and benefits from the existing `scrollbar-gutter` guard. (`Dialog` — used by `RoutineCard` — is an acceptable alternative for the Failed input if the implementer finds the sheet fiddly; the choice does not affect any tested logic.)

- **Action treatments use the existing palette + an icon-key map (resolves origin deferred R7/R9).** `deriveButtonConfig` returns serializable `{ slot, actionType, label, iconKey, treatment, previewWeight? }` where `iconKey` and `treatment` are **literal union types** (e.g. `treatment: 'accent' | 'neutral' | 'amber' | 'red'`) so the `action-presentation.tsx` lookup is exhaustively typed and a key typo fails type-check rather than rendering nothing. The `.tsx` map turns `iconKey` → `@mui/icons-material` component and `treatment` → button styling. **The swole theme defines only `primary: deepOrange` — there is no `neutral`/`amber` MUI palette key**, so `accent`→MUI `color="primary"` and `red`→`color="error"` (both exist), while `neutral`/`amber` render via `!`-prefixed Tailwind classes (`!bg-neutral-…` / `!bg-amber-…`), matching `RoutineCard`'s override pattern — never `color="neutral"` (won't type-check). The R9 preview is the numeric next weight (`previewWeight`) emitted by `deriveButtonConfig`; the button formats it to `→105` via U2's `formatWeightPreview` (so `runner.ts` has no dependency on `format.ts`). Rendered as a subtitle line inside the button (matching the visual sketch's stacked `→105`), not a trailing chip. No new theme tokens.

- **`Finish session →` navigates to `/session/[id]/complete` (resolves origin deferred R23/R24).** A real `href` that may 404 until F3 lands — the cheapest interim that hands off cleanly and matches how home links to not-yet-built routes. (Alternative: an inline disabled placeholder — rejected because a live hand-off lets the F3 brainstorm pick up from a working boundary.)

- **Previous-set peek prints the action label verbatim, single-set cardio omits the set line (resolves origin deferred R6/R5).** Low-stakes editorial calls deferred by the origin; verbatim labels (`Increment`) match the sketch and the FSM vocabulary, and R5 already specifies cardio omits `of N`.

---

## Open Questions

### Resolved During Planning

- **Can `cursorOverride` live in `useOptimistic`?** No — it evaporates without a pending Action (React 19 docs). It is `useState`. (Resolves R4 mechanics.)
- **How does the happy path avoid a re-fetch (R20) while still re-basing optimistic state?** `appendSetLog`/`undoLastSetLog` already `revalidatePath('/session/${id}')`, which re-renders the server component and updates the base state `useOptimistic` reconciles to. No client re-fetch needed.
- **Where does the routine *name* come from for the top bar?** Not from `buildSessionState` (its `routine` is `RoutineWithIds`, name-less). The page calls the existing `getRoutine({ id: session.routineId })` — an existing read, not a new query.
- **All other origin "Deferred to Planning" items** (modal/drawer primitive, color/icon tokens, re-hydration mechanism, Finish target, peek label, cardio phrasing) — resolved in Key Technical Decisions.

### Deferred to Implementation

- **Residual visual smoothing of the jump-then-log transient.** Correctness is settled: the `appendSetLog` args are computed from the jumped position via a direct `applyAction` call (so the persisted row always targets the jumped exercise), and the single-flight guard (`isPending`) blocks a second tap from landing after `cursorOverride` is cleared but before the prior write revalidates — closing the wrong-exercise-on-rapid-tap class entirely. What remains is purely cosmetic: a sub-second optimistic frame where the displayed log briefly attaches to the natural position before the server settles. Whether that frame needs smoothing (and how) is an execution-time observation against AE4/F3 on a real device — the state model and guards are fixed here.
- **Stepper increment for the time-based Failed input** (`±1s` vs `±5s`) and the exact narrow-width layout of the in-button weight preview (subtitle wrap behavior) — visual tuning settled against the first manual test.
- **Whether `undoLastSetLog`'s `UndoBlockedByCommittedProgression` can occur in this scope.** No progression is committed until F3, so it should be unreachable here; `mapUndoError` still classifies it (→ `rollback` with an explanatory toast) defensively rather than assuming it never fires.

---

## Output Structure

    apps/swole/src/
    ├── app/session/[id]/
    │   └── page.tsx                         # U8 — server component, hydrate + guard
    ├── components/session/                  # new feature dir (mirrors components/home/)
    │   ├── SessionRunner.tsx                # U7 — client container: state, dispatch, reconciliation
    │   ├── SessionNotActive.tsx             # U8 — "this session isn't active" + link home
    │   ├── TopBar.tsx                       # U3 — back, name, progress, undo, drawer trigger
    │   ├── CurrentSetCard.tsx               # U4 — exercise/set/target/peek + button grid
    │   ├── ActionButtonGrid.tsx             # U4 — equal grid from deriveButtonConfig
    │   ├── action-presentation.tsx          # U4 — iconKey → MUI icon, treatment → color classes
    │   ├── TerminalCard.tsx                 # U4 — "all sets done" + summary + Finish session →
    │   ├── DegradedStrip.tsx                # U4 — dismissible failedSetLogIds warning
    │   ├── FailedSheet.tsx                  # U5 — bottom Drawer + reps/seconds stepper
    │   ├── ExercisesDrawer.tsx              # U6 — bottom Drawer, exercise list, jump/review
    │   └── ReviewCard.tsx                   # U6 — read-only logged sets + back-to-current
    └── lib/
        ├── runner.ts                        # U1 — reducer + view-model derivations (pure)
        ├── format.ts                        # U2 — extend: runner formatters + error mappers
        └── __tests__/
            ├── runner.spec.ts               # U1 — incl. FSM-parity cross-check
            └── format.spec.ts               # U2 — extend with new cases

*Scope declaration, not a constraint — the implementer may split or merge components if implementation reveals a cleaner layout. The per-unit `Files:` lists remain authoritative.*

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**State ownership in `SessionRunner` (the crux):**

```
server props ──▶ sessionState: SessionState (setLogs only; no cursorOverride — never hydrated)
                       │
            useOptimistic(sessionState, runnerReducer)   ← reducer delegates to applyAction / undo
                       │  (holds optimistic setLogs only; reverts when no Action is pending)
                       ▼
   optimistic.setLogs ─┐
                       ├─▶ effectiveState = { setLogs, cursorOverride: activeOverride }
   useState cursorOverride? ─┘   (activeOverride = cursorOverride unless it points at a
   useState reviewExerciseIdx?    full exercise — see the stale-override guard below)
   useState halted, dismissedDegraded
                       │
                       └──▶ card-area mode (below). cursorOverride/reviewExerciseIdx are
                            useState, so the runner clears them explicitly on log (R15),
                            undo (R17), and rehydrate (R21) — the FSM's own clearing is
                            unreachable once the override lives outside SessionState.
```

**Card-area mode (what fills the center of the screen):**

```
reviewExerciseIdx != null            ─▶ <ReviewCard exerciseIdx=… />        (R14, read-only)
else nextTarget(effectiveState) == null ─▶ <TerminalCard summary=… />      (R23, undo still works → R24)
else                                  ─▶ <CurrentSetCard target=… buttons=… peek=… />  (R5–R10)
```

**Dispatch + reconciliation for a logged set (F1/F2, R20/R21):**

```
const [isPending, startTransition] = useTransition()           # single-flight: disables inputs while a write is in flight

onAction(action):                         # action ∈ {Increment,Stay,Decrement,Complete,Hold,Done,Skipped,Failed{…}}
  if (isPending || halted) return                              # single-flight guard (R20/R21)
  next   = applyAction(effectiveState, action, routine)        # FSM computes the new SetLog (jumped pos respected)
  newLog = last(next.setLogs)
  args   = toSetLogArgs(newLog, sessionId, routine)
  startTransition(async () => {
    setCursorOverride(undefined)                               # R15 — logging clears the jump
    addOptimistic({ kind: 'action', action })                 # UI advances now
    try { await appendSetLog(args) }                           # revalidatePath re-bases on success (R20)
    catch (err) {
      switch (mapSetLogError(err).kind) {
        case 'rollback':  showToast(…'error')                  # optimistic auto-reverts on throw
        case 'rehydrate': setCursorOverride(undefined); router.refresh(); showToast(…'info')  # DuplicateSetLog — refresh keeps useState, so clear override explicitly (R21)
        case 'halt':      setHalted(true); router.push('/'); showToast(…'warning')  # SessionAlreadyCompleted (R21/AE7)
      }
    }
  })

onJump(idx):    setCursorOverride(idx); closeDrawer()          # no server write — pure useState (F3/R13)
onReview(idx):  setReviewExerciseIdx(idx); closeDrawer()       # finished exercise, read-only (R14)
onBack():       setReviewExerciseIdx(null)                     # back to natural position (R14)
onUndo():       if (isPending || halted) return; startTransition(async () => { setCursorOverride(undefined); addOptimistic({kind:'undo'}); try { await undoLastSetLog({sessionId}) } catch (err) { mapUndoError… } })  # R17 — clears override so the position steps back across boundaries
onExit():       router.push('/')                               # R18, no confirm
onFinish():     router.push(`/session/${sessionId}/complete`)  # R24
```

Card-area mode switch guards the stale-override case (a `cursorOverride` whose logged count ≥ that exercise's `sets` is treated as no actionable set — fall through to natural position / terminal — because `nextTarget` does not range-check `setIdx`):

```
activeOverride = (cursorOverride != null && countLogsForExercise(setLogs, cursorOverride) < routine.exercises[cursorOverride].sets) ? cursorOverride : undefined
effectiveState = { setLogs: optimistic.setLogs, cursorOverride: activeOverride }
```

The reducer is the entire FSM bridge:

```
type RunnerMsg = { kind: 'action'; action: Action } | { kind: 'undo' }
runnerReducer(state, msg, routine) =
  msg.kind === 'undo' ? undo(state) : applyAction(state, msg.action, routine)
```

---

## Implementation Units

### Phase 1 — Pure foundations (tested)

- U1. **Runner view-model + optimistic reducer (`src/lib/runner.ts`)**

**Goal:** One pure module holding the `useOptimistic` reducer and every read-model derivation the components need, so all decision logic is unit-tested and the `.tsx` tree stays dumb.

**Requirements:** R3, R5, R6, R7, R8, R9, R10, R12, R16, R23.

**Dependencies:** None (pure, over the existing FSM exports).

**Files:**
- Create: `apps/swole/src/lib/runner.ts`
- Test: `apps/swole/src/lib/__tests__/runner.spec.ts`

**Approach:**
- `type RunnerMsg` and `runnerReducer(state, msg, routine)` delegating to `applyAction` / `undo` (no rules duplicated).
- `deriveButtonConfig(exercise, isLastSet, target)` → ordered slot list `{ slot: 1|2|3|4, actionType, label, iconKey, treatment, previewWeight? }` per the R7/R8 table below, with `iconKey`/`treatment` as literal union types. `previewWeight` (R9) is a **number** (`target.weight ± exercise.increment` / `target.weight`) emitted only for weighted mid-sets; U4 formats it to `→105` via U2's `formatWeightPreview`, so `runner.ts` has no dependency on `format.ts`. `isLastSet` is `setIdx === sets - 1` (so a single-set weighted exercise is "last", selecting the `Complete/Stay/Decrement/Failed` row).
- `deriveProgress(effectiveState, routine)` → `{ activeExerciseIdx, exerciseCount, loggedSets, totalSets }` (R16); handles the terminal case (`nextTarget` null → all-done).
- `deriveExerciseList(effectiveState, routine)` → per-exercise `{ idx, name, type, loggedCount, sets, status: 'done'|'in-progress'|'unstarted', isCurrent }` (R12).
- `derivePreviousSetPeek(effectiveState, routine, activeExerciseIdx)` → `{ kind: 'log', …last set fields, action } | { kind: 'start', startingWeight } | { kind: 'none' }` (R6).
- `deriveSessionSummary(effectiveState, routine)` → `{ exerciseCount, totalSetsLogged }` (R23).
- Active-position-dependent values (`activeExerciseIdx`, the current target, the peek's anchor) come *through* the FSM (`nextTarget`), not a re-derivation. The per-exercise `loggedCount` in `deriveExerciseList`/`deriveProgress` is a direct count of `setLogs` by `exerciseIdx` — a read-model derivation over append-only data, not an FSM *rule* (the scope forbids new FSM exports, so this counting loop lives here deliberately and is pinned by an explicit test, not by re-using the FSM's private `countLogsForExercise`).

**R7/R8 button table (the presentation matrix this unit encodes):**

| Exercise type | Set position | Slot 1 (advance) | Slot 2 | Slot 3 | Slot 4 (exit) |
|---|---|---|---|---|---|
| weighted | mid (not last) | `Increment` · accent · ▲ · `→{w+inc}` | `Stay` · neutral · = · `→{w}` | `Decrement` · amber · ▼ · `→{w−inc}` | `Failed` · red · ✕ |
| weighted | last | `Complete` · accent · ✓ | `Stay` · neutral · = | `Decrement` · amber · ▼ | `Failed` · red · ✕ |
| bodyweight | any | `Complete` · accent · ✓ | — | — | `Failed` · red · ✕ |
| time-based | any | `Hold` · neutral | — | — | `Failed` · red · ✕ |
| cardio | single | `Done` · accent | — | — | `Skipped` · neutral |

**Patterns to follow:** `apps/swole/src/lib/format.ts` (pure, exhaustive `switch` over `Exercise['type']`, no directive); `apps/swole/src/core/session-machine.ts` for the FSM call signatures.

**Test scenarios:**
- *Happy path (reducer):* `runnerReducer(state, { kind: 'action', action: { type: 'Complete' } }, routine)` equals `applyAction(state, …)`; `{ kind: 'undo' }` equals `undo(state)`.
- *Happy path (deriveButtonConfig):* **Covers AE1.** weighted mid, target `{weight:100,reps:10}`, `increment:5` → slots `[Increment(accent,▲,→105), Stay(neutral,=,→100), Decrement(amber,▼,→95), Failed(red,✕)]`.
- *Happy path (deriveButtonConfig):* **Covers AE2.** weighted last → `[Complete(accent,✓), Stay, Decrement, Failed]`, no `preview` on any slot.
- *Happy path (deriveButtonConfig):* bodyweight → slot1 `Complete`, slot4 `Failed`, slots 2/3 absent, no previews; time-based → slot1 `Hold`(neutral), slot4 `Failed`; cardio → slot1 `Done`(accent), slot4 `Skipped`(neutral).
- *Integration / FSM parity (the drift guard):* for every (type × set-position) cell — **including a single-set weighted exercise (`sets:1`), which must resolve to the `last` row** (`Complete/Stay/Decrement/Failed`), pinning `isLastSet = setIdx === sets - 1` at the boundary — build a state at that position and assert `deriveButtonConfig`'s offered `actionType` set **exactly equals** the set of action types `applyAction(state, {type}, routine)` accepts without throwing (probe all eight; for `Failed` use `{actualReps:0}` / `{actualDuration:0}`). Asserts both no-extra (never offer a rejected action — R10) and no-missing.
- *Happy path (deriveProgress):* mid-session 4 logs over a 3-exercise / 9-set routine → `{ activeExerciseIdx, exerciseCount:3, loggedSets:4, totalSets:9 }`; jumped (`cursorOverride:2`) → `activeExerciseIdx:2`; terminal (all 9 logged) → all-done shape.
- *Edge (override-on-full guard):* a `cursorOverride` pointing at a fully-logged exercise (`loggedCount === sets`) must NOT produce a current-set view with `setIdx === sets` — `deriveProgress`/the effective-state guard treats it as no actionable set (falls through to natural position or terminal). Guards the phantom "Set N+1 of N" target `nextTarget` would otherwise return (it does not range-check `setIdx`).
- *Happy path (deriveExerciseList):* **Covers AE4.** after Bench (3/3) logged with cursor on Pushups → Bench `status:'done', isCurrent:false`, Pushups `status:'in-progress'|'unstarted', isCurrent:true`, Plank `status:'unstarted'`.
- *Edge (deriveExerciseList counts):* a multi-exercise session with a known per-exercise log distribution (e.g. Bench 3, Pushups 1, Plank 0) → each row's `loggedCount` and `status` match exactly — pins the runner's own counting loop (the deliberate read-model duplication noted in Approach).
- *Edge (derivePreviousSetPeek):* first set weighted → `{ kind:'start', startingWeight }`; first set bodyweight/time-based/cardio → `{ kind:'none' }`; after a log → `{ kind:'log', … }` reflecting the **last** log for that exercise (incl. a `Failed` set's `actualReps`).
- *Happy path (deriveSessionSummary):* **Covers AE6.** fully-logged 3-exercise / 9-set session → `{ exerciseCount:3, totalSetsLogged:9 }`.
- *Edge (deriveProgress / undo):* **Covers AE5.** after a `Complete` advances Bench→Pushups, undo restores `loggedSets` and `activeExerciseIdx` back to Bench's last set (verifies the derivations track `undo`'s state).

**Verification:** `pnpm --filter @lilnas/swole test` covers the new spec; the FSM-parity test fails if the button table and `applyAction` ever disagree.

---

- U2. **Runner formatters + reconciliation mappers (`src/lib/format.ts`)**

**Goal:** Extend the existing pure formatter module with the runner's target/preview/peek strings and the R21 error-classification directives — keeping the `mapStartSessionError` family together and unit-tested.

**Requirements:** R5, R6, R9, R21.

**Dependencies:** None.

**Files:**
- Modify: `apps/swole/src/lib/format.ts`
- Modify (extend): `apps/swole/src/lib/__tests__/format.spec.ts`

**Approach:**
- `formatRunnerTarget(exercise, target)` — the big card target: weighted `{w} lb × {reps}`, bodyweight `{reps} reps`, time-based `formatTimeBasedDuration`, cardio `formatCardioDuration`. (Sibling to `formatBannerSubtitle`; reuses the existing duration helpers.)
- `formatWeightPreview(nextWeight)` → `→{nextWeight}` — formats the numeric `previewWeight` that U1's `deriveButtonConfig` already computed (the arithmetic lives in U1; U2 only stringifies, so there is no duplicated `± increment` logic and no U1→U2 dependency).
- `formatPreviousSetPeek(peek, exercise)` → string for U1's structured peek (`105 lb × 10 · Increment`, `starting weight 100 lb`, or `''` for `none`).
- `type Reconciliation = { kind: 'rollback' | 'rehydrate' | 'halt'; toast: ErrorToast }`.
- `mapSetLogError(err)` → `DuplicateSetLog` ⇒ `rehydrate` + "Synced with your other tab." (info-leaning warning); `SessionAlreadyCompleted` ⇒ `halt` + "This session was completed elsewhere."; else ⇒ `rollback` + "Couldn't save that set. Try again." Mirrors `mapStartSessionError`'s `instanceof` structure.
- `mapUndoError(err)` → `UndoBlockedBySessionCompleted` ⇒ `halt`; `UndoBlockedByCommittedProgression` ⇒ `rollback` (defensive); else ⇒ `rollback`.

**Patterns to follow:** `mapStartSessionError` / `ErrorToast` in `apps/swole/src/lib/format.ts`; the per-type `switch` in `formatBannerSubtitle`.

**Test scenarios:**
- *Happy path:* `formatRunnerTarget` for each of the four exercise types (incl. single-set cardio); `formatWeightPreview(105)` → `→105`, `formatWeightPreview(95)` → `→95` (the `±increment` arithmetic is U1's; tested there).
- *Happy path / edge:* `formatPreviousSetPeek` for `start`, `log` (weighted + a `Failed` bodyweight + a time-based `Hold`), and `none` (→ empty string).
- *Error path:* **Covers AE7.** `mapSetLogError(new SessionAlreadyCompleted(1))` → `{ kind:'halt', toast.severity:'warning' }`.
- *Error path:* `mapSetLogError(new DuplicateSetLog(existingRow))` → `{ kind:'rehydrate' }`; `mapSetLogError(new Error('boom'))` → `{ kind:'rollback', toast.severity:'error' }`.
- *Error path:* `mapUndoError(new UndoBlockedBySessionCompleted(1))` → `halt`; generic → `rollback`.

**Verification:** new `format.spec.ts` cases pass; existing cases unchanged.

---

### Phase 2 — Presentational surfaces (untested client glue)

- U3. **Top bar (`src/components/session/TopBar.tsx`)**

**Goal:** The persistent top chrome (R16) with progress, undo (R17), exit (R18), and the drawer trigger.

**Requirements:** R16, R17, R18.

**Dependencies:** U1 (consumes `deriveProgress`'s shape).

**Files:**
- Create: `apps/swole/src/components/session/TopBar.tsx`

**Approach:** `'use client'` presentational component. Props: `{ routineName, progress: { activeExerciseIdx, exerciseCount, loggedSets, totalSets }, canUndo, onUndo, onOpenDrawer, onExit }` (the `progress` object is `deriveProgress`'s exact return shape — passed whole, not unpacked, to keep the prop contract aligned with U1). `←` and drawer trigger as MUI `IconButton`s; `Exercise {activeExerciseIdx + 1}/{exerciseCount}` text + a thin Tailwind progress bar (`loggedSets / totalSets` width). Undo `IconButton` `disabled={!canUndo}` (container sets `canUndo = loggedSets > 0 && !isPending` so a pending write also disables undo — single-flight per the state-model decision). Exit calls `onExit`.

**Patterns to follow:** `RoutineCard`'s `IconButton` + `!`-prefixed Tailwind overrides; `ResumeBanner`'s orange-accent bar for the progress fill.

**Test scenarios:** Test expectation: none — untested client glue (no jsdom/RTL harness; `apps/swole/jest.config.js` is node env). Progress math is covered by U1's `deriveProgress` spec; behavior verified in the manual walkthrough (Success Criteria).

**Verification:** renders in the running app; progress bar advances on each logged set and retreats on undo with no server round-trip.

---

- U4. **Card-area surfaces: current-set card, button grid, terminal, degraded strip (`src/components/session/{CurrentSetCard,ActionButtonGrid,action-presentation,TerminalCard,DegradedStrip}.tsx`)**

**Goal:** Everything that fills the center of the screen across the three non-review modes (R5–R10, R22, R23/R24).

**Requirements:** R5, R6, R7, R8, R9, R10, R22, R23, R24.

**Dependencies:** U1 (button config, peek, summary), U2 (target/preview/peek strings).

**Files:**
- Create: `apps/swole/src/components/session/CurrentSetCard.tsx`
- Create: `apps/swole/src/components/session/ActionButtonGrid.tsx`
- Create: `apps/swole/src/components/session/action-presentation.tsx`
- Create: `apps/swole/src/components/session/TerminalCard.tsx`
- Create: `apps/swole/src/components/session/DegradedStrip.tsx`

**Approach:**
- `CurrentSetCard` — props `{ exercise, target, peek, buttons, isPending, onAction }`; renders name, `Set {setIdx+1} of {sets}` (omitted for single-set cardio per R5), the big target (`formatRunnerTarget`), the quiet peek line (`formatPreviousSetPeek`), and `<ActionButtonGrid>`.
- `ActionButtonGrid` — equal 2×2 Tailwind grid (`grid grid-cols-2 gap-3`); each slot from `deriveButtonConfig`. Action buttons are `size="large"` (gym tap target; `!min-h-…` if needed — Tailwind utilities, no new tokens) and `disabled={isPending}` so a pending write blocks a double-tap (D1/single-flight). Empty slots (2/3 for two-button types) render an **invisible, `aria-hidden`, non-interactive spacer `div`** — purely structural, so slots 1 and 4 stay anchored (R8) without implying a tappable affordance. `Failed` slot opens the Failed sheet (no immediate dispatch); others dispatch directly via `onAction`.
- `action-presentation` — maps `iconKey` → `@mui/icons-material` component (e.g. `KeyboardArrowUp`/`Remove`/`KeyboardArrowDown`/`Close`/`Check`/`HourglassEmpty`/`DirectionsRun`/`SkipNext`) and the literal-union `treatment` → button styling: `accent`→`color="primary"`, `red`→`color="error"` (both exist in the theme), `neutral`/`amber`→`!`-prefixed Tailwind classes (`!bg-neutral-…` / `!bg-amber-…`) — **never `color="neutral"`/`color="amber"`** (not in the theme palette; would not type-check). Keeps JSX/icon imports out of the pure `runner.ts`.
- `TerminalCard` — props `{ summary, onFinish }`; "all sets done" headline, `{exerciseCount} exercises · {totalSetsLogged} sets`, primary `Finish session →` button calling `onFinish` (container navigates to `/session/[id]/complete`).
- `DegradedStrip` — props `{ onDismiss }`; a dismissible warning **strip with a close `IconButton`** (not the `ResumeBanner`'s static italic line — borrow its orange/warning palette only). The container renders it **directly under the `TopBar`, above the card area**, so it doesn't shift the card on dismiss; dismissal is session-scoped (`dismissedDegraded` state, no persistence).

**Patterns to follow:** `ResumeBanner` (card/gradient/orange accent, `!`-prefixed Typography); `RoutineCard` (`cns()` for conditional button classes, MUI `Button` styling); the visual sketch in the origin doc.

**Test scenarios:** Test expectation: none — untested client glue. The button set, slots, treatments, and previews it renders are fully covered by U1's `deriveButtonConfig` spec (incl. AE1/AE2 and the FSM-parity guard) and U2's formatter specs; visual fidelity verified in the manual walkthrough.

**Verification:** weighted mid shows four buttons with `→weight` previews; last set swaps `Complete` into slot 1 and drops previews; two-button types keep slots 1/4 anchored; terminal shows the summary and `Finish session →`; degraded strip appears only when `failedSetLogIds` is non-empty and dismisses.

---

- U5. **Failed input sheet (`src/components/session/FailedSheet.tsx`)**

**Goal:** The bottom-sheet reps/seconds input behind the `Failed` button (R11).

**Requirements:** R11.

**Dependencies:** None (presentational; container wires it).

**Files:**
- Create: `apps/swole/src/components/session/FailedSheet.tsx`

**Approach:** `'use client'` MUI `Drawer anchor="bottom"`. Props `{ open, mode: 'reps' | 'seconds', defaultValue, isPending, onConfirm, onCancel }`. Title "How many reps did you get?" / "How long did you hold?" by `mode`. A stepper (`−` / `+` `IconButton`s sized `!min-h-[44px] !min-w-[44px]` for the gym tap target, plus a numeric `TextField` for tap-to-type). **The value resets to `defaultValue` every time `open` transitions false→true** (a `useEffect` keyed on `open`), so a cancel-then-reopen starts fresh rather than retaining a stale entry. **Minimum value: `1` for reps** (0 reps is a skip, not a failed attempt) and **`0` for seconds** (a 0-second hold is a valid full failure). On open, focus lands on the stepper increment control. Confirm (`disabled={isPending}`) calls `onConfirm(value)`; Cancel/backdrop calls `onCancel` and logs nothing. The container converts the value into `Failed{actualReps}` / `Failed{actualDuration}` and dispatches via the normal log path.

**Patterns to follow:** `RoutineCard`'s `Dialog`/`DialogActions` button pairing and `useState`-driven open/close; theme's bottom-anchored surfaces (the `scrollbar-gutter` guard already prevents viewport shift).

**Test scenarios:** Test expectation: none — untested client glue. The dispatch it produces (`Failed{actualReps}` / `Failed{actualDuration}`) flows through U1's reducer and U2's formatters, which are tested; AE3's default-and-confirm behavior is verified in the manual walkthrough.

**Verification:** **Covers AE3 (manually).** For Pushups (bodyweight, target 15), `Failed` opens the sheet defaulted to 15; entering 12 and confirming logs `actualReps=12` and advances; Cancel logs nothing.

---

- U6. **Exercises drawer + read-only review (`src/components/session/{ExercisesDrawer,ReviewCard}.tsx`)**

**Goal:** The navigation drawer (R12/R13), the jump-vs-review routing, and the read-only review of a finished exercise (R14/R15).

**Requirements:** R12, R13, R14, R15.

**Dependencies:** U1 (`deriveExerciseList`; review reads the exercise's logged sets), U2 (formatting the reviewed set rows).

**Files:**
- Create: `apps/swole/src/components/session/ExercisesDrawer.tsx`
- Create: `apps/swole/src/components/session/ReviewCard.tsx`

**Approach:**
- `ExercisesDrawer` — `'use client'` MUI `Drawer anchor="bottom"`. Props `{ open, exercises, onJump, onReview, onClose }`. The sheet is **height-capped (`max-h-[70vh]`) with an internally scrollable list** so a long routine never covers the whole viewport; the current/`isCurrent` row scrolls into view on open (`scrollIntoView` on the highlighted row) so the user always sees where they are. Each row shows name, type, progress (`2/3` / `✓` / `○`), current highlighted. Row tap: `status==='done'` → `onReview(idx)`; current → `onClose`; otherwise → `onJump(idx)`.
- `ReviewCard` — props `{ exercise, loggedSets, onBack }`; renders each logged set (weight/reps/duration + action via U2 formatters), no action buttons, a `← Back to current set` control calling `onBack`. The container renders this in the card area when `reviewExerciseIdx != null` and supplies that exercise's logs filtered from the effective state.

**Patterns to follow:** `RoutineCard`'s `Menu`/`MenuItem` list semantics adapted to a `Drawer`; `cns()` for the current-row highlight; `ResumeBanner` for the read-only card chrome.

**Test scenarios:** Test expectation: none — untested client glue. The per-exercise status/progress it renders is covered by U1's `deriveExerciseList` spec (incl. AE4); jump-vs-review routing and the read-only constraint are verified in the manual walkthrough.

**Verification:** **Covers AE4 (manually).** After `Complete` on Bench's last set the runner shows Pushups set 1 (auto-advance, not a Bench review); opening the drawer and tapping the `3/3 ✓` Bench row shows its three logged sets read-only with `← Back to current set`; tapping an unfinished exercise jumps there and closes the drawer.

---

### Phase 3 — Integration

- U7. **`SessionRunner` container (`src/components/session/SessionRunner.tsx`)**

**Goal:** Own all state (optimistic `setLogs` + `useState` `cursorOverride`/`reviewExerciseIdx`/`halted`/`dismissedDegraded`), dispatch every action, run R21 reconciliation, and switch the card-area mode — wiring U3–U6 together.

**Requirements:** R1, R3, R4, R20, R21, R24 (and orchestrates R5–R18, R22, R23).

**Dependencies:** U1, U2, U3, U4, U5, U6, and the existing `useToast()` hook (`src/hooks/use-toast.ts`) + `useRouter`.

**Files:**
- Create: `apps/swole/src/components/session/SessionRunner.tsx`

**Approach:** `'use client'`. Props `{ session, routine, routineName, sessionState, failedSetLogIds }`.
- `const [optimistic, addOptimistic] = useOptimistic(sessionState, (s, msg) => runnerReducer(s, msg, routine))`; `const [isPending, startTransition] = useTransition()`.
- `const [cursorOverride, setCursorOverride] = useState<number>()`, `reviewExerciseIdx`, `halted`, `dismissedDegraded`.
- **Effective state guards the stale override** (per the state-model decision): `const activeOverride = cursorOverride != null && countLogs(optimistic.setLogs, cursorOverride) < routine.exercises[cursorOverride].sets ? cursorOverride : undefined`; `const effectiveState = { setLogs: optimistic.setLogs, cursorOverride: activeOverride }`.
- Handlers per the High-Level Technical Design. **`onAction` and `onUndo` early-return when `isPending || halted` (single-flight).** `onAction`: compute args via `applyAction(effectiveState, …)` + `toSetLogArgs`, then `startTransition(() => { setCursorOverride(undefined); addOptimistic(...); await appendSetLog; reconcile via mapSetLogError })`. **`onUndo` clears `cursorOverride` too** (so the position steps back across boundaries per R17, rather than staying pinned to a jump). The `rehydrate` reconciliation branch calls `setCursorOverride(undefined)` + `setReviewExerciseIdx(null)` before `router.refresh()` (refresh preserves client state). All async work inside `startTransition`; all errors via `useToast`. `halted` disables input and is terminal for the screen (navigation home follows).
- Card-area mode switch (`review` → `terminal` → `current`) chooses among `ReviewCard` / `TerminalCard` / `CurrentSetCard`, driven by `reviewExerciseIdx` then `nextTarget(effectiveState, routine)`. `isPending` threads into `CurrentSetCard`/`FailedSheet` to disable inputs; `canUndo = optimistic.setLogs.length > 0 && !isPending` into `TopBar`. `DegradedStrip` shown when `failedSetLogIds.length > 0 && !dismissedDegraded`.

**Execution note:** Verify the four interaction-state behaviors that the pure specs cannot prove end-to-end: (1) jump → log persists to the jumped exercise (F3); (2) undo while jumped steps the visible position back, not pinned to the jump (R17); (3) rapid double-tap is absorbed by `isPending` (one row written); (4) `DuplicateSetLog` re-hydrate lands on the persisted position with the override cleared (R21).

**Patterns to follow:** `apps/yoink/src/app/(library)/admin/admin-content.tsx` (`useOptimistic` + `useTransition` + `startTransition(async …)`); `RoutineCard` (`useCallback` with exhaustive deps, `try/catch` → `showToast`, `useRouter`).

**Test scenarios:** Test expectation: none — untested client glue. The reducer (U1), the reconciliation classification (U2 `mapSetLogError`/`mapUndoError`), and all derivations are unit-tested; the container's orchestration is verified by the full PRD F2 walkthrough and the AE1–AE7 checks (Success Criteria). The optimistic rollback / re-hydrate / halt *behaviors* are exercised manually (induce a duplicate via two tabs for `rehydrate`; complete in one tab then act in the other for `halt` per AE7).

**Verification:** the full Push Day walkthrough runs end-to-end with correct targets, previews, and progress at each step, reaches `Finish session →`, survives leave-and-resume, and each of the three R21 error modes behaves as specified.

---

- U8. **Server route page + not-active state (`src/app/session/[id]/page.tsx`, `src/components/session/SessionNotActive.tsx`)**

**Goal:** The server entry point that hydrates and mounts the runner, plus the non-throwing not-active fallback (R1/R2).

**Requirements:** R1, R2.

**Dependencies:** U7.

**Files:**
- Create: `apps/swole/src/app/session/[id]/page.tsx`
- Create: `apps/swole/src/components/session/SessionNotActive.tsx`

**Approach:** `export const dynamic = 'force-dynamic'`. `async` server component; `const { id } = await params` (Next 16 async params), `const sessionId = Number(id)`; guard non-integer → `<SessionNotActive>`. `const hydrated = await buildSessionState({ sessionId })`; `null` → `<SessionNotActive>` (R2). Else `const routineRow = await getRoutine({ id: hydrated.session.routineId })` for the name, then render `<SessionRunner session={hydrated.session} routine={hydrated.routine} routineName={routineRow?.name ?? '…'} sessionState={hydrated.sessionState} failedSetLogIds={hydrated.failedSetLogIds} />`. `SessionNotActive` is a server component: a short headline + one-line body + `<Button href="/">` back home (mirrors `ResumeBanner`'s link form and `EmptyState`'s centered chrome). `buildSessionState` returns `null` for both a completed session and an unknown id and the two are not distinguishable from its return alone — use one neutral copy that covers both ("This session isn't active — it may be finished or no longer exist."), rather than asserting which case occurred.

**Patterns to follow:** `apps/swole/src/app/page.tsx` (`force-dynamic`, `buildSessionState` + `getRoutine`, `null` guards, plain props to client components); `EmptyState` for the fallback chrome.

**Test scenarios:** Test expectation: none — untested server glue over already-tested reads (`buildSessionState`, `getRoutine` have db specs). Verified manually: a valid active id renders the runner; an unknown or completed id renders "this session isn't active" with a working home link (no throw).

**Verification:** navigating to `/session/<active-id>` renders the runner at the correct active set; `/session/<completed-or-unknown-id>` renders the not-active state and links home; resuming from the home banner lands on the exact set with no data loss.

---

## System-Wide Impact

- **Interaction graph:** The runner is a new leaf route; it consumes existing FSM functions, `buildSessionState`, `getRoutine`, `appendSetLog`, `undoLastSetLog` without modifying them. The only shared file *edited* is `apps/swole/src/lib/format.ts` (additive — new exports), consumed by home; no existing export changes signature.
- **Error propagation:** Server actions throw tagged `DataLayerError`s; the container catches and routes them through `mapSetLogError`/`mapUndoError` into three deterministic UI outcomes. No error is swallowed (honoring the BEGIN-IMMEDIATE convention).
- **State lifecycle risks:** `useOptimistic` reverts to base when no Action is pending — the plan keeps `cursorOverride`/review in `useState` to avoid silent snap-back, which in turn obligates the runner to clear those `useState` values explicitly on log/undo/rehydrate (the FSM's own override-clearing is unreachable once the override lives outside `SessionState`). The card-area guard rejects an override pointing at a full exercise (`nextTarget` does not range-check `setIdx`). Single-flight (`isPending`) prevents a second tap from racing a pending write. The jump-then-log optimistic frame is cosmetic (persisted row always correct).
- **API surface parity:** No other interface presents these set actions; the FSM-parity test is the parity guard between the button table and `applyAction`.
- **Integration coverage:** The cross-layer behaviors (optimistic advance → `revalidatePath` re-base; `DuplicateSetLog` → `router.refresh`; `SessionAlreadyCompleted` → halt+home) are not provable by the pure unit tests and are explicitly assigned to the manual walkthrough + AE7.
- **Unchanged invariants:** The Survivor 1–3 + home suites must still pass unchanged; the FSM, data layer, and server actions are imported, never modified.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Putting `cursorOverride` in `useOptimistic` (it would evaporate, breaking jumps) | Explicit decision + High-Level design model both pin it to `useState`; called out as the central risk. |
| `cursorOverride` in `useState` desyncs from the optimistic `setLogs` (undo doesn't step back, refresh doesn't clear it, override lands on a full exercise → phantom card) | Explicit clearing discipline (log/undo/rehydrate) + the stale-override guard in `effectiveState`; `router.refresh()` preserves `useState`, so the rehydrate branch clears it manually; U1 tests pin the guard. |
| Rapid double-tap races a pending write (wrong exercise after a jump / duplicate dispatch) | Single-flight: `isPending` from `useTransition` disables action inputs while a write is in flight (U4/U5/U7). |
| Button table drifting from the FSM's permitted actions (R10 violation) | FSM-parity cross-check test (U1) fails on any divergence — incl. the single-set weighted cell; `applyAction`'s throw is the runtime backstop. |
| No `.tsx` test harness → component regressions slip through | All decision logic pushed into U1/U2 pure specs (incl. derivations, reconciliation, the override guard); components kept thin; manual PRD walkthrough + the four U7 interaction-state checks are the acceptance gate. |
| `Finish session →` 404s until F3 lands | Accepted interim, consistent with home's not-yet-built links; documented in scope. |
| Next 16 async `params` mis-parsed (e.g., `NaN` id) | Page guards non-integer ids → not-active state. |

---

## Documentation / Operational Notes

- No runbook or deploy change — the runner is a new route inside the existing `apps/swole` container; no new env vars, dependencies, or storage.
- Post-merge: capture the `useOptimistic` + reconciliation pattern and the client-only `cursorOverride` model via `/ce-compound` (both were undocumented open questions; the learnings researcher flagged them as prime candidates).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-28-swole-active-session-requirements.md](docs/brainstorms/2026-05-28-swole-active-session-requirements.md)
- FSM: `apps/swole/src/core/session-machine.ts` · Hydration: `apps/swole/src/db/hydration.ts` · Mappers: `apps/swole/src/db/mappers.ts` · Actions: `apps/swole/src/actions/setLogs.ts` · Errors: `apps/swole/src/db/errors.ts` · Formatters: `apps/swole/src/lib/format.ts`
- Patterns: `apps/swole/src/app/page.tsx`, `apps/swole/src/components/home/{ResumeBanner,RoutineCard}.tsx`, `apps/yoink/src/app/(library)/admin/admin-content.tsx`
- ADR: `apps/swole/docs/adr/001-data-flow.md`
- Learnings: `docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`, `docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`
- External: React 19 `useOptimistic` docs (Context7 `/reactjs/react.dev`)
