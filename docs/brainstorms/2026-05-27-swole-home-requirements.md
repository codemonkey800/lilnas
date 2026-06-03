---
date: 2026-05-27
topic: swole-home
---

# Swole — Home Page

## Problem Frame

The infra scaffold, the session FSM, and the data layer all exist, but
`apps/swole/src/app/page.tsx` is still the placeholder shipped with the
scaffold ("workout tracker — coming soon"). Every PRD flow starts from
home (F1 "From home, tap 'New Routine'", F2 "From home, pick any routine"),
yet no brainstorm has scoped what home actually contains, how it surfaces an
in-progress session, or how it behaves on a fresh deploy with zero routines.

This brainstorm fixes that. The output is a content-complete launchpad that
covers the two primary entry points (create a routine, start a session),
catches a session in progress before the user accidentally starts a second
one or walks away from unfinished work, and provides a lightweight memory
signal once history exists — without becoming a dashboard. It is the first
piece of Survivor 4 (the UI tier on top of the data layer) and should ship
before the routine builder, runner, or stats pages so each of those has a
known entry point to navigate back to.

The home page does not need to invent product behavior — every flow it
launches into (routine creation, the runner, per-routine stats) is already
defined in the PRD. Home's job is to expose those flows clearly, route to
them, and stay out of the way.

---

## Key Flows

- F1. **Launch a session from home**
  - **Trigger:** User opens `/` with at least one non-archived routine and no active session.
  - **Steps:** Page renders the routines list. User scans the cards, picks one whose card's days line includes today (subtly highlighted), and taps `Start session`. The page calls the existing `startSession({ routineId })` server action and routes to `/session/[id]`.
  - **Outcome:** A new `sessions` row exists; the user is in the runner.
  - **Covered by:** R6, R7, R9, R10.

- F2. **Resume an in-progress session from home**
  - **Trigger:** User opens `/` with at least one session where `completed_at IS NULL`.
  - **Steps:** The resume banner renders above the routines list with the routine name, current exercise + set position, and the next set's target. User taps `Resume →` and is routed to `/session/[id]` for that session.
  - **Outcome:** User is back in the runner at the exact set they left off on; no set logs are lost.
  - **Covered by:** R11, R12, R13, R14.

- F3. **First-deploy empty state**
  - **Trigger:** User opens `/` with zero non-archived routines and no active session.
  - **Steps:** Page renders only the centered empty state — short headline, one-line hint, single primary button `Create your first routine`. User taps it and is routed to the routine-builder page (not in scope here).
  - **Outcome:** User is in the routine builder; home will repopulate with the new routine when they return.
  - **Covered by:** R22, R23.

---

## Requirements

**Page composition and layout**

- R1. The home page implementation lives at `apps/swole/src/app/page.tsx`, replacing the existing placeholder. Layout (nav + page chrome) in `apps/swole/src/app/layout.tsx` is reused as-is; this PR does not touch layout chrome.
- R2. The page renders up to three regions, top-to-bottom: (1) resume banner (conditional on an active session), (2) routines list with a "+ New Routine" affordance (or page-level empty state when no routines exist), (3) recent sessions strip (conditional on at least one completed session).
- R3. The page is a Next.js server component. All reads use the existing query functions in `apps/swole/src/db/{routines,sessions}.ts`; no inline Drizzle queries in the page module. Mutations go through the existing server actions in `apps/swole/src/actions/`. ADR-001 path; no React Query, no client-only data fetching.
- R4. Mobile-first layout. Single-column on phone widths; tap targets sized so the primary actions (`Start session`, `Resume →`, `+ New Routine`, overflow menu `⋯`) are reachable with a thumb without zooming. The existing dark theme (black background, orange accent) from `apps/swole/src/app/layout.tsx` is reused; no new theme tokens introduced.

**Routine cards**

