---
date: 2026-05-28
topic: swole-exercise-stats
---

# Swole — Per-Exercise Stats

## Problem Frame

The PRD's F4 ("View stats / history") describes two surfaces: a per-routine
detail page (`/routines/[id]`) and a per-exercise stats page
(`/stats/[exerciseId]`). This brainstorm scopes **only the per-exercise stats
page** plus a thin index to reach it — the per-routine detail page is a
separate, later slice.

The per-exercise stats page is where the app's core promise pays off: "record
every set in detail so I can see progression history and charts over time."
It is the read-side counterpart to the runner. For a **weighted** exercise it
answers "is my weight going up, and what exactly have I lifted each session?"
For the other three types it answers the more modest but still real question
"am I showing up and hitting my target?"

Two realities shape the whole design:

1. **Stats are downstream of data that does not exist yet.** Set logs,
   completed sessions, and `session_progression` rows are produced by the
   runner (`/session/[id]`, PRD F2), which is **not built on any branch**. The
   routine builder (sibling branch `feat/swole-routine-builder`) produces
   routines, exercises, and one `initial` progression per weighted exercise —
   nothing more. So on a fresh build the chart has at most one point, the
   set-log journal is empty, and "sessions performed" is zero. **Every region
   must have a first-class empty/low-data state**; rich empty states are the
   primary deliverable until the runner lands, not an afterthought.

2. **The four exercise types have fundamentally different raw material.** Only
   weighted has a true progression series (the `progressions` table). Bodyweight
   and time-based cap actual at target — the only variation is failures.
   Cardio is binary done/skipped. The page is fully type-aware: weighted gets a
   real trend chart; the others get a consistency view. This is the honest shape
   of the data, not a limitation to design around.

The page does not invent product behavior — F4 already defines it. Its job is
to present each exercise type's data in its most useful, honest form, and to
degrade gracefully to clear empty states until the runner produces history.

---

## Key Flows

- F1. **Find an exercise and open its stats**
  - **Trigger:** User taps "Stats" in the nav and lands on `/stats`.
  - **Steps:** The index lists every exercise across non-archived routines, grouped by routine. User scans, finds e.g. "Bench Press" under "Push Day", and taps it. The page routes to `/stats/[exerciseId]`.
  - **Outcome:** User is on Bench Press's stats page.
  - **Covered by:** R1, R2, R3, R27.

- F2. **Read a weighted exercise's progression and history (data exists)**
  - **Trigger:** User opens `/stats/[exerciseId]` for a weighted exercise that has completed sessions.
  - **Steps:** The summary header shows current starting weight (hero), increment, sets × reps, top set (planned), and heaviest logged. Below it, a line chart plots starting weight over time. Below that, a session-grouped journal lists every set ever logged, newest session first.
  - **Outcome:** User can see whether the weight is climbing and exactly what they lifted each session.
  - **Covered by:** R5, R8, R13, R18, R19.

- F3. **Open a stats page before any sessions exist (the common case today)**
  - **Trigger:** User opens `/stats/[exerciseId]` for any exercise on a build with the routine builder but no runner.
  - **Steps:** The summary header renders all config-derived tiles (starting weight, increment, sets × reps, top set). Data-derived tiles ("Heaviest logged", "Sessions performed", "Success rate") show an em dash or zero. The trend region shows an empty-state message instead of a one-point chart. The journal shows an empty-state message.
  - **Outcome:** The page is informative and never broken, crashing, or misleading; no dead CTAs.
  - **Covered by:** R23, R24, R25.

---

## Requirements

**Stats index (`/stats`)**

- R1. A new index page lives at `apps/swole/src/app/stats/page.tsx`. It is a Next.js server component reading through existing data-layer helpers (ADR-001 path: no inline Drizzle in the page, no client-side fetch).
- R2. The index lists every non-archived exercise across all non-archived routines, grouped by routine (routine name as a group header). Each exercise is a tappable row linking to `/stats/[exerciseId]`. Within a routine, exercises keep their `order_in_routine`; routines are ordered alphabetically (matching `listRoutines`).
- R3. Each index row shows the exercise name and a compact type indicator (e.g. a small "weighted / bodyweight / time-based / cardio" badge). It does not need per-exercise stats inline — it is a navigation surface, not a dashboard.
- R4. When zero non-archived exercises exist, the index renders a centered empty state: a short headline ("No exercises yet") and a one-line hint pointing at routine creation. The CTA links to the routine-builder route (`/routines/new`); during interim builds that route may 404, which is acceptable and consistent with home's existing interim links.

