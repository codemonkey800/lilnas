---
date: 2026-05-29
topic: swole-stats-index-overview
focus: Improve the Stats index page (apps/swole/src/app/stats/page.tsx) — surface data / an at-a-glance overview instead of a navigation-only flat list.
mode: repo-grounded
---

# Ideation: Swole — Stats Index Page Overview

## Grounding Context

### Current state

`apps/swole/src/app/stats/page.tsx` is a **navigation-only flat list**: exercises grouped by routine (Cardio / Leg Day / Pull Day / Push Day), each row showing only the exercise name + a type badge (weighted / bodyweight / time-based / cardio), each linking to a per-exercise detail page. The page does **zero joins / zero aggregates** on purpose — it loads routines + their exercises and renders. There is no data on it.

### What already exists (don't duplicate)

- **Home page** (`src/app/page.tsx`) owns the *operational* surface: resume banner, routine cards with "today" highlighting, recent-sessions strip. → **Stats should lean RETROSPECTIVE** (what's happened, what's progressing, what's slipping), not be a second launchpad.
- **Per-exercise detail page** (`src/app/stats/[exerciseId]/page.tsx`) already renders `SummaryHeader` (stat tiles), `TrendRegion` (full `WeightTrendChart` + `ConsistencyView` per-session hit/miss dots), and `HistoryJournal`. → The index must not duplicate these at full size.

### Data model (SQLite/Drizzle, `src/db/schema.ts`)

- `routines` (name, `days[]` scheduled DayCodes, archivedAt)
- `exercises` (name, type, sets, targetReps, startingWeight, increment, durationSeconds, archivedAt)
- `sessions` (routineId, startedAt, completedAt)
- `set_logs` (sessionId, exerciseId, setNumber, weight, actualReps, durationSeconds, action ∈ Increment/Stay/Decrement/Complete/Hold/Done/Skipped/Failed)
- `progressions` (exerciseId, startingWeight, reason ∈ initial/session_progression/manual_edit, effectiveFrom) — per-exercise weight-change history

### Existing helpers (`src/lib/stats.ts`, pure/tested)

`heaviestLogged`, `sessionsPerformed`, `lastResult`, `successRate`, `doneSkippedCount`, `classifyConsistency`, `groupSetLogsBySession`, `buildWeightTrendPoints` + `weightTrendDomain`, `shouldRenderWeightChart`, `topSetPlanned`. UI primitives available for reuse: `StatTile` (has `hero` variant), `ExerciseTypeBadge`, `WeightTrendChart`, `ConsistencyView`. **Open seams (not yet built):** estimated-1RM, volume (weight×reps), a trend-direction classifier, any cross-exercise / portfolio aggregate, a staleness/last-performed helper.

### Constraints (verified)

- Next.js 16 App Router **server component**; read via `src/db/*.ts` helpers. Read-only aggregates are cheap/encouraged. No NestJS REST layer. `force-dynamic` already re-queries each visit.
- Compute metrics in `lib/stats.ts` / db helpers, **not ad hoc in JSX**.
- Any "success"/streak/PR metric must **account for `Failed`/`Skipped`/`Decrement`** actions or it overstates progress. (A documented prior bug: `classifyPostSession` once ignored `Failed` logs.)
- **N+1 risk:** per-row data must use a batched query (mirror the `listRoutinesForHome` `inArray` pattern), not 15–30 per-exercise reads.
- MUI 7 + Tailwind v4; use `cns()`. **Mobile-first** (used on a phone in the gym).
- **Cold-start:** must look intentional with 0–1 sessions, not broken.
- `docs/solutions/` has no UI/dashboard learning yet — this redesign is `/ce-compound` material once built.

### External grounding (web research)

- KPI-tile header (5–7 max, primary number + Δ vs prior period) is the universal stats-landing pattern (Hevy/Strong/Boostcamp). PR cards lead because progress is the emotional payoff.
- **Staleness / "days since last performed" is a cross-app gap** — almost no tracker surfaces it in the list, and users want it (RP Hypertrophy reviews; PRUV is the rare one that flags neglect proactively).
- GitHub contribution heatmap is the canonical consistency view — but GitHub *removed* its public streak counter over burnout pressure; show the picture, keep streaks secondary/weekly.
- Robinhood-style per-row sparklines work but lie when auto-scaled (a +5 lb and +90 lb move look identical) → prefer explicit Δ, or normalize to %-change / e1RM.
- Anti-patterns: vanity all-time totals, leaderboards (irrelevant for solo app), daily streaks that punish rest days, all-or-nothing session coloring, chart-overload on the overview, metrics that need explanation (DOTS/Strength-Score).

### Foundational enabler (underpins ideas 2, 3, 5)

A batched `getStatsIndexData()` (one grouped query across exercises) + a small **derivation vocabulary** in `lib/stats.ts`: `classifyTrend()` (↑/▬/↓), `estimatedOneRepMax()` (Epley — the normalizer that makes lifts comparable and powers PR detection + cross-exercise rollups), `sessionVolume()` (weight×reps). The index is the first consumer; home cards, the detail page, and a future weekly recap reuse the same helpers. Build the vocabulary once.

## Ranked Ideas

A natural high-confidence **v1 stack is #1 + #2 + #3** on top of the shared enabler. #4 and #5 are strong standalone additions. #6 is the ambitious rethink.

### 1. Portfolio summary header (KPI tiles)
**Description:** A row of 4–5 `StatTile`s at the top — *Sessions this week (Δ vs last week)*, *PRs this month*, *Lifts progressing*, *Overall consistency*. Gives the page a headline identity instead of opening cold on a label list.
**Rationale:** The single most-converged idea across all six frames and the literal answer to "some kind of overview." Reuses `StatTile` verbatim. Distinct from home (home = "what's next"; this = "how's it going").
**Downsides:** Tiles can drift into vanity metrics — pick numbers that change behavior (week-vs-week passes; "total lbs lifted all-time" fails). Cap at ~5 tiles. Needs the first cross-exercise/session aggregate query.
**Confidence:** 90%
**Complexity:** Low–Medium
**Status:** Unexplored

### 2. Data-rich exercise rows (staleness + trend Δ)
**Description:** Each row keeps name + type badge but gains a right-aligned cluster: *last-performed* ("3d ago" / "stale"), *current weight*, and a *trend arrow + delta* ("▲ +10 lb in 3 wks"). The list becomes a scannable status panel — a blood-test-panel layout (value + trend per marker).
**Rationale:** Answering "where am I on X, is it stale?" currently costs a tap-in/tap-back per exercise (~30 navigations to survey the gym); this collapses it to one screen. Uses explicit Δ rather than a sparkline deliberately, to dodge the auto-scaled-sparkline lie.
**Downsides:** Needs the batched enabler or it's slow. Bodyweight/time/cardio rows need their own signal (reps / duration / done-count), not weight. Trend needs `classifyTrend()`.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 3. "Needs attention" neglect section
**Description:** A pinned section above the list showing the 2–3 lifts gone longest without a session, judged *against the routine's cadence* ("Overhead Press — 24d, trains 2×/wk"). Plant-care framing: surface what's wilting.
**Rationale:** The hardest thing to see in a flat list is an *absence* — a neglected lift is invisible because nothing about it changes. This is the cross-app gap the research found, and it changes behavior rather than just informing.
**Downsides:** Needs a sensible cadence threshold (cross `routines.days` with days-since) or it nags about intentional rotation. Builds on #2's data. Define what "never performed" does (separate bucket).
**Confidence:** 80%
**Complexity:** Low–Medium
**Status:** Unexplored

### 4. Whole-practice consistency heatmap (GitHub-style)
**Description:** A calendar grid, one cell per day, color intensity = sets logged that day, **portfolio-wide** (all routines combined). Nudges the page from "exercise picker" toward "Training History." Complements (does not duplicate) the per-exercise consistency dots on the detail page.
**Rationale:** The "picture of the whole" a list can never give — answers "am I actually showing up?" pre-attentively; gaps are visible without reading a number. Handles both extremes (one session = one square; years = fixed grid, no axis to collapse). Pairs cleanly under the #1 header.
**Downsides:** Mobile layout is the real constraint; daily-streak counters are an anti-pattern to avoid; must count partial sessions as trained; cold-start grid looks barren without a caption.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Explored

**Deeper analysis (from refinement):**
- **Cell encoding:** use **sets-per-day** (real variance), bucketed into 4–5 intensity levels. Reject binary/sessions-per-day (collapse to on/off since ≤1 session/day) and volume (incomparable across exercise types). Count completed-session set logs; exclude `Skipped`.
- **Layout (mobile-first):** *transpose* GitHub — **7 columns (Mon–Sun) × N week-rows**, scrolling vertically. ~12 weeks (a training block) = 12 rows × 7 cols, fits portrait; optionally expand to a full year on wide viewports.
- **Query + TZ trap:** fetch `(session.completedAt, setCount)` for completed sessions since a cutoff, then bucket **in JS** in a pure `buildTrainingCalendar(rows, now, weeks)` helper. Bucketing by *local* day needs the container `TZ` (same dependency `getCurrentDayCode` documents); JS bucketing keeps it pure/testable and TZ-correct. Bucket by **session `completedAt`**, not per-set `loggedAt`.
- **Visual:** extend `ConsistencyView`'s hand-rolled `cns()`-styled dot grid into a ramp (`neutral-800` → `orange-900/800/600/500`). It's a grid of divs — no recharts.
- **Optional v2:** make cells tappable → that day's session (RP Hypertrophy users explicitly want date→session lookup; closes a documented gap; adds a small route).
- **Open questions for brainstorm:** intensity metric confirm; fixed 12 weeks vs responsive vs scrollable year; placement (above list / replace grouping / beside #1 header); rename "Stats" → "Overview"/"History"; show a (weekly, secondary) streak or omit.

### 5. Recent PRs / achievements spotlight
**Description:** A compact strip celebrating recent personal records — "New heaviest Deadlift: 245 lb · 4 days ago" — within a recency window, self-removing when there's nothing recent.
**Rationale:** Progress is the emotional payoff of a strength tracker, and every PR is currently buried one tap deep. Hevy/Strong/Boostcamp all lead with PR cards for this reason.
**Downsides:** Correctness-sensitive — PR detection must ignore `Failed`/`Decrement` sets or a failed heavy attempt reads as a record. Weighted-centric (bodyweight = rep PR, time-based = longest hold). Best built on `estimatedOneRepMax` / `heaviestLogged`.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 6. Reorganize the list by momentum/status (bold reframe)
**Description:** Drop alphabetical routine-grouping as the primary axis; auto-bucket exercises by state — **Climbing** (last progression was an increment) / **Holding** / **Stuck** (no change in N sessions, or a decrement) / **Dormant** (long gap). The organizing principle becomes direction-of-travel.
**Rationale:** A strength tracker's whole point is whether numbers go up, yet the page sorts by alphabet — information-free. This makes "what's working, what's plateaued?" the primary IA. The genuine reframe several frames converged on.
**Downsides:** Loses routine-based navigation (keep as a secondary toggle). More design decisions (bucket thresholds, how non-weighted types fit). Lower confidence — really a brainstorm seed, not a spec.
**Confidence:** 60%
**Complexity:** Medium–High
**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| R1 | "Due today" / ops-board / morning launchpad | Duplicates the home page, which already owns today / resume / routine cards |
| R2 | Single 0–100 "Strength Pulse" score | Needs-explanation anti-pattern; one number hides per-lift signal and can mislead |
| R3 | RPG XP / skill-tree roster | Gimmicky for a private tracker; brainstorm variant at best |
| R4 | Ambient "TV mode" big-screen dashboard | Niche separate display target, off the core question |
| R5 | Muscle/movement-group heatmap | Blocked — no muscle/category column in schema; v1 would just re-group by routine (already done) |
| R6 | Routine-section header rollups | Overlaps #1 + #2 without adding a distinct axis |
| R7 | Per-row sparkline (vs. Δ arrow) | Auto-scaled sparklines lie about magnitude + heavier render; kept as an option inside #2 |
| R8 | Remove the list entirely (auto-curated card deck) | Too radical — kills navigation utility; brainstorm variant of #6 |
| R9 | Weekly "Wrapped" recap card | Narrative form of #1; folded in rather than duplicated |