- R5. Each non-archived routine renders as one card. Archived routines are not shown on home. Restoring an archived routine is a future routine-builder concern, not a home-page concern.
- R6. Each routine card surfaces the following content:
  - Routine name
  - Days assigned, e.g. `Mon · Wed · Fri` (three-letter abbreviations, separated by a center dot)
  - Number of exercises in the routine
  - "Next up" line — the literal first exercise of the routine, formatted by its type:
    - **weighted:** `[Name] · [sets]×[target_reps] @ [starting_weight] lb`
    - **bodyweight:** `[Name] · [sets]×[target_reps]`
    - **time-based:** `[Name] · [sets]×[duration]`
    - **cardio:** `[Name] · [duration]`
  - Primary action: `Start session`
  - Secondary actions (Edit, Archive) accessible via an overflow menu (`⋯`). `Edit` navigates to `/routines/[id]`; `Archive` calls the existing `archiveRoutine` server action with a confirmation prompt.
- R7. Today's day-of-week is visually emphasized in the days line (bold or accent-colored) for cards whose `days` array includes the current day. Routine list order remains alphabetical regardless of today.
- R8. The weight displayed on a weighted "next up" line is read from `exercises.starting_weight` directly — the column ADR-001 / Survivor 3 (R19) designates as the current canonical starting weight. The `progressions` table is not consulted by this page.
- R9. Routines are ordered alphabetically by `routines.name`, matching the existing `listRoutines` default.
- R10. Tapping `Start session` calls the existing `startSession({ routineId })` server action (`apps/swole/src/actions/sessions.ts`). On success, route to `/session/[id]`. On error (e.g., `RoutineAlreadyHasActiveSession`, `RoutineArchived`), surface a toast or inline error; do not navigate.

**Resume banner**

- R11. The banner renders only when at least one session exists with `completed_at IS NULL`.
- R12. Banner position: above the routines list, below the page nav. Persistent — visible at all scroll positions on mobile. Whether implemented via `position: sticky` or anchored above the scroll region is a planning-time decision.
- R13. Banner content:
  - Title line: `Resume [routine name]`
  - Subtitle line: `[next exercise name], set [setIdx + 1]/[total sets] · [target]`, where target is formatted by exercise type (e.g. `105 lb × 10` for weighted, `15 reps` for bodyweight, `30s` for time-based, `30 min` for cardio)
  - Primary action: `Resume →` linking to `/session/[id]` for that session