**Stats page composition (`/stats/[exerciseId]`)**

- R5. The page lives at `apps/swole/src/app/stats/[exerciseId]/page.tsx`, a server component reading through existing data-layer helpers plus one new per-exercise set-log read (see Dependencies). It renders three regions top-to-bottom: (1) summary header, (2) trend region, (3) session-grouped history journal.
- R6. The header identifies the exercise: name, type, and the parent routine name. The parent routine name may link to `/routines/[id]` (interim-404 until routine detail ships) or render as plain text; the choice is cosmetic and deferred to planning.
- R7. Mobile-first, single-column. The existing dark/orange theme and `cns()` conventions are reused; no new theme tokens. The page reuses the existing layout chrome in `apps/swole/src/app/layout.tsx`.

**Summary header — type-aware tiles**

- R8. **Weighted** tiles: Current starting weight (the hero number, visually emphasized) · Increment · Sets × target reps · Top set (planned) · Heaviest logged.
- R9. The **"Top set (planned)"** tile is the value `starting_weight + (increment × (sets − 1))` — the weight the final set reaches if every set increments from the current starting weight. It is explicitly **not** labeled "Max weight": that label reads as a personal record, but the value is a configured per-session ceiling. The label must convey "planned/configured," not "achieved."
- R10. The **"Heaviest logged"** tile is the heaviest weight actually recorded across all of this exercise's set logs (a genuine achieved max). Until set logs exist it renders an em dash (`—`), not `0`.
- R11. **Bodyweight** tiles: Sets × target reps · Sessions performed · Last result (the actual reps from the most recent session, e.g. `15 · 15 · 12`). **Time-based** tiles: Sets × target duration · Sessions performed · Success rate (share of logged sets that were `Hold`, not `Failed`). **Cardio** tiles: Target duration · Done / skipped count.
- R12. Current starting weight is the hero tile for weighted; for non-weighted types the configured target (reps or duration) is the hero tile. Data-derived tiles (Heaviest logged, Sessions performed, Last result, Success rate, Done/skipped) degrade to `—` or `0` when no sessions exist (R24).

**Trend region — type-aware**

- R13. **Weighted** renders a line chart of starting weight over time, sourced from the `progressions` table (points at each `initial`, `session_progression`, and `manual_edit` entry, plotted by `effective_from`). Whether it renders as a line or a step (weight holds until the next change) is a planning-time call.
- R14. **Non-weighted** types render a **consistency view**: one marker per completed session in which the exercise was logged, in chronological order. Marker states by type — bodyweight/time-based: "hit target" (all logged sets `Complete`/`Hold`) vs "partial" (any `Failed`); cardio: "done" vs "skipped". This view answers "did I hit it" rather than faking a progression curve.
- R15. The trend region has a low-data threshold: the weighted chart renders only when at least two progression points exist. A single `initial` point is not a trend — when fewer than two points exist, the region shows an empty-state message (R23) instead of a degenerate one-point chart. The current starting weight is already visible in the header, so no information is lost.
- R16. The consistency view renders only when at least one session has been logged for the exercise; otherwise it shows an empty-state message (R23).
- R17. The trend region is the only region that may need a client component (for the chart library). The summary header and history journal are server-rendered.

**History journal — session-grouped set log**

- R18. The history region lists every set ever logged for this exercise, grouped by the session it belongs to. Each group has a header showing the session date and routine name (reusing the existing `formatRecentSessionDate` helper or its successor). Sessions are ordered newest-first; sets within a group are ordered by `set_number` ascending.
- R19. Each set row is formatted by exercise type:
  - **Weighted:** `Set N — [weight] × [actual_reps] · [action]`. When `actual_reps < target_reps` (a `Failed` set), the shortfall is visually distinct (e.g. `8/10`).
  - **Bodyweight:** `Set N — [actual_reps]/[target_reps] · [action]`.
  - **Time-based:** `Set N — [duration] · [action]` (showing actual duration when the set was `Failed`).
  - **Cardio:** a single row — `[duration] · [Done | Skipped]`.
- R20. The journal reflects **logged sets only**. An exercise the user jumped past without logging (no `set_logs` row) does not appear for that session. Cardio `Skipped` is an explicit logged action and does appear.
- R21. The journal shows all history, newest-first, with no cap in v1. Pagination or a "load more" affordance is a planning-time optimization, not a v1 product requirement.
- R22. When zero sets have been logged for the exercise, the journal shows an empty-state message (R23) — no empty table chrome, no header row with no data.

