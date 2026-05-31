---
date: 2026-05-29
topic: swole-stats-overview
---

# Swole — Stats Overview (Portfolio Header, Data-Rich Rows, Needs-Attention, Routine Scope)

## Problem Frame

The Stats index (`apps/swole/src/app/stats/page.tsx`) is a **navigation-only
flat list**: exercises grouped by routine, each row showing only a name + a type
badge, each linking to a per-exercise detail page. It does zero joins and zero
aggregates on purpose — it loads routines + exercises and renders. **There is no
data on it.** To answer "where am I on Bench, and is anything slipping?" today
costs a tap-in / tap-back per exercise — ~30 navigations to survey the gym.

This slice turns that page into a **retrospective overview** without duplicating
the two surfaces that already exist:

- **Home** (`src/app/page.tsx`) owns the *operational* surface — resume banner,
  routine cards with "today" highlighting, recent-sessions strip. Stats stays
  **retrospective** (what's happened, what's progressing, what's slipping), not a
  second launchpad.
- **Per-exercise detail** (`src/app/stats/[exerciseId]/page.tsx`) already renders
  the full `WeightTrendChart`, `ConsistencyView`, and `HistoryJournal`. The
  overview must **not** duplicate those at full size — it summarizes and links in.

Built from the ideation doc (`docs/ideation/2026-05-29-swole-stats-index-overview-ideation.md`),
this scopes **ideas #1 + #2 + #3 on top of a shared enabler**, plus a **routine
scope dimension** the user added during brainstorming:

1. **Portfolio summary header** — a row of KPI tiles giving the page a headline.
2. **Data-rich exercise rows** — each row gains a last-performed signal and (for
   weighted) a current-weight + trend indicator.
3. **"Needs attention" section** — the 2–3 lifts gone longest without a session,
   judged against the routine's cadence.
4. **Routine scope filter** — "All routines" overview + the ability to scope every
   surface to one routine, with archived routines viewable but quarantined from
   aggregates (model C).

**This deliberately revisits a prior non-goal.** The previous slice
(`docs/brainstorms/2026-05-28-swole-exercise-stats-requirements.md`) listed
"cross-exercise / aggregate dashboards" as a PRD non-goal. Ideas 1–3 are exactly
that aggregate surface; building them now is an intentional evolution. We **stay
aligned** with the PRD on streaks — no daily streak counter (also an anti-pattern
per the ideation's research).

---

## Key Flows

- **F1. Survey the whole gym at a glance**
  - **Trigger:** User taps "Stats" and lands on `/stats` (scope = All routines).
  - **Steps:** Reads the four KPI tiles (sessions this week + Δ, recent PRs, lifts
    progressing, consistency), scans the "Needs attention" section, then scans the
    routine-grouped rows — each showing how long since it was last trained and,
    for weighted lifts, current weight + trend direction.
  - **Outcome:** Without tapping into any exercise, the user knows how the week
    went, what's progressing, and what's slipping.
  - **Covered by:** R5–R22.

- **F2. Scope to one routine**
  - **Trigger:** From `/stats`, user picks "Push Day" in the scope selector.
  - **Steps:** The KPI tiles, "Needs attention", and the list all re-scope to Push
    Day's exercises only. The URL reflects the scope (e.g. `/stats?routine=2`).
  - **Outcome:** A focused read of one routine; "back to All" restores the
    portfolio view.
  - **Covered by:** R7, R8, R11–R14, R19.

- **F3. Look back at an archived (deleted) routine**
  - **Trigger:** User opens the scope selector and picks a routine from the
    "Archived" section.
  - **Steps:** The page shows that routine's **frozen** history (rows with their
    last-known weights and last-performed dates, retrospective tiles) under an
    "Archived" banner. Forward-looking surfaces (Needs attention, "progressing")
    are empty/suppressed — there is nothing to nag about a routine you stopped.
  - **Outcome:** History is never lost when a routine is deleted; it's one tap away.
  - **Covered by:** R8, R9, R23, R24.

- **F4. Open the page on a fresh build (the common case today)**
  - **Trigger:** User opens `/stats` with routines/exercises but ≤1 session (the
    runner that writes sessions/set-logs is unbuilt).
  - **Steps:** The header renders with tiles degraded to `—`/`0` + a one-line
    caption; "Needs attention" is hidden; rows show name + badge and "—" for
    staleness/trend.
  - **Outcome:** The page looks intentional, never broken or misleading.
  - **Covered by:** R15, R16, R22.

---

## Requirements

### Shared enabler (data + derivation vocabulary)

- **R1.** A new batched read — `getStatsIndexData()` (name is planning's call) — in
  the data layer (`apps/swole/src/db/`), built **server-only** and reading through
  Drizzle. It **must not N+1**: mirror `listRoutinesForHome`'s pattern — a small
  number of index-friendly queries (routines; exercises by `inArray(routineId)`;
  sessions; set-logs / progressions for in-scope weighted exercises by
  `inArray(exerciseId)`) grouped in-process. Include the `inArray([])` empty-guard
  that `listRoutinesForHome` documents. The read accepts a **scope** (all-active /
  a single routine) and returns everything the header, rows, and needs-attention
  section consume.
- **R2.** New **pure, tested** helpers in `apps/swole/src/lib/stats.ts`:
  `classifyTrend()` and `estimatedOneRepMax()`. A relative-time formatter (e.g.
  `formatRelativeDay`) is added to `apps/swole/src/lib/format.ts` (there is no
  "Xd ago" formatter today — only `formatRecentSessionDate`). A cadence helper
  (expected sessions from a routine's `days`) is added to `lib/stats.ts`.
  **`sessionVolume()` is explicitly NOT built** — Q3's starting-weight trend leaves
  it with no consumer (YAGNI); add it only when a volume signal is actually needed.
- **R3.** `estimatedOneRepMax(weight, reps)` = Epley: `weight × (1 + reps / 30)`.
  It is computed **only** on weighted sets that are **not** `Failed` and **not**
  `Decrement` — a failed heavy attempt or a back-off set must never read as a PR.
  (Mirrors the documented `classifyPostSession`-ignored-`Failed` bug class.)
- **R4.** `classifyTrend()` for a weighted exercise returns ↑ / ▬ / ↓ from the
  **direction of `starting_weight`** over a trailing **4-week** window, sourced from
  the `progressions` table (the same series the detail page charts). ↑ = starting
  weight rose in-window, ↓ = it dropped (a decrement), ▬ = unchanged. Non-weighted
  types have no weight series and are not classified.

### Page identity & layout

- **R5.** The page stays at `/stats` with nav label **"Stats"** (no rename, no new
  route tree). It remains a Next.js **server component** reading via data-layer
  helpers (ADR-001: no inline Drizzle, no client fetch), with `force-dynamic`.
  Mobile-first, single-column, dark/orange theme, `cns()` conventions — no new
  theme tokens.
- **R6.** Top-to-bottom the page renders: (1) **routine scope selector**, (2)
  **portfolio summary header** (KPI tiles), (3) **"Needs attention"** section, (4)
  the **routine-grouped exercise list** (the existing list, now data-rich). It does
  **not** duplicate the detail page (no inline full charts/journals) or home (no
  resume/"today"/launch CTAs).

### Routine scope selector

- **R7.** A scope selector offers **"All routines"** (default) + one entry per
  **active** routine + an **"Archived"** section listing archived routines **that
  have history**. Selecting an entry re-scopes the header tiles, "Needs attention",
  and the list. The selected scope is reflected in the URL (e.g.
  `/stats?routine=<id>`) so it is shareable/back-navigable; the exact mechanism is a
  planning detail. The dynamic route segment stays exercise-only (`/stats/[exerciseId]`)
  — routine scope is never a path segment, so `/stats/9` is unambiguously exercise 9.
- **R8.** **Model C.** The "All routines" aggregates and "Needs attention" count
  **active routines only** — an archived routine never contributes to the All view.
  Selecting an archived routine shows its **frozen** history (retrospective rows +
  tiles) under an "Archived" banner; forward-looking surfaces ("Needs attention",
  "Lifts progressing") are suppressed/empty for archived scope.
- **R9.** The routine-grouped list shows **active routines only** by default
  (unchanged from the prior slice's R2). Archived routines are reachable only via
  the selector's "Archived" section. A per-exercise detail page for an archived
  exercise still renders (prior slice R26) — unchanged.

### Summary header — KPI tiles (idea #1)

- **R10.** Four tiles, reusing `StatTile`: **Sessions this week** (the hero tile,
  `hero` variant) · **Recent PRs** · **Lifts progressing** · **Overall consistency**.
  Capped at these four in v1. All four are **scope-aware** (respond to R7).
- **R11.** **Sessions this week** = count of completed sessions in the last **7
  days**, with a delta vs the prior 7 days (e.g. `5 · ▲ +2`). A non-negative,
  behavior-relevant week-over-week number, not an all-time total.
- **R12.** **Recent PRs** = count of **weighted** exercises that set a **new best
  e1RM** (R3) within the last **30 days**. Counts exercises with ≥1 new PR, not PR
  events. Non-weighted types do not contribute in v1.
- **R13.** **Lifts progressing** = count of **weighted** exercises whose
  `classifyTrend()` (R4) is **↑** over the trailing 4 weeks.
- **R14.** **Overall consistency** = completed sessions ÷ **expected**, as a %, over
  the trailing **4 weeks**, where expected = Σ over the in-scope **active** routines
  of (scheduled days/wk from `routines.days`) × 4. Respects rest days (only counts
  scheduled days), and is active-scope only (an archived routine has no forward
  schedule). Capped at 100%.
- **R15.** **Cold-start:** with 0–1 sessions the header always renders; data-derived
  tiles degrade to `—` (or `0` where a count is the honest value) with a single
  one-line caption (e.g. "Complete a few sessions to see your trends"). No crash,
  no misleading value, no dead CTA.

### Data-rich exercise rows (idea #2)

- **R16.** Every row keeps its **name + type badge** and gains a right-aligned
  **last-performed** signal — a relative "Xd ago" ("Today" / "Yesterday" / "3d ago",
  longer windows in weeks), or `—` when the exercise has never been logged.
  Type-agnostic — computed for all four types.
- **R17.** **Weighted** rows additionally show **current weight** (`formatWeight`)
  + a **trend arrow** (↑ / ▬ / ↓ from R4), e.g. `135 lb ▲`. **Non-weighted** rows
  (bodyweight / time-based / cardio) show only name + badge + "Xd ago" in v1 — no
  value cluster, no arrow (they have no weight series).
- **R18.** The trend is shown as an **explicit arrow / delta**, never an auto-scaled
  per-row sparkline (a +5 lb and a +90 lb move must not look identical).

### "Needs attention" section (idea #3)

- **R19.** A section pinned **above the routine-grouped list** showing the top
  **2–3** lifts most **overdue**, judged by **cadence**: days-since-last-performed
  measured against the routine's scheduled frequency (`routines.days`), e.g.
  "Overhead Press — 24d (trains 2×/wk)". Active scope only.
- **R20.** Considers **all exercise types** — a neglected Plank or Morning Run is as
  real as a neglected lift. (Staleness is type-agnostic; "Xd ago" exists for every
  row regardless of the weighted-centric tiles.)
- **R21.** **Never-performed** exercises are surfaced as a **separate "Not started
  yet"** line, not mixed into the overdue list — a brand-new exercise is not
  "neglected."
- **R22.** The section **self-hides entirely** when nothing qualifies (cold-start,
  or everything on-cadence). It never renders an empty shell.

### Retention / archived routines (model C)

- **R23.** The stats page must honor that **"delete routine" = archive** (soft):
  archived routines' sessions, set-logs, and progressions are retained (DB-enforced
  by `onDelete: 'restrict'` FKs). This page **reads** that data per R8/R9; it does
  not implement delete/archive (that UI lives elsewhere and already archives).
- **R24.** Archived routines with history appear in the selector's "Archived"
  section (R7), are excluded from "All" aggregates and "Needs attention" (R8), and
  their per-exercise detail still renders (R9). A routine that was hard-deleted
  while history-free simply does not exist anywhere — nothing to show.

---

## Visual sketch

`/stats` — scope = All routines, with data:

```
┌──────────────────────────────────────────┐
│  [Swole]              Home    Stats        │
├──────────────────────────────────────────┤
│  ◍ All routines ▾                          │ ← R7 scope selector
│                                            │
│  ┌───────────────┐ ┌───────────────┐       │ ← R10 (4 tiles)
│  │ THIS WEEK     │ │ PRS · 30d     │       │
│  │ 5  ▲ +2       │ │ 2             │       │   Sessions = hero
│  └───────────────┘ └───────────────┘       │
│  ┌───────────────┐ ┌───────────────┐       │
│  │ PROGRESSING   │ │ CONSISTENCY   │       │
│  │ 4 ↑           │ │ 83%           │       │
│  └───────────────┘ └───────────────┘       │
│                                            │
│  ⚠  Needs attention                        │ ← R19
│   • Overhead Press — 24d  (trains 2×/wk)   │
│   • Deadlift — 17d        (trains 1×/wk)   │
│   Not started yet: Face Pull               │ ← R21
│                                            │
│  Push Day                                  │ ← grouped list (R16/R17)
│   Bench Press            135 lb ▲   3d ago │
│   Overhead Press          95 lb ▬  24d ago │
│   Pushups            bodyweight      5d ago │ ← non-weighted: badge + Xd ago
│  Pull Day                                  │
│   Deadlift              225 lb ▲  17d ago  │
│   Plank              time-based      2d ago │
└──────────────────────────────────────────┘
```

`/stats` — fresh build (≤1 session, the common case today):

```
┌──────────────────────────────────────────┐
│  ◍ All routines ▾                          │
│  ┌───────────────┐ ┌───────────────┐       │
│  │ THIS WEEK  0  │ │ PRS · 30d  —  │       │ ← R15 (degrade to 0 / —)
│  └───────────────┘ └───────────────┘       │
│  ┌───────────────┐ ┌───────────────┐       │
│  │ PROGRESSING — │ │ CONSISTENCY — │       │
│  └───────────────┘ └───────────────┘       │
│  Complete a few sessions to see trends.    │ ← R15 caption
│                                            │ ← R22: Needs-attention hidden
│  Push Day                                  │
│   Bench Press            105 lb       —    │ ← R16: "—" until logged
│   Pushups            bodyweight        —    │
└──────────────────────────────────────────┘
```

---

## Acceptance Examples

- **AE1. (R3, R12)** Bench Press logs 185×3 (e1RM ≈ 203) as a new best within 30
  days → it counts toward "Recent PRs". A later 200×1 attempt logged **Failed**
  (e1RM ≈ 207) does **not** count — failed sets are excluded. "Recent PRs" reflects
  the count of weighted exercises with a genuine new e1RM, not failed attempts.
- **AE2. (R4, R13, R17)** Overhead Press's `starting_weight` went 90 → 95 over the
  last 3 weeks → its row shows `95 lb ▲` and it's counted in "Lifts progressing". A
  lift unchanged for 4+ weeks shows `▬` and is not counted.
- **AE3. (R14)** Scope = Push Day (trains Mon/Thu = 2×/wk). Over 4 weeks, expected =
  8 sessions; 6 completed → "Overall consistency" = 75%.
- **AE4. (R19, R21)** Overhead Press (Push Day, 2×/wk) last done 24d ago and
  Deadlift (Pull Day, 1×/wk) 17d ago appear in "Needs attention", most-overdue
  first. Face Pull, created but never logged, appears under "Not started yet" — not
  in the overdue list.
- **AE5. (R16, R17)** A bodyweight row (Pushups) shows `bodyweight · 5d ago` with no
  weight or arrow; a weighted row (Bench Press) shows `135 lb ▲ · 3d ago`.
- **AE6. (R8, R24 — model C)** Push Day is archived. The "All routines" tiles and
  "Needs attention" no longer count any Push Day exercise. Push Day appears in the
  selector's "Archived" section; selecting it shows its frozen rows + retrospective
  tiles under an "Archived" banner, with "Needs attention" empty.
- **AE7. (R15, R22)** On a build with routines but zero sessions, the header renders
  with `0`/`—` tiles + the caption, "Needs attention" is absent, and every row shows
  "—" for last-performed. Nothing is broken or misleading.
- **AE8. (R1)** Loading `/stats` with 4 routines and ~25 exercises issues a small,
  bounded number of queries (not ~25–50). Archiving and reloading drops the routine
  from the All aggregates without error (empty-scope guarded).

---

## Success Criteria

- Opening `/stats` answers "how's my training going?" **without tapping into any
  exercise**: the four tiles give a headline, "Needs attention" surfaces what's
  slipping, and each row shows recency + (for weighted) weight & direction.
- Picking a routine in the selector re-scopes every surface; picking an **archived**
  routine shows its retained history under an "Archived" banner — **deleting a
  routine never loses its stats** (model C), and never pollutes the active portfolio.
- Every aggregate that implies progress (PRs, progressing, consistency) **correctly
  ignores `Failed` / `Decrement`** — nothing overstates progress.
- The page is **not** an N+1: it uses one batched read mirroring `listRoutinesForHome`.
- On a fresh build (routines/exercises, no runner) the page is fully intentional —
  degraded tiles + caption, hidden needs-attention, "—" rows. **No stats code change
  is needed when the runner later lands**: completing sessions populates the tiles,
  rows, and needs-attention automatically.
- `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` pass. New `lib/stats.ts`
  helpers (`classifyTrend`, `estimatedOneRepMax`, cadence) and the relative-time
  formatter ship with unit tests alongside the existing `stats.spec.ts` / `format.spec.ts`.

---

## Scope Boundaries

### In scope

- The shared enabler (R1–R4), the four-tile header (#1), data-rich rows (#2), the
  needs-attention section (#3), and the routine scope dimension (selector + model C).

### Deferred for later (out of this slice)

- **Idea #4 — whole-practice consistency heatmap** (GitHub-style). The "Overall
  consistency" tile is the only consistency surface in v1.
- **Idea #5 — recent-PRs spotlight strip.** Tile B is a count only; no per-PR cards.
- **Idea #6 — reorganize the list by momentum/status.** Routine grouping stays the
  list's structure.
- **Per-session view** (`/stats/session/<id>` — "everything I did Tuesday"). Not built.
- **A dedicated per-routine route** (`/stats/routine/<id>` or `/routines/<id>`).
  Routine scoping is a filter on `/stats`, not a new route tree (Approach 1).
- **Routine-vs-routine comparison** ("all routines over time" as side-by-side
  trends). Per-routine scope in v1 is the same tiles re-scoped.
- **PRs / trend for non-weighted types** (bodyweight rep-PRs, time-based longest
  hold). Weighted-only in v1.
- **`sessionVolume` / any volume metric**, per-row sparklines, daily streak counter,
  all-time vanity totals, leaderboards, single 0–100 "strength score".
- **Renaming "Stats"** to "Overview"/"Training". Revisit if the name stops fitting.

### Outside this product's identity

- The overview is **retrospective**; it does not become a second launchpad. No
  resume banner, no "today" highlighting, no "Start session" CTA — those belong to
  **home**. No full charts/journals inline — those belong to the **detail page**.

---

## Key Decisions

- **Build ideas 1–3 on a shared enabler, deliberately revisiting the prior
  "no aggregate dashboard" non-goal.** The ideation makes the case the stats index
  is data-free and an overview is the genuine gap; the enabler (`classifyTrend`,
  `estimatedOneRepMax`, batched read) compounds into home cards / detail / a future
  recap. We keep the PRD's **streak** non-goal (no daily streak).
- **PRs = e1RM (Epley), weighted-only (Q2b).** e1RM captures rep PRs and makes lifts
  comparable — the stated reason it's in the enabler. Bodyweight/time-based PRs are
  deferred. Raw-heaviest was rejected as missing "same weight, more reps".
- **Trend = `starting_weight` direction, not e1RM or volume (Q3a).** Matches the
  detail page's existing weight-over-time series and the app's progression model;
  simpler and less noisy than e1RM direction. Consequence: `sessionVolume` has no
  consumer and is not built.
- **Consistency = completed ÷ scheduled-expected over 4 weeks (Q4a).** Honest "am I
  keeping my own plan", respects rest days, and reuses the cadence machinery that
  the needs-attention section already needs. Rejected raw sessions/week (less
  meaningful) and active-weeks-% (too coarse).
- **Hybrid staleness (Q5c).** Every row shows plain "Xd ago" (cheap, no judgment);
  only "Needs attention" applies cadence to decide what's *overdue*. Dodges the
  nagging failure mode of a pure absolute threshold while still surfacing real
  neglect. Needs-attention considers all types; the value cluster + tiles are
  weighted-only (Q6).
- **Routine scope = a filter on `/stats`, not a new route (Approach 1).** An exercise
  belongs to exactly one routine (FK), so `/stats/<exerciseId>` already identifies
  "this exercise under its routine" — routine never needs to be in the path. Scoping
  is a query param over the overview. Rejected a dedicated per-routine route (overlaps
  the eventual `/routines/[id]` detail page) and a routine-first reframe (overlaps
  home's routine cards; bigger IA bet — make it after 1–3 ships).
- **Archived routines = model C.** "All" aggregates are active-only; archived
  routines are viewable on their own via the selector's "Archived" section with a
  frozen-history banner. Chosen over (A) tucking archived away entirely (loses
  browsability) and (B) counting archived history in retrospective tiles (a
  per-metric active/archived split for marginal honesty). C gives the cleanest mental
  model: *All = your active portfolio; archived is viewable but never pollutes it.*
- **"Delete" is already non-destructive — retention is a property, not a feature.**
  No hard `deleteRoutine` exists; `restrict` FKs forbid destroying a routine with
  history. So "keep the data on delete" needs no new persistence work — only the
  decision (model C) about what the stats surfaces *show*.

---

## Dependencies / Assumptions

- **Data layer is present on this branch** (`jeremy/stats-page`):
  `apps/swole/src/db/{routines,exercises,sessions,setLogs,progressions}.ts` exist and
  are tested. Reused: `listRoutinesForHome` (the batched pattern to mirror),
  `getSetLogsForExercise` (the per-exercise join; the new read generalizes it across
  scope via `inArray`), `getProgressionsForExercise`, `listRoutines`/`listExercisesForRoutine`.
- **The runner is unbuilt**, so on the current branch sessions/set-logs/`session_progression`
  rows are sparse or absent — the cold-start path (R15, R22) is the *primary* visible
  state until it lands. The page depends only on the data layer and needs no change
  when the runner ships.
- **Archived-routine data is queryable**: `listRecentCompletedSessions` already does
  not filter archived routines, establishing the precedent that archived history is
  valid history.
- **`StatTile` may need a minor extension** to render the Δ on "Sessions this week"
  (▲ +2) and the arrow on "Lifts progressing" — it currently takes `label` + `value`
  + `hero` only. Either embed the delta in the value string or add a small
  `delta`/`trend` prop. Planning's call; no new theme tokens.
- **Timezone:** "this week" / "days since" bucketing depends on the container `TZ`
  (the same dependency `getCurrentDayCode` documents). Bucket in JS in the pure
  helpers so they stay testable and TZ-correct; bucket by session `completedAt`.
- **Forward-auth at Traefik** is the only auth gate; the page makes no per-row
  authorization checks.
- **No new dependency** is required (no chart lib — the overview has no charts; rows
  use text + arrows, not recharts).

---

## Outstanding Questions

### Resolve Before Planning

_None. All product decisions are settled (tiles A–D with Sessions as hero; e1RM
weighted-only PRs; starting-weight trend; consistency-vs-schedule; hybrid staleness;
needs-attention 2–3, all types, separate "not started"; keep "Stats" + routine
grouping; Approach 1 scope filter; model C archived behavior; no per-session view)._

### Deferred to Planning

- **[Affects R1]** Exact shape/name of `getStatsIndexData()` and how it parameterizes
  scope (all-active vs one routine vs archived) — and whether PR/heaviest is derived
  from the same fetched set-logs or a small companion aggregate. Pick the cheapest
  correct path that avoids over-fetching set-logs for non-weighted exercises.
- **[Affects R7]** Scope-selector mechanism (query param `?routine=` vs route group)
  and control style (dropdown / segmented chips / tabs) on mobile; how "sticky scope"
  is preserved when drilling into an exercise and back.
- **[Affects R2, R16]** Relative-time thresholds/format ("3d ago" → "2w ago" → date)
  and where the helper lives (`format.ts`).
- **[Affects R4, R19]** Concrete `classifyTrend` window edges and the cadence formula
  for "overdue" (e.g. overdue when days-since > k × median-interval-from-`days`); pick
  k so it doesn't nag on normal rotation.
- **[Affects R8]** Exact treatment of forward-looking tiles under **archived** scope
  (show "—" vs omit the tile vs relabel as historical). Default: suppress
  needs-attention + "progressing"; keep retrospective tiles.
- **[Affects R10]** Whether `StatTile` gains a `delta`/`trend` prop or the Δ is
  formatted into `value`.
- **[Affects R6]** Tile grid on mobile (2×2 vs horizontal scroll) and where the scope
  selector sits relative to the header.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