- R14. The next exercise, set position, and target are derived by calling `nextTarget(state, routine)` from `apps/swole/src/core/session-machine.ts`, where `state` is reconstructed from the active session's existing `set_logs` via the hydration path described in the data-layer brainstorm (R30: load set logs, translate `exercise_id` → `exerciseIdx` and `set_number` → `setIdx`, construct `SessionState` directly without action replay).
- R15. The banner contains no destructive controls (no "Abandon session", no "Discard", no menu). Destructive session actions belong in the runner or a future session-detail view, never above the fold on home.
- R16. If multiple sessions have `completed_at IS NULL` (the data layer's unique constraint is per-routine, so this is theoretically possible across multiple routines), the banner shows the one with the most recent `started_at`. The other active sessions are not surfaced on home in this PR; cleaning them up is a future janitor concern.

**Recent sessions strip**

- R17. The strip renders only when at least one session has `completed_at IS NOT NULL`. When zero completed sessions exist, the strip is omitted entirely — no "Your first session will appear here" copy.
- R18. Position: below the routines list.
- R19. Content: a short header (e.g., "Recent sessions") and the five most recent completed sessions, ordered by `completed_at DESC LIMIT 5`. Each row shows: short date + routine name, joined by `·` (e.g., `Wed · Push Day`).
- R20. Each row is tappable and links to `/routines/[id]` (the per-routine stats / detail page; PRD F4). A per-session detail page does not exist and is not introduced by this PR.
- R21. The strip's query joins only `sessions` to `routines` filtered on `completed_at IS NOT NULL`. No joins to `set_logs`, `exercises`, or `progressions` are required — the strip is intentionally low-signal.

**Empty state and routine creation**

- R22. When zero non-archived routines exist, the page renders a centered empty state in place of the routines list and recent-sessions strip. The resume banner still renders if an active session exists on an archived routine (edge case — archive should be blocked while a session is active, but the page must not blank-screen if it somehow happens).
- R23. Empty state content: a short headline (e.g., "No routines yet"), a one-line hint (e.g., "Create your first routine to start tracking workouts"), and a single primary button: `Create your first routine`. The button routes to the routine-builder page. Default route assumption: `/routines/new`; final path confirmed when the routine-builder brainstorm runs.
- R24. When at least one routine exists, a `+ New Routine` affordance is also present on home — typically as a button above or below the routines list, or as a ghost card at the end of the list. Exact visual placement is a planning-time call. The empty-state CTA from R23 covers the zero-routines case; R24 covers the one-or-more-routines case.

---

## Visual sketch

```
┌──────────────────────────────────────────────┐
│  [Swole]                                     │  ← existing nav (layout.tsx)
├──────────────────────────────────────────────┤
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Resume Push Day                        │  │  ← R11–R16 (conditional)
│  │ Bench Press, set 2/3 · 105 lb × 10     │  │
│  │                            [Resume →]  │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │ Push Day                            ⋯  │  │  ← R5–R10
│  │ **Mon** · Wed · Fri                    │  │     (today highlighted, R7)
│  │ 4 exercises                            │  │
│  │ Bench Press · 3×10 @ 105 lb            │  │     (next-up, R6)
│  │ [        Start session         ]       │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │ Pull Day                            ⋯  │  │
│  │ Tue · Thu                              │  │
│  │ 5 exercises                            │  │
│  │ Deadlift · 3×5 @ 185 lb                │  │
│  │ [        Start session         ]       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [ + New Routine ]                           │  ← R24
│                                              │
│  ─── Recent sessions ───────────────────     │  ← R17–R21 (conditional)
│  Wed · Push Day                              │
│  Sun · Pull Day                              │
│  Fri · Push Day                              │
│                                              │
└──────────────────────────────────────────────┘
```

Empty state (zero routines):

```
┌──────────────────────────────────────────────┐
│  [Swole]                                     │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│                                              │
│              No routines yet                 │  ← R22, R23
│   Create your first routine to start         │
│           tracking workouts                  │
│                                              │
│      [ Create your first routine ]           │
│                                              │
│                                              │
└──────────────────────────────────────────────┘
```

---

## Acceptance Examples

- AE1. **Covers R6, R8.** Given Push Day routine with first exercise = Bench Press (type=weighted, sets=3, target_reps=10, starting_weight=105, increment=5), the card's next-up line is `Bench Press · 3×10 @ 105 lb`. The `+5` increment is not displayed on the home card.
- AE2. **Covers R6.** Given Body Day routine with first exercise = Pushups (type=bodyweight, sets=3, target_reps=15), the card's next-up line is `Pushups · 3×15`.
- AE3. **Covers R6.** Given Mobility Day routine with first exercise = Plank (type=time-based, sets=3, duration_seconds=30), the card's next-up line is `Plank · 3×30s`. (Specific duration formatter — "30s" vs "0:30" — is a planning-time call.)
- AE4. **Covers R6.** Given Cardio routine with first exercise = Run (type=cardio, sets=1, duration_seconds=1800), the card's next-up line is `Run · 30 min`.
- AE5. **Covers R7.** Given today is Monday and a routine has `days = ['mon', 'wed', 'fri']`, the card's days line emphasizes "Mon" (e.g. `**Mon** · Wed · Fri`). The routine's position in the alphabetical list is unchanged.
- AE6. **Covers R13, R14.** Given an active session for Push Day with set_logs = [Bench Press set 0 = `Increment` at 100 lb] (one log, FSM-indexed), the banner renders: title `Resume Push Day`, subtitle `Bench Press, set 2/3 · 105 lb × 10`.
- AE7. **Covers R17.** Given any number of non-archived routines exist but zero sessions have completed, the recent-sessions strip is not rendered at all. No header, no empty-state copy.
- AE8. **Covers R22, R23.** Given zero non-archived routines and no active session, the page renders only the centered empty state — no routines list region, no recent-sessions region, no `+ New Routine` button.
- AE9. **Covers R10.** Given a routine that already has an active session, tapping `Start session` on its home card causes the server action to throw `RoutineAlreadyHasActiveSession`. The user remains on home; an error toast or inline error renders. (Disabling the button on render is an explicit planning-time question — see Deferred to Planning.)

---

## Success Criteria

- A fresh dev deploy (`docker-compose -f docker-compose.dev.yml up -d swole`) on a clean database renders the empty state at `http://swole.localhost`. Creating the first routine returns to home with that routine visible.
- After completing one session per the PRD F2 walkthrough, the home page shows the recent-sessions strip with that session at the top, no resume banner, and the routine's "next up" line reflects any rolled-up starting weight from the post-session prompt.
- Starting a session and navigating back to home without finishing it produces a resume banner showing the correct routine, current exercise + set position, and target. Tapping `Resume →` returns to `/session/[id]` with no data loss.
- `pnpm --filter @lilnas/swole lint`, `pnpm --filter @lilnas/swole type-check`, and `pnpm --filter @lilnas/swole test` all pass. The data-layer test suite from Survivor 3 still passes unchanged. New tests for the page itself are not required; the page is thin glue over already-tested helpers.
- The next swole brainstorm (routine builder, runner UI, stats) starts work without re-litigating home — the resume UX, card content, empty state, and strip behavior are settled here.

---

## Scope Boundaries

- No routine builder UI. `+ New Routine` and `Create your first routine` link to a route that does not yet exist; this PR ships with the link targets pointing at `/routines/new` (or whatever path the routine-builder brainstorm picks).
- No runner UI. `Resume →` and `Start session` link to `/session/[id]`, also not yet implemented. During development, those targets may 404; that is acceptable.
- No stats pages. Recent-sessions rows link to `/routines/[id]`, not implemented. Same acceptance criterion.
- No per-session detail page. The strip rows go to per-routine stats, not per-session detail. A session-detail page is a future, separate concern.
- No archived-routines management on home. No "Show archived" toggle, no archived list. Restoring an archived routine is a routine-builder concern.
- No abandon-session control on home. Abandoning belongs in the runner or a future session-detail surface; placing it above the fold creates mistap risk for a destructive action.
- No theming work beyond reusing the existing layout colors. New color tokens, font weight additions, or a redesign of the global theme are separate concerns.
- No new dependencies. `apps/swole/package.json` already declares MUI, Tailwind, and everything needed.
- No accessibility audit beyond reasonable tap-target sizing and semantic HTML. A formal a11y pass can land once more pages exist.
- No PWA, no install prompt, no offline mode. Mobile-first via responsive HTML; native shell is out of scope for v1 (and explicitly a PRD non-goal).
- No client-side data fetching libraries (React Query, SWR, etc.). The page is a server component; updates after mutations rely on `revalidatePath('/')` already wired into the existing server actions.
- No new query in the data layer purely for the routine-card "exercise count" if it can be derived cheaply from the existing `getRoutineWithExercises` or a small extension. A bulk `listRoutinesWithExerciseCounts()` helper is acceptable but optional; planner picks the cheapest correct path.
- No tests of MUI rendering details (color exactness, exact font sizes). The data layer is tested; the page is thin glue.
- No analytics, telemetry, or event instrumentation beyond the existing `/metrics` Prometheus surface. The page does not emit per-tap events.

---

## Key Decisions

- **Home is a launchpad with a memory strip, not a dashboard.** Picked "launchpad + recent history strip" over a dashboard variant with weekly/monthly summary metrics. Reason: at N=1, the home page's job is to get the user to the runner with the right routine; weekly summaries are emotional content with real carrying cost (new queries, charts) and zero functional payoff.
- **Resume = persistent banner at the top of the page.** Rejected: auto-redirect to `/session/[id]` on home visit (hostile when the user opened home for non-runner intent like glancing at history; Strong does this and it surprises users); card-highlight only (too subtle for a "don't lose your workout" cue); banner + card-highlight (two surfaces to keep in sync for marginal gain).
- **Resume banner shows routine + position + next target.** Rejected: bare ("Resume Push Day →" alone — you tap blind), position only (you don't see the weight/reps you're walking back into), position + time-elapsed (time goes stale within seconds at N=1, marginal value). Position + next target is the maximum useful pre-tap context.
- **Routine cards are "glanceable" — name + days + exercise count + first-exercise next-up line.** Rejected: minimal (you can't verify what's loaded without tapping in); full exercise list inline (1–2 cards per phone screen if routines are 4–5 exercises deep, defeats scannability). The next-up line uses the first exercise regardless of type — "first weighted exercise" would silently misrepresent pure-bodyweight or cardio-first routines.
- **Today's day-of-week is subtly highlighted; alphabetical order kept.** Rejected: no day awareness at all (misses an easy "the app knows what day it is" signal); today-first ordering (list order changes day-to-day, which is disorienting at small N); today section header (chrome-heavy at N=1, looks awkward on rest days). The PRD's no-`-auto-select` non-goal is about routing, not about visual emphasis.
- **Recent strip is minimal — date + routine only.** Rejected: heaviest weight per session (low-signal clutter when routines vary), progression delta per session (more interesting but requires a `progressions` join and surfaces silence on Stay/Failed/Case-B sessions — emotional payoff doesn't justify the query cost at v1). The strip is for memory, not analysis.
- **Archived routines hidden on home; no "show archived" toggle.** Un-archive UX belongs on a per-routine detail page (Survivor 4's routine builder). Adding a toggle to home pollutes the launchpad for a workflow that should happen elsewhere.
- **Page is a server component reading via the existing data-layer helpers.** No inline Drizzle in `page.tsx`, no client-side fetch, no React Query. Aligns with ADR-001; keeps the page testable as a thin glue layer.
- **No abandon-session action on home.** Destructive controls don't belong above the fold. The runner or a future session-detail view owns abandon.
- **Empty state replaces both the routines list and the recent-sessions strip when zero routines exist.** Not "show empty list + empty strip" — that produces a sad triple-stacked-empty page. One clear CTA on a fresh deploy is the cleaner shape.
- **Strip omitted entirely (no header, no copy) when zero completed sessions exist.** Rejected: "Your first session will appear here" placeholder — it's cruft that adds nothing; an absent strip is self-explanatory.

---

## Dependencies / Assumptions

- Survivors 1 (infra), 2 (FSM), and 3 (data layer) are merged. The Next.js scaffold exists, NestJS is removed, `apps/swole/src/core/session-machine.ts` exports the four FSM functions and types, and `apps/swole/src/db/{routines,sessions,exercises,setLogs,progressions}.ts` plus the corresponding `actions/` wrappers are in place and tested.
- The active-session resume query — "the most recently started session with `completed_at IS NULL`, plus its routine" — either reuses existing helpers in `apps/swole/src/db/sessions.ts` or extends that module with one new function. The exact API shape is a planning-time call.
- Reconstructing a `SessionState` from `set_logs` for an active session (the hydration path from Survivor 3's R30) works as described and is reusable from a server component running on the home page. If planning finds an edge case (e.g., an active session with zero set_logs because the user started but logged nothing), the banner falls back to displaying the routine's first exercise at its current starting weight.
- `/routines/[id]` (per-routine detail / stats / edit), `/routines/new` (routine builder), and `/session/[id]` (runner) will be implemented in subsequent brainstorms. Home renders link targets that may 404 during interim deploys; that is acceptable while Survivor 4 is in flight.
- Forward-auth at Traefik (`apps/swole/deploy.yml`) is the only auth gate. The home page makes no per-row authorization checks; every render assumes "this is Jeremy" because Traefik already verified.
- The existing dark theme (black background, orange accent) in `apps/swole/src/app/layout.tsx` and `apps/swole/src/theme.ts` is sufficient. No new theme tokens or global CSS changes are introduced by this PR.
- The existing `revalidatePath('/')` calls in `apps/swole/src/actions/{routines,sessions}.ts` are the cache-invalidation contract — when a routine is created/edited/archived or a session is started/completed, the home page re-renders on next visit without further plumbing.
- The Next.js App Router's server-component rendering model supports synchronous Drizzle access via `better-sqlite3` (already proven by the data-layer tests in Survivor 3).
- All of `routines.days`, `exercises.type`, `exercises.starting_weight`, `exercises.target_reps`, `exercises.sets`, and `exercises.duration_seconds` exist on the schema — verified against `apps/swole/src/db/schema.ts` and the data-layer brainstorm. No schema changes are required for this PR.

---

## Outstanding Questions

### Resolve Before Planning

_None. All product decisions are settled._

### Deferred to Planning

- [Affects R12][Technical] Whether the resume banner uses CSS `position: sticky`, is anchored above the routines list and scrolls with the page, or uses an MUI Drawer / AppBar variant. Stickiness offers maximum prominence; for a short page it's noise. Planner picks based on the expected routines-list length and which MUI primitive is cleanest.
- [Affects R13, R14, R16][Technical] Add a new query in `apps/swole/src/db/sessions.ts` (e.g., `getMostRecentActiveSession()`) or compose the lookup inline in `apps/swole/src/lib/` using existing helpers. The query returns at most one row; behavior when zero rows = no banner.
- [Affects R6, AE3][Technical] Exact duration formatter for time-based exercises on the card and banner ("30s" vs "0:30" vs "30 sec"). Default suggestion: `Ns` for ≤ 60s, `M:SS` for ≥ 60s. Planner confirms when the runner UI lands and a shared `formatDuration` helper becomes natural.
- [Affects R6][Technical] How the routine card sources `numExercises` for the "[N] exercises" line — a count from `getRoutineWithExercises({ id })` (over-fetches), an extension `listRoutinesWithExerciseCounts()`, or counting on a single joined query. Planner picks the cheapest path that doesn't N+1 across the routines list.
- [Affects R23, R24][Technical] Final route for the routine-builder page (`/routines/new` vs `/routines/create` vs in-page modal). Decided in the routine-builder brainstorm; this PR's CTAs target the eventual canonical path.
- [Affects R10, AE9][Technical] Whether `Start session` is rendered disabled on a routine that currently has an active session (the data layer throws `RoutineAlreadyHasActiveSession`). Default: keep enabled, let the action throw, surface as toast — keeps the home query simple. Disabled-on-render requires a per-routine "active session?" check, which is a join. Planner picks based on UX feel after first manual test.
- [Affects R19][Technical] Date formatting for recent-sessions rows. Default suggestion: short weekday (`Wed`) if within the past 7 days, else `[Mon] [d]` (`May 26`). Locale and exact format pinned by planning when the rest of the swole UI's date formatting starts to standardize.
- [Affects R6][Technical] Whether to use MUI `Card`, `Paper`, `ListItemButton`, or a custom component for the routine card. Pick during planning to align with whatever pattern the routine-builder UI ends up using.
- [Affects R7][Technical] How `currentDayOfWeek` is computed for the today-highlight — server-side at render time (TZ = container's TZ, which is UTC by default) or client-side via JS (user's local TZ). For a personal-use single-user app in a single TZ, server-side is fine if `TZ=America/Los_Angeles` is set in the container, else fall back to client-side via a small client wrapper. Planner picks.
- [Affects R20][Technical] If a recent-session row's routine is later archived, the strip row still links to `/routines/[id]` — confirm during planning whether that page handles archived routines or shows its own message. No-op if the routine-builder brainstorm has not landed yet.
- [Affects R10, R15][Editorial] Toast component choice (MUI `Snackbar`, sonner-style, or a custom inline error). Cosmetic; align with whatever lilnas-wide pattern emerges first.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