**Empty / low-data states and archived exercises**

- R23. Each region owns a distinct, informational empty state with no dead CTAs (the runner does not exist to link to): trend → "Your weight progression will chart here after a couple of sessions" (weighted) / "Your session history will appear here once you complete a workout" (non-weighted); journal → "No sets logged yet."
- R24. Config-derived tiles (starting weight, increment, sets × reps, top set, target duration) always render from the exercise definition. Data-derived tiles render `—` (or `0` where a count is the honest value) until sessions exist. A stats page for a never-run exercise is fully informative, never broken.
- R25. The page never crashes or renders a misleading value when history is absent: no one-point chart (R15), no "Heaviest logged: 0", no "Max weight" framing (R9).
- R26. Navigating directly to the stats page of an **archived** exercise still renders the page (history is the entire point of stats) with a subtle "Archived" marker in the header. The `/stats` index does not list archived exercises (R2), so this is reachable only by direct URL or a stale link.

**Navigation**

- R27. A "Stats" entry is added to the app nav (in `apps/swole/src/app/layout.tsx`) linking to `/stats`. This is the canonical entry point to the stats surface.
- R28. This work does not add exercise links to the home page and does not build the per-routine detail page. Home's existing links are unchanged.

---

## Visual sketch

Weighted exercise — with data:

```
┌──────────────────────────────────────────────┐
│  [Swole]            Home   Stats             │  ← R27 (Stats nav entry)
├──────────────────────────────────────────────┤
│  Bench Press           weighted · Push Day   │  ← R6
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │
│  │ START  │ │  +5lb  │ │  3×10  │ │ TOP SET│ │  ← R8, R9
│  │ 105 lb │ │  incr. │ │ sets×r │ │ 115 lb │ │     (start = hero)
│  └────────┘ └────────┘ └────────┘ └────────┘ │
│  Heaviest logged: 110 lb                      │  ← R10
│                                              │
│  Starting weight over time                    │  ← R13
│   115│                            ╭──         │
│   110│                  ╭─────────╯           │
│   105│      ╭───────────╯                     │
│   100│──────╯                                 │
│      └───────────────────────────────────     │
│       initial   May 14   May 21   May 27      │
│                                              │
│  ─── History ──────────────────────────       │  ← R18
│  Wed · May 27 — Push Day                      │
│    Set 1 — 100 × 10 · Increment               │  ← R19
│    Set 2 — 105 × 10 · Stay                    │
│    Set 3 — 105 × 10 · Complete                │
│  Sun · May 24 — Push Day                      │
│    Set 1 — 100 × 8/10 · Failed                │     (shortfall distinct)
│    Set 2 — 100 × 10 · Stay                    │
│    Set 3 — 100 × 10 · Complete                │
└──────────────────────────────────────────────┘
```

Cardio exercise — empty (no sessions yet, the common case today):

```
┌──────────────────────────────────────────────┐
│  Morning Run            cardio · Conditioning │
│  ┌────────────┐ ┌────────────────┐            │
│  │ 30 min     │ │ Done 0 / Skip 0│            │  ← R11, R24 (count = 0)
│  └────────────┘ └────────────────┘            │
│                                              │
│  Consistency                                  │  ← R14, R16
│   Your session history will appear here once  │     (empty state, R23)
│   you complete a workout with this exercise.  │
│                                              │
│  ─── History ──────────────────────────       │
│   No sets logged yet.                         │  ← R22, R23
└──────────────────────────────────────────────┘
```

Stats index (`/stats`):

```
┌──────────────────────────────────────────────┐
│  [Swole]            Home   Stats             │
├──────────────────────────────────────────────┤
│  Push Day                                     │  ← R2 (grouped by routine)
│    Bench Press                    weighted →  │  ← R3 (name + type badge)
│    Overhead Press                 weighted →  │
│    Pushups                      bodyweight →  │
│  Pull Day                                     │
│    Deadlift                       weighted →  │
│    Plank                        time-based →  │
└──────────────────────────────────────────────┘
```

---

## Acceptance Examples

- AE1. **Covers R9.** Given Bench Press (weighted, starting_weight=105, increment=5, sets=3), the "Top set (planned)" tile shows `115 lb` (105 + 5×2) and is labeled as planned/configured, never "Max weight".
- AE2. **Covers R10, R24.** Given Bench Press with no set logs yet, "Heaviest logged" renders `—`. After a session logs sets at 100/105/105, it renders `105 lb`.
- AE3. **Covers R15.** Given a weighted exercise with only its `initial` progression (one point), the trend region shows the low-data empty state, not a single-dot chart. After one completed session adds a `session_progression` point, the chart renders with two points.
- AE4. **Covers R14, R19.** Given Plank (time-based) logged across two sessions — session A all `Hold`, session B one `Failed` — the consistency view shows two markers (A = hit target, B = partial), and the journal lists session B's `Failed` set with its actual duration.
- AE5. **Covers R11.** Given Pushups (bodyweight, 3×15) whose most recent session logged 15/15/12, the "Last result" tile shows `15 · 15 · 12`.
- AE6. **Covers R20.** Given a session where the user jumped past Overhead Press and logged nothing for it, Overhead Press's journal does not show that session. A cardio exercise logged as `Skipped` in a completed session does show that session.
- AE7. **Covers R2, R26.** Given Bench Press is archived, it does not appear in the `/stats` index, but navigating directly to `/stats/[its id]` still renders its full history with an "Archived" marker.
- AE8. **Covers R23, R25.** Given a fresh build (routine builder data, no runner), every exercise's stats page renders config tiles, an empty trend region, and an empty journal — no crash, no one-point chart, no "Max weight" label.

---

## Success Criteria

- From the "Stats" nav entry, Jeremy can pick any exercise and reach its stats page. A weighted exercise shows the progression chart (once ≥2 points) plus the session journal; a non-weighted exercise shows the consistency view plus the journal. Before any sessions exist, every region shows a clear, non-broken empty state.
- On a dev deploy seeded with routines/exercises (via `scripts/seed-home.mjs` or the routine builder), the `/stats` index lists every exercise grouped by routine, and each stats page renders its config-derived tiles with empty trend/history. **No stats code change is needed when the runner later lands** — completing a session makes the chart gain a point and the journal show that session automatically.
- The "Top set (planned)" / "Heaviest logged" split removes the misleading "Max weight" framing: nothing on the page implies a personal record the data does not support.
- `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` all pass. The only data-layer addition is the one new per-exercise set-log read; existing helpers are reused.
- The next swole brainstorm (per-routine detail, or the runner) starts without re-litigating the stats page: type handling, the index, empty-state behavior, and the journal shape are settled here.

---

## Scope Boundaries

- **No per-routine detail page** (`/routines/[id]`). That is the other half of PRD F4 and a separate slice. This work builds only the per-exercise stats page and its index.
- **No runner.** This page only reads data the runner will eventually produce. The runner (`/session/[id]`, F2) is a separate, unbuilt slice. Stats render empty states until it lands.
- **No "Start session" or any CTA into the runner** from these pages. Empty states are informational; placing a dead CTA mirrors a flow that does not exist.
- **No editing.** Editing an exercise's starting weight (which writes a `manual_edit` progression, F5) belongs to the routine-detail/edit surface, not the read-only stats page.
- **No exercise links on home.** Home stays the "launchpad, not dashboard" surface defined in its own brainstorm.
- **No new theme tokens, no global CSS, no a11y audit beyond reasonable tap targets and semantic HTML.**
- **No analytics or per-view telemetry** beyond the existing `/metrics` Prometheus surface.
- **No cross-exercise or aggregate dashboards** (total volume across routines, weekly summaries, calendar heatmaps). Streaks and skipped-session tracking are explicit PRD non-goals.
- **No 1RM estimator, plate calculator, or body-weight tracking** — explicit PRD non-goals / future ideas.
- **No pagination of the journal in v1** (R21). Revisit only if the journal becomes unwieldy in practice.

---

## Key Decisions

- **Scope is the per-exercise stats page + a thin index, not the per-routine detail page.** F4 is two surfaces; this builds the chart-and-journal one. Routine detail is deferred to its own slice. Chosen over building both at once to keep the slice shippable.
- **Fully type-aware, not weighted-only.** Each type gets its own summary, trend, and journal formatting. Rejected "weighted-rich, others minimal" — the user wants the non-weighted types to carry real (if modest) content.
- **Weighted gets a real weight-over-time chart; non-weighted gets a consistency view.** Rejected forcing an actual-vs-target line onto non-weighted types: the data caps actual at target, so such a line would sit flat with occasional dips — a misleading "trend." The consistency view ("did I hit it") is the honest, useful shape for bodyweight/time-based/cardio.
- **History journal is grouped by session, not a flat table.** Reads like a workout log ("what did I do last Wednesday"); pairs cleanly with the per-session consistency markers. The chart owns the trend, so the journal's job is per-session detail.
- **"Top set (planned)" + "Heaviest logged", never "Max weight".** The PRD's `sw + inc×(sets−1)` is a configured per-session ceiling, not a PR; labeling it "Max weight" misleads. Show the configured ceiling (available now) and the achieved heaviest (real, once data exists) as two clearly-labeled tiles. Current starting weight remains the hero number.
- **Empty states are the primary deliverable until the runner lands.** Because set logs/sessions/`session_progression` rows do not exist yet, the page is mostly empty on a fresh build. Every region degrades to a clear informational state; the chart suppresses to an empty state below two points rather than drawing a degenerate single dot.
- **Reachable via a thin `/stats` index + a "Stats" nav entry.** A stats page reachable only by typing a URL is a feature that does not exist yet. The index lists all exercises (grouped by routine) and does not duplicate the per-routine detail page (which lists one routine's exercises) — it is a global exercise picker that naturally becomes the "Stats" tab.

---

## Dependencies / Assumptions

- **Data layer (Survivor 3) is present on this branch** (`jeremy/stats-page`): `apps/swole/src/db/{routines,exercises,sessions,setLogs,progressions}.ts` and the schema exist and are tested. `getProgressionsForExercise` (chart source) and `listRoutines` / `listExercisesForRoutine` (index source) already exist and are reused.
- **One new data-layer read is needed:** a per-exercise set-log query (e.g. `getSetLogsForExercise(exerciseId)`) returning all of an exercise's set logs joined to their sessions for dates, ordered for session grouping — plus the heaviest-logged aggregate (R10), which can be derived from the same data or a small companion query. The data-layer plan explicitly deferred F4 stats reads to "Survivor 4 or later," so this addition is expected.
- **Routine + exercise data** to populate the index and headers comes from the routine builder (sibling branch `feat/swole-routine-builder`) or `scripts/seed-home.mjs`. Trend and journal data come from the **runner, which is unbuilt** — so on the current branch those regions show empty states. The stats code itself depends only on the data layer, so it can build on the current branch; populating it for a live demo requires the builder (routines) and ultimately the runner (history).
- **Forward-auth at Traefik** is the only auth gate; the page makes no per-row authorization checks.
- The existing `revalidatePath` contract in the server actions is sufficient: once the runner writes set logs / progressions and revalidates, the stats pages reflect new history on next visit with no extra plumbing.
- **Charts:** the PRD names `recharts` (or `visx` if Recharts feels heavy). No charting dependency is in `apps/swole/package.json` yet — adding one is expected and confirmed at planning time. *(Verified: `package.json` declares MUI/Tailwind but no chart library.)*

---

## Outstanding Questions

### Resolve Before Planning

_None. All product decisions are settled._

### Deferred to Planning

- [Affects R13][Technical] Chart library choice (`recharts` vs `visx`) and whether the weighted trend renders as a line or a step. Default: `recharts`, step rendering (weight holds until the next change is more truthful than interpolating between progression events).
- [Affects R5, R10][Technical] Exact shape of the new per-exercise set-log read and whether "Heaviest logged" is a separate aggregate query or derived in-page from the fetched logs. Planner picks the cheapest correct path that avoids over-fetching.
- [Affects R14][Technical] The concrete visual for the consistency view (dot strip, small bar row, MUI chips) and how many sessions it shows before it needs its own truncation. Default: show all logged sessions, oldest→newest, with a compact marker per session.
- [Affects R18][Technical] Reuse `formatRecentSessionDate` for session-group headers as-is, or introduce a slightly longer format for the journal (the home strip's format may be too terse with a year boundary). Editorial; align with whatever date formatting the rest of swole standardizes on.
- [Affects R6][Technical] Whether the parent routine name in the header links to `/routines/[id]` (interim-404) or renders as plain text until routine detail ships. Cosmetic.
- [Affects R27][Technical] Nav placement/visual for the "Stats" entry, aligned with whatever nav pattern the layout settles on as more pages land.
- [Affects R3][Technical] Whether the index row shows anything beyond name + type badge (e.g. a faint sets×reps line). Default: name + type only; keep it a navigation surface.
- [Affects R21][Technical] If/when journal pagination is needed and the threshold. Default: none in v1.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
