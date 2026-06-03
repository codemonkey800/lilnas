---
title: 'feat: Swole per-exercise stats page + index'
type: feat
status: active
date: 2026-05-29
deepened: 2026-05-29
origin: docs/brainstorms/2026-05-28-swole-exercise-stats-requirements.md
---

# feat: Swole per-exercise stats page + index

## Overview

Build the read-side of the swole workout app's PRD F4: a thin stats **index** at
`/stats` (every non-archived exercise, grouped by routine) and a per-exercise
**stats page** at `/stats/[exerciseId]` with three top-to-bottom regions — a
type-aware summary header, a type-aware trend region, and a session-grouped
history journal — plus a "Stats" nav entry.

The page is fully **type-aware** across the four exercise types (`weighted`,
`bodyweight`, `time-based`, `cardio`), because each type has fundamentally
different raw material: only weighted has a true progression series (a real
chart); the others get a consistency view ("did I hit it"). Because the runner
(`/session/[id]`, PRD F2) that produces set logs, completed sessions, and
`session_progression` rows **does not exist on any branch yet**, every region's
**empty / low-data state is the primary deliverable** — on today's builds the
chart has at most one point, the journal is empty, and counts are zero. The page
must be fully informative and never broken in that state, and must require **zero
code change** when the runner later lands. When the runner commits a progression
decision, the chart gains a point (via the unfiltered `getProgressionsForExercise`
read); when it completes a session, the journal and consistency view gain that
session's history (via `getSetLogsForExercise`, scoped to `completedAt IS NOT NULL`).
These update independently through the existing `revalidatePath` contract.

This is a read-only surface. It reuses the existing data layer (ADR-001 path:
server components read through named `src/db/*.ts` helpers — no inline Drizzle,
no client fetch), adds two small reads and one chart dependency, and follows the
swole home page as its structural template.

---

## Problem Frame

F4 defines two surfaces: a per-routine detail page and a per-exercise stats page.
This plan builds **only** the per-exercise stats page and a thin index to reach
it; per-routine detail is a separate, later slice (see origin Scope Boundaries).

The stats page is where the app's core promise pays off — "record every set so I
can see progression history and charts over time." Two realities shape the whole
design (see origin: `docs/brainstorms/2026-05-28-swole-exercise-stats-requirements.md`):

1. **Stats are downstream of data that does not exist yet.** Set logs / completed
   sessions / `session_progression` rows come from the unbuilt runner. The routine
   builder (sibling branch) + `scripts/seed-home.mjs` produce routines, exercises,
   and one `initial` progression per weighted exercise. So empty states are not an
   afterthought — they are the main thing this slice ships.
2. **The four types have different raw material.** Weighted gets a real
   weight-over-time chart; bodyweight / time-based / cardio get a consistency view
   (one marker per completed session). This is the honest shape of the data.

The page invents no product behavior — F4 already defines it. Its job is to present
each type's data in its most useful, honest form and degrade gracefully until the
runner produces history.

---

## Requirements Trace

**Stats index (`/stats`)**

- R1. New index page at `apps/swole/src/app/stats/page.tsx` — Next.js server component reading through existing data-layer helpers (ADR-001).
- R2. Lists every non-archived exercise across all non-archived routines, grouped by routine; routines alphabetical (matching `listRoutines`), exercises by `order_in_routine`. Each row links to `/stats/[exerciseId]`.
- R3. Each row shows exercise name + a compact type badge. Navigation surface, not a dashboard.
- R4. Zero non-archived exercises → centered empty state with headline + one-line hint; CTA links to `/routines/new` (interim-404 acceptable, consistent with home).

**Stats page composition (`/stats/[exerciseId]`)**

- R5. Page at `apps/swole/src/app/stats/[exerciseId]/page.tsx` — server component reading through existing helpers + one new per-exercise set-log read. Renders three regions: summary header, trend region, history journal.
- R6. Header identifies the exercise: name, type, parent routine name.
- R7. Mobile-first single-column; reuse existing dark/orange theme, `cns()` conventions, and the `layout.tsx` chrome. No new theme tokens.

**Summary header — type-aware tiles**

- R8. **Weighted** tiles: Current starting weight (hero) · Increment · Sets × target reps · Top set (planned) · Heaviest logged.
- R9. "Top set (planned)" = `starting_weight + (increment × (sets − 1))`. Labeled planned/configured — **never** "Max weight."
- R10. "Heaviest logged" = heaviest weight actually recorded across this exercise's set logs. Renders `—` (not `0`) until set logs exist.
- R11. **Bodyweight:** Sets × target reps · Sessions performed · Last result. **Time-based:** Sets × target duration · Sessions performed · Success rate (share of logged sets `Hold`, not `Failed`). **Cardio:** Target duration · Done / skipped count.
- R12. Hero tile = current starting weight (weighted) or configured target (non-weighted). Data-derived tiles degrade to `—`/`0` when no sessions exist.

**Trend region — type-aware**

- R13. **Weighted** → line chart of starting weight over time from `progressions` (each `initial` / `session_progression` / `manual_edit`, plotted by `effective_from`). Line-vs-step is a planning call.
- R14. **Non-weighted** → consistency view: one marker per completed logged session, chronological. bodyweight/time-based: "hit target" (all `Complete`/`Hold`) vs "partial" (any `Failed`); cardio: "done" vs "skipped".
- R15. Weighted chart renders only with ≥2 progression points; otherwise empty-state message (no degenerate one-point chart). Current starting weight is already in the header.
- R16. Consistency view renders only with ≥1 **completed** logged session (`completedAt IS NOT NULL`); otherwise empty-state message.
- R17. The trend region is the **only** region that may need a client component (the chart). Header and journal are server-rendered.

**History journal — session-grouped set log**

- R18. Lists every logged set, grouped by its session. Group header shows session date + routine name (reusing/extending `formatRecentSessionDate`). Sessions newest-first; sets within a group by `set_number` ascending.
- R19. Per-type set row formatting. Weighted: `Set N — W × actual_reps · action` (shortfall `8/10` distinct). Bodyweight: `Set N — actual/target · action`. Time-based: `Set N — duration · action` (actual duration when Failed). Cardio: single row `duration · Done|Skipped`.
- R20. Logged sets only. An exercise jumped past without logging does not appear for that session. Cardio `Skipped` is a logged action and appears.
- R21. All history, newest-first, no cap in v1. Pagination is a planning-time optimization, not a v1 requirement.
- R22. Zero logged sets → journal empty-state message; no empty table chrome.

**Empty / low-data states and archived exercises**

- R23. Each region owns a distinct, informational empty state with **no dead CTAs** (the runner does not exist to link to).
- R24. Config-derived tiles always render from the exercise definition; data-derived tiles render `—`/`0` until sessions exist. A never-run exercise's page is fully informative.
- R25. Never crashes / renders a misleading value when history is absent: no one-point chart (R15), no "Heaviest logged: 0", no "Max weight" framing (R9).
- R26. Archived exercise still renders by direct URL (history is the point) with a subtle "Archived" marker. The index excludes archived (R2), so this is reachable only by direct URL / stale link.

**Navigation**

- R27. "Stats" entry added to the app nav in `apps/swole/src/app/layout.tsx`, linking to `/stats`. Canonical entry point.
- R28. No exercise links on home; no per-routine detail page. Home's existing links unchanged.

**Origin flows:** F1 (find an exercise → open its stats), F2 (read a weighted exercise's progression + history when data exists), F3 (open a stats page before any sessions exist — the common case today).

**Origin acceptance examples:** AE1 (Top set planned = 115, labeled planned — covers R9), AE2 (Heaviest logged `—` then `105 lb` — R10/R24), AE3 (one point → empty, two points → chart — R15), AE4 (Plank consistency markers + Failed journal row — R14/R19), AE5 (Pushups "Last result" `15 · 15 · 12` — R11), AE6 (jumped-past exercise absent; cardio Skipped present — R20), AE7 (archived absent from index, renders by direct URL with marker — R2/R26), AE8 (fresh build: config tiles + empty trend + empty journal, no crash — R23/R25).

**Origin success criteria (carried forward):**

1. From the "Stats" nav, any exercise is reachable; a weighted exercise shows the chart (≥2 points) + journal, a non-weighted exercise shows the consistency view + journal, and every region shows a clear, non-broken empty state before sessions exist. → F1–F3; U4–U9.
2. On a seeded dev deploy the `/stats` index lists every exercise grouped by routine and each stats page renders config-derived tiles with empty trend/history — and **no stats code change is needed when the runner later lands**. The chart gains points when the runner commits progression decisions (`getProgressionsForExercise` is unfiltered by completion); the journal/consistency view gain history when sessions complete (`getSetLogsForExercise` scoped to `completedAt IS NOT NULL`). Both update automatically via the existing `revalidatePath` contract. → System-Wide Impact; U7/U8 verification.
3. The "Top set (planned)" / "Heaviest logged" split removes the misleading "Max weight" framing — nothing implies a PR the data does not support. → R9/R10; U3/U4.
4. `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` all pass. ⚠️ **Known deviation from this criterion:** the origin states "the only data-layer addition is the one new per-exercise set-log read." Planning found a **second** read is unavoidable — the detail page resolves an `exerciseId` to its exercise + parent routine name, and no single-exercise-by-id read exists today (research confirmed only `getRoutineWithExercises` keyed by routineId). `getExerciseWithRoutine` is therefore added alongside `getSetLogsForExercise` (see Key Technical Decisions). This is a forced technical necessity, not a scope expansion; all other existing helpers are reused exactly as the criterion intends. Surfaced here so it is a visible, reviewable deviation rather than a silent drop.
5. The next swole slice (per-routine detail, or the runner) starts without re-litigating the stats page: type handling, the index, empty-state behavior, and the journal shape are settled here. → the whole plan.

---

## Scope Boundaries

- **No per-routine detail page** (`/routines/[id]`). The other half of F4; a separate slice.
- **No runner.** This page only reads data the runner will produce. Stats render empty states until it lands.
- **No "Start session" / any CTA into the runner** from these pages. Empty states are informational only.
- **No editing** (starting weight / `manual_edit` belongs to routine-detail/edit, F5).
- **No exercise links on home** (R28). Home stays a launchpad.
- **No new theme tokens, no global CSS, no a11y audit** beyond reasonable tap targets and semantic HTML.
- **No analytics / per-view telemetry** beyond the existing `/metrics` Prometheus surface.
- **No cross-exercise or aggregate dashboards** (total volume, weekly summaries, calendar heatmaps, streaks).
- **No 1RM estimator, plate calculator, or body-weight tracking.**
- **No pagination of the journal in v1** (R21).

---

## Context & Research

### Relevant Code and Patterns

- **Structural template — swole home page** (`docs/plans/2026-05-27-002-feat-swole-home-page-plan.md`, and live `apps/swole/src/app/page.tsx`): the first server-component read surface — `export const dynamic = 'force-dynamic'`, parallel reads via `Promise.all`, an empty-state gate (`if (routines.length === 0 && !banner) return <EmptyState />`), and a single `'use client'` island (`RoutineCard`) inside an otherwise server page. **Mirror this shape exactly.**
- **ADR-001** (`apps/swole/docs/adr/001-data-flow.md`): reads go through named helpers in `src/db/*.ts` (each starts `import 'server-only'`); no inline Drizzle in pages, no client fetch, no React Query. Cache invalidation is `revalidatePath`/`revalidateTag` after server actions — **already wired**, so no stats-side cache plumbing is needed.
- **Data-layer reads to reuse as-is:**
  - `listRoutines({ includeArchived? })` (`src/db/routines.ts`) → `RoutineRow[]`, ordered `asc(name)` (R2 alphabetical).
  - `listExercisesForRoutine({ routineId, includeArchived? })` (`src/db/exercises.ts`) → `ExerciseRow[]`, ordered `asc(orderInRoutine)` (R2).
  - `getProgressionsForExercise({ exerciseId })` (`src/db/progressions.ts`) → `ProgressionRow[]`, ordered `asc(effectiveFrom), asc(id)` (R13 chart source). On a fresh build returns the single `initial` row → R15 low-data gate.
- **Templates for the two new reads:** `getSetLogsForSession` (`src/db/setLogs.ts:33` — single-table select, `import 'server-only'`, `Promise<Row[]>`) for the new set-log read; `listRecentCompletedSessions` (`src/db/sessions.ts`) for the `innerJoin(sessions/routines)` shape; the `sql<number>` aggregate idiom (`src/db/setLogs.ts:129`) if a SQL aggregate is ever preferred over in-page derivation.
- **`listRoutinesForHome`** (`src/db/routines.ts`) is the model for grouped, no-N+1 routine+exercise reads (bulk `inArray`, group in process) — note its **`inArray(col, [])` empty-array guard**; the index hits this on a fresh DB. Not directly reusable (it returns `exerciseCount`/`firstExercise`, not the full exercise list).
- **Pure formatters** (`src/lib/format.ts`): the exhaustive `switch (exercise.type)` idiom in `formatNextUpLine` / `formatBannerSubtitle`, the `Intl.DateTimeFormat` usage in `formatRecentSessionDate` (lines 101-113), and `formatTimeBasedDuration` / `formatCardioDuration`. New stats formatters live here and mirror these. **No weight formatter exists** (`@ X lb` is inlined) — add one.
- **Schema** (`src/db/schema.ts`): `EXERCISE_TYPES = ['weighted','bodyweight','time-based','cardio']` (hyphen in `time-based`); `SET_LOG_ACTIONS = ['Increment','Stay','Decrement','Complete','Hold','Done','Skipped','Failed']`; `PROGRESSION_REASONS = ['initial','session_progression','manual_edit']`. `set_logs` carries both `actualReps` and `actualDurationSeconds` (R19 time-based Failed uses the latter). `archivedAt` is a **nullable timestamp, not a boolean** (`isNull`/`isNotNull`). Row types from `src/db/types.ts`.
- **FSM** (`src/core/session-machine.ts`): `Failed` is two variants sharing `type:'Failed'` — `{ actualReps }` (weighted/bodyweight) vs `{ actualDuration }` (time-based); discriminate by exercise type. Type-dispatch logic must matrix-cover `Failed` in every type (the FSM doc's documented near-miss).
- **UI idioms to copy (no reusable primitive exists):** house card style `rounded-xl border bg-neutral-900/80 p-5`; the day-code badge className idiom in `RoutineCard.tsx:152-164` (closest to a type badge); the section-header "icon + uppercase tracking-wider label + flex-1 hairline" in `RecentSessionsStrip.tsx:14-21`; `EmptyState.tsx` layout (`flex flex-col items-center justify-center … text-center`) — copy its *layout*, drop the CTA for trend/journal empties (R23). Only **yoink's hand-rolled SVG donut** (`apps/yoink/src/app/(library)/storage/donut-chart.tsx`) is any kind of chart precedent — for house client-chart style, not a substitute for recharts.
- **`cns()`** from `@lilnas/utils/cns` (project CLAUDE.md mandates it for combining/conditional class names). Theme is MUI dark + `deepOrange`; Tailwind `theme.extend` is empty (stock utilities only — `bg-black`, `text-orange-400/500`, `border-neutral-800`, etc.). `<Button href>` renders a Next.js Link automatically (`MuiButtonBase.defaultProps.LinkComponent`).
- **Seed** (`apps/swole/scripts/seed-home.mjs`): creates 4 routines, 15 exercises **and** real history (5 completed sessions, set logs, `session_progression` rows — e.g. Bench Press 130→135→140). The fastest way to demo non-empty paths (multi-point chart, populated journal, AE3/R15).

### Institutional Learnings

- **`docs/plans/2026-05-27-002-feat-swole-home-page-plan.md`** — nearest sibling. Carry over: server page + single client island; first-class empty states (omit a region rather than render sad chrome); N+1 avoidance + `inArray([])` guard; and the explicit test posture — *"No page-level rendering tests; testing focuses on new pure formatters and new query functions."*
- **`docs/plans/2026-05-27-001-feat-swole-data-layer-plan.md`** — Drizzle + `:memory:` test conventions. ⚠️ Its proposed `src/db/queries/` + `src/db/mutations/` split **did not ship** — the live layout is flat per-table modules (`src/db/{routines,exercises,sessions,setLogs,progressions}.ts`). Follow the live layout.
- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — keep type-dispatch + derived-value rules in tested pure helpers with exhaustive `switch`; explicitly cover `Failed` (Success rate, `8/10` shortfall, "partial" markers).
- **`docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`** — governs *mutations*; this is read-only, so **do not** add transaction ceremony to the new reads.
- **No charting prior art exists anywhere in the monorepo.** Adding recharts is the first such integration — a `/ce-compound` writeup is warranted after this lands.

### External References

- **recharts compatibility (the one externally-verified risk):** recharts **3.x** rewrote internal state management and resolved the React-19 render failures that affected 2.x (which needed a `react-is` override workaround). Current stable is **v3.3.0**; it is React 19 / Next.js 16 compatible. Integration in the App Router is a plain `'use client'` wrapper + `<ResponsiveContainer width="100%" height={N}>` (explicit height required); no `dynamic(..., { ssr: false })` needed. Step line = `<Line type="stepAfter" … />`. (Sources: recharts npm/releases, 3.0 migration guide, React-19 issue #4558, Context7 recharts v3.3.0 docs.)

---

## Key Technical Decisions

- **Chart library: `recharts@^3.3.0`, rendered as a step line.** recharts is the PRD's first choice; 3.x is React-19/Next-16 compatible (de-risked in U1 before any chart code is written). Step rendering (`type="stepAfter"`) is more truthful than interpolation — starting weight *holds* until the next progression event. Alternatives rejected: `visx` (more wiring for one small chart), `@mui/x-charts` (heavier, less common for a single line), hand-rolled SVG (only worth it if recharts failed on React 19 — it does not).
- **Two new data-layer reads, not one.** The brainstorm anticipated one (the set-log read); the page also needs to resolve an `exerciseId` → exercise + parent routine name, and **no `getExercise`/`getExerciseWithRoutine` read exists today**. The alternative — a bare `getExerciseById` plus a separate `getRoutine` call for R6's parent-routine name — would still be two reads; `getExerciseWithRoutine` (one joined read) is the minimal correct choice. Add: (1) `getExerciseWithRoutine({ exerciseId, includeArchived })` → `{ exercise, routine } | null` (joins routines, `includeArchived` for R26, returns `null` for 404); (2) `getSetLogsForExercise({ exerciseId })` → set logs joined to their sessions.
- **All data-derived values are derived in-page from the single set-log read; no separate aggregate query.** "Heaviest logged" (R10), "Sessions performed"/"Last result"/"Success rate"/"Done/skipped" (R11), and the consistency markers (R14) all come from the rows `getSetLogsForExercise` already returns. At N=1 scale this is the cheapest correct path and avoids over-fetching. (Resolves origin deferred Q on R5/R10.)
- **"History" = completed sessions only (journal/counts/heaviest/consistency).** `getSetLogsForExercise` filters `sessions.completedAt IS NOT NULL`. This scopes the journal, consistency view, heaviest-logged, and all counts to completed sessions. R14 already says "completed session"; this extends the same rule to the journal and counts. ⚠️ This is a deliberate reading of R18's "every set ever logged" as "every set logged in a **completed** session." It only matters once the runner exists (the seed's one active session is the sole case today). **The weighted chart is intentionally NOT scoped to completed sessions** — `getProgressionsForExercise` reads the full progression series (`initial`, `session_progression`, `manual_edit`) as they are written. The chart and journal answer different questions by design: the chart shows "how has the weight evolved over time" while the journal shows "what did I do in completed sessions." `manual_edit` rows (null `sessionId`, written via the routine-edit surface F5) appear on the chart but never in the journal — this is correct and expected. **⚠️ `session_progression.effective_from` is stamped at progression-commit time** (`new Date()` via the schema default in `commitProgressionDecision`), not at `session.completedAt`. Only the seed sets it to `completedAt` manually. Chart x-axis spacing tuned against the seed will differ slightly from production runner behavior — deferred to implementation for chart-styling polish.
- **Pure logic in tested helpers; components are thin, untested glue.** Per the swole convention (no RTL/jsdom installed; pages/components are not unit-tested), all derivation, formatting, grouping, and the low-data gate live in `src/lib/format.ts` + a new `src/lib/stats.ts` and are unit-tested. The stats components/pages are presentational composition over those helpers. This is how the success criterion ("lint/type-check/test pass") is met without introducing page-test infra.
- **Header parent-routine name = plain text** (not an interim-404 link). It is an identity label, not a CTA; a dead link there reads worse than plain text. (The index empty-state CTA *does* link to `/routines/new` per R4 — navigational CTAs may interim-404; identity labels should not.) (Resolves origin deferred Q on R6.)
- **Consistency view is server-rendered** (a static marker strip); only the weighted chart is a client component (R17). (Resolves origin deferred Q on R14 — compact marker-per-session, oldest→newest, show all, no truncation in v1.)
- **New `formatJournalSessionDate` for journal group headers.** `formatRecentSessionDate` shows no year and is too terse for long history. Add a journal formatter (weekday + month + day, plus year when not the current year) in `format.ts`; keep `formatRecentSessionDate` for the home strip. (Resolves origin deferred Q on R18.)
- **Index = bulk-fetch + group in a `Map`, guarding `inArray([])`; skip empty routine groups.** A non-archived routine with zero non-archived exercises renders no group header. (Resolves origin deferred Q on R3 — name + type badge only, navigation surface; and R21 — no pagination in v1.)
- **Nav: add Stats entry only** (R27). `layout.tsx` currently has only the "Swole" brand in an `items-center` div. Change to `justify-between` and add a right-aligned "Stats" link matching the brand's `hover:text-orange-500` styling. The brand anchor already navigates home; a redundant "Home" link is not required by any stated requirement and is not added. (Resolves origin deferred Q on R27.)

---

## Open Questions

### Resolved During Planning

- Chart library / line-vs-step (origin R13) → `recharts@^3.3.0`, `type="stepAfter"`.
- Shape of the set-log read / heaviest-logged query-vs-derived (origin R5/R10) → one joined read scoped to completed sessions; all data-derived values derived in-page.
- Consistency-view visual + truncation (origin R14) → server-rendered strip of small filled dots/chips (badge idiom, orange `bg-orange-500` for hit/done, muted neutral `bg-neutral-700` for partial/skipped, `title` attribute = session date), oldest→newest, no truncation v1.
- Journal date format (origin R18) → new `formatJournalSessionDate` (with year on boundary); keep `formatRecentSessionDate` for home.
- Header routine-name link-vs-text (origin R6) → plain text.
- Nav placement (origin R27) → Stats link only, right-aligned (`justify-between`); brand anchor covers home navigation.
- Index row content (origin R3) → name + type badge only.
- Journal pagination (origin R21) → none in v1.
- **Second read needed** (discovered in research) → add `getExerciseWithRoutine` alongside the set-log read.

### Deferred to Implementation

- Exact recharts axis/tick/tooltip styling (dark-theme colors, tick density, dot visibility, mobile margins) — polish against a real seeded chart; the data contract (points by `effectiveFrom`, integer weight) is fixed.
- Whether the journal group header repeats the routine name (redundant — it is constant per stats page, already in the page header) or shows date only. Editorial; default to date-prominent.
- Exact tile-grid breakpoints / wrap behavior on the narrowest viewports — tune visually; the tile set per type is fixed by R8/R11.
- Whether `getSetLogsForExercise` warrants a dedicated `(exercise_id, …)` index. Default: no — N=1 scale, and the existing index is keyed on `session_id`. Revisit only if the journal query is ever slow.

---

## Output Structure

    apps/swole/src/
    ├── app/
    │   ├── layout.tsx                     # MODIFY — Stats nav entry (R27, R7)
    │   └── stats/
    │       ├── page.tsx                   # NEW — index /stats (R1–R4)
    │       └── [exerciseId]/
    │           └── page.tsx               # NEW — detail /stats/[exerciseId] (R5–R26)
    ├── components/
    │   └── stats/                         # NEW directory
    │       ├── ExerciseTypeBadge.tsx      # NEW — type badge (R3, R6)
    │       ├── StatTile.tsx               # NEW — single tile primitive
    │       ├── SummaryHeader.tsx          # NEW — identity + type-aware tiles (R6–R12, R24, R26)
    │       ├── TrendRegion.tsx            # NEW — type dispatch + low-data gates (R13–R17, R23, R25)
    │       ├── WeightTrendChart.tsx       # NEW — 'use client' recharts step line (R13, R17)
    │       ├── ConsistencyView.tsx        # NEW — server marker strip (R14, R16, R23)
    │       └── HistoryJournal.tsx         # NEW — session-grouped set log (R18–R22, R23)
    ├── db/
    │   ├── exercises.ts                   # MODIFY — getExerciseWithRoutine (R5, R26)
    │   ├── setLogs.ts                     # MODIFY — getSetLogsForExercise (R5, R20)
    │   └── __tests__/
    │       ├── exercises.spec.ts          # MODIFY — getExerciseWithRoutine cases
    │       └── setLogs.spec.ts            # MODIFY — getSetLogsForExercise cases
    └── lib/
        ├── format.ts                      # MODIFY — set-row + journal-date formatters (R9, R18, R19)
        ├── stats.ts                       # NEW — derivations / grouping / gating (R9–R16)
        └── __tests__/
            ├── format.spec.ts             # MODIFY — new formatter cases
            └── stats.spec.ts              # NEW — derivation/grouping/gate cases

> The per-unit `**Files:**` lists are authoritative; this tree is a scope sketch.
> Display strings and date formatters belong in `format.ts` (its file comment reads
> "Pure display-formatting helpers"); derivations, grouping, and gating belong in
> `stats.ts`. This keeps each module cohesive — compute stays separate from display.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review,
> not implementation specification. The implementing agent should treat it as
> context, not code to reproduce.*

**Data flow (detail page).** The page is a server component. It runs three reads
in parallel and passes already-narrowed, serializable props down to server
sub-components; the only client island is the chart, which receives a plain
`{ date, weight }[]` array:

```
/stats/[exerciseId]/page.tsx  (server, force-dynamic)
   │  Promise.all:
   │    getExerciseWithRoutine({ exerciseId, includeArchived: true })  ──▶ { exercise, routine } | null  (null → notFound())
   │    getProgressionsForExercise({ exerciseId })                     ──▶ ProgressionRow[]  (chart points)
   │    getSetLogsForExercise({ exerciseId })                          ──▶ { setLog, session }[]  (completed only)
   │
   ├─▶ <SummaryHeader exercise routine logs />   (server) — derives heaviest/last-result/success-rate/counts via src/lib/stats.ts
   ├─▶ <TrendRegion exercise progressions logs /> (server) — dispatch + low-data gate:
   │       weighted & ≥2 points ─▶ <WeightTrendChart points />  ('use client', recharts stepAfter)
   │       weighted & <2 points ─▶ empty state (R15/R23)
   │       non-weighted & ≥1 session ─▶ <ConsistencyView markers /> (server)
   │       non-weighted & 0 sessions ─▶ empty state (R16/R23)
   └─▶ <HistoryJournal exercise groups /> (server) — groups logs by session, newest-first; empty state when none (R22/R23)
```

The **low-data gate is decided server-side** (`shouldRenderWeightChart(points)`),
so a degenerate one-point chart is never shipped to the client (R15/R25).

**Type × region matrix** — what each region renders per exercise type, populated vs. empty:

| Region | weighted | bodyweight | time-based | cardio |
|---|---|---|---|---|
| **Hero tile** | Current starting weight | Sets × target reps | Sets × target duration | Target duration |
| **Other tiles** | Increment · Sets×reps · Top set (planned) · Heaviest logged | Sessions performed · Last result | Sessions performed · Success rate | Done / skipped count |
| **Trend (data)** | Step-line chart of starting weight over time (≥2 points) | Consistency strip: hit / partial per session | Consistency strip: hit / partial per session | Consistency strip: done / skipped per session |
| **Trend (empty)** | "Your weight progression will chart here after a couple of sessions" (<2 points) | "Your session history will appear here once you complete a workout" (0 sessions) | same as bodyweight | same as bodyweight |
| **Journal row** | `Set N — W × reps · action` (shortfall `8/10`) | `Set N — actual/target · action` | `Set N — duration · action` (actual when Failed) | single row: `duration · Done\|Skipped` |
| **Journal (empty)** | "No sets logged yet." | same | same | same |

Config-derived cells always render (R24); data-derived cells degrade to `—`/`0` (R12/R24).

---

## Implementation Units

- U1. **Add the recharts dependency and de-risk React 19 compatibility**

**Goal:** Add `recharts@^3.3.0` to swole and confirm it installs, type-checks, and renders under React 19 / Next 16 before any chart UI is built on it.

**Requirements:** R13, R17.

**Dependencies:** None.

**Files:**
- Modify: `apps/swole/package.json` (add `recharts: ^3.3.0` to `dependencies`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Approach:**
- Pin `^3.3.0` (3.x resolved the 2.x React-19 render failures).
- Run `pnpm install`. If pnpm surfaces a `react-is` peer warning, add `react-is` to `package.json` — it is an expected peer of recharts 3.x, not a compat regression.
- Confirm `pnpm --filter @lilnas/swole type-check` and `pnpm --filter @lilnas/swole build` pass with recharts present. This unit lands the dependency as an isolated, revertable step; the chart-render compatibility proof is part of U5.

**Patterns to follow:** Workspace dependency conventions in sibling `apps/*/package.json`; Turbo build caching.

**Test scenarios:**
- Test expectation: none — dependency addition. Verification is type-check + build only.

**Verification:**
- `pnpm --filter @lilnas/swole type-check` and `pnpm --filter @lilnas/swole build` pass with recharts present in `package.json`.
- No `react-is` peer error in the install output (or it is resolved by adding the peer).

---

- U2. **New data-layer reads: `getExerciseWithRoutine` + `getSetLogsForExercise`**

**Goal:** Provide the two reads the detail page needs — resolve an `exerciseId` to its exercise + parent routine (archived-aware), and fetch all of an exercise's set logs joined to their completed sessions, ordered for journal grouping.

**Requirements:** R5, R10, R18, R20, R26.

**Dependencies:** None (uses existing schema/types).

**Files:**
- Modify: `apps/swole/src/db/exercises.ts` (add `getExerciseWithRoutine`)
- Modify: `apps/swole/src/db/setLogs.ts` (add `getSetLogsForExercise`)
- Test: `apps/swole/src/db/__tests__/exercises.spec.ts` (extend)
- Test: `apps/swole/src/db/__tests__/setLogs.spec.ts` (extend)

**Approach:**
- `getExerciseWithRoutine({ exerciseId, includeArchived }): Promise<{ exercise: ExerciseRow; routine: RoutineRow } | null>` — `innerJoin(routines, eq(exercises.routineId, routines.id))`, filter by `exercises.id`. When `includeArchived` is false (default), exclude archived (`isNull(exercises.archivedAt)`); the detail page calls with `includeArchived: true` (R26). Return `null` when no row (page → `notFound()`).
- `getSetLogsForExercise({ exerciseId }): Promise<Array<{ setLog: SetLogRow; session: SessionRow }>>` — `innerJoin(sessions, eq(setLogs.sessionId, sessions.id))`, `where(and(eq(setLogs.exerciseId, …), isNotNull(sessions.completedAt)))`, `orderBy(desc(sessions.completedAt), desc(sessions.id), asc(setLogs.setNumber))`. The ordering yields render order directly (newest session first, sets ascending); in-page grouping preserves it.
- Both start `import 'server-only'`; both return `Promise<…>` per the data-layer convention. Routine name for the journal is constant per exercise (the exercise's parent), so the set-log read need not join routines.

**Execution note:** Add a failing test for the completed-sessions-only filter first — it is the load-bearing, easy-to-miss invariant.

**Patterns to follow:** `getSetLogsForSession` (`src/db/setLogs.ts:33`) for read shape; `listRecentCompletedSessions` (`src/db/sessions.ts`) for the join idiom; the `currentDb` + `jest.mock('src/db/client', () => ({ get db() { return currentDb } }))` + `createTestDb()` harness (template: `src/db/__tests__/progressions.spec.ts`, `setLogs.spec.ts`); seed via `db.insert(...).values(...).returning().get()`.

**Test scenarios:**
- Happy path — `getSetLogsForExercise` with logs across two completed sessions returns all rows, newest session first, sets within a session ascending by `set_number`.
- Edge case — exercise with no set logs returns `[]`.
- Edge case — logs that exist only in an **active** (`completedAt IS NULL`) session are excluded (completed-sessions-only rule).
- Edge case — two sessions with identical `completedAt` tiebreak deterministically by `session.id DESC`.
- Integration — `Covers AE6.` A session in which the exercise was jumped past (no `set_logs` row for it) does not appear in that exercise's results; a cardio set logged as `Skipped` in a completed session **does** appear.
- Happy path — `getExerciseWithRoutine` returns `{ exercise, routine }` with the correct parent routine for a valid id.
- Edge case — unknown `exerciseId` returns `null`.
- Edge case — `Covers AE7.` An archived exercise returns `null` with `includeArchived` false (default) and the row with `includeArchived: true`.

**Verification:**
- New specs pass under `pnpm --filter @lilnas/swole test`; the completed-sessions filter and archived behavior are explicitly asserted.

---

- U3. **Pure stats logic — derivations, grouping, gating, and per-type formatters**

**Goal:** Implement every computed value and formatted string the stats UI needs, as pure unit-tested functions, so the components stay thin presentational glue.

**Requirements:** R9, R10, R11, R12, R14, R15, R16, R18, R19, R24, R25.

**Dependencies:** None (operates on `src/db/types` row types + FSM `ExerciseType`).

**Files:**
- Create: `apps/swole/src/lib/stats.ts` (derivations / grouping / gating)
- Modify: `apps/swole/src/lib/format.ts` (set-row + journal-date formatters)
- Test: `apps/swole/src/lib/__tests__/stats.spec.ts` (new)
- Test: `apps/swole/src/lib/__tests__/format.spec.ts` (extend)

**Approach:**
- **`stats.ts` derivations:** `topSetPlanned(startingWeight, increment, sets)` = `startingWeight + increment × (sets − 1)` (R9); `heaviestLogged(logs)` = max non-null `weight`, else `null` (R10); `sessionsPerformed(logs)` = distinct completed session count; `lastResult(logs)` = actual reps of the most recent session, e.g. `[15,15,12]` (R11); `successRate(logs)` = share of logged sets `Hold` vs `Failed` for time-based (R11); `doneSkippedCount(logs)` for cardio (R11); `classifyConsistency(sessionLogs, type)` → `'hit' | 'partial' | 'done' | 'skipped'` (R14); `groupSetLogsBySession(rows)` preserving newest-first session order (R18); `shouldRenderWeightChart(points)` = `points.length >= 2` (R15) and `hasLoggedSession(logs)` (R16).
- **`format.ts` formatters:** per-type set-row strings (R19) — weighted `Set N — W × reps · action`; when `actual < target` the fraction `actual/target` is returned tagged for `text-orange-400` styling (the `8/10` "visually distinct" case from R19); bodyweight `Set N — actual/target · action`; time-based `Set N — duration · action` using `actualDurationSeconds` (not `durationSeconds`) when `Failed`; cardio `duration · Done|Skipped`. Add `formatWeight(w)` → `"${w} lb"` and `formatJournalSessionDate(at)` (weekday + month + day; append year when `at`'s year ≠ current year). Mirror the exhaustive `switch (type)` idiom of `formatNextUpLine`; matrix-cover `Failed` in every type.
- Keep helpers pure (no `'use client'`/`'server-only'`), consuming primitives or row types — never Drizzle query builders.

**Execution note:** Implement test-first — these functions are the feature's correctness core and each maps to an acceptance example.

**Patterns to follow:** `src/lib/format.ts` (`formatNextUpLine`, `formatBannerSubtitle`, `formatRecentSessionDate`, `formatTimeBasedDuration`, `formatCardioDuration`); `src/lib/__tests__/format.spec.ts` (which already references acceptance examples in its cases); FSM `Failed` two-variant handling (`src/core/session-machine.ts`).

**Test scenarios:**
- Happy path — `Covers AE1.` `topSetPlanned(105, 5, 3) === 115`.
- Happy path — `Covers AE2.` `heaviestLogged([])` → `null` (renders `—`); after logs at 100/105/105 → `105`.
- Edge case — `heaviestLogged` ignores null weights (non-weighted logs) and returns `null` when all weights are null.
- Happy path — `Covers AE5.` `lastResult` for a bodyweight exercise whose most recent session logged 15/15/12 → `"15 · 15 · 12"`.
- Happy path — `successRate` for time-based: 3 `Hold` of 4 logged sets (1 `Failed`) → `75%` (rounded).
- Edge case — `successRate` with zero logged sets → degrades (no division by zero).
- Happy path — `Covers AE3.` `shouldRenderWeightChart` is `false` for 0 and 1 points, `true` for ≥2.
- Happy path — `Covers AE4.` `classifyConsistency`: bodyweight/time-based session all `Hold`/`Complete` → `'hit'`; any `Failed` → `'partial'`; cardio `Done` → `'done'`, `Skipped` → `'skipped'`.
- Happy path — weighted row `Set 1 — 105 × 10 · Increment`; **shortfall** weighted `Failed` (actual 8 < target 10) renders `8/10` distinctly.
- Happy path — bodyweight row `Set 1 — 15/15 · Complete`; `Failed` → `12/15`.
- Happy path — `Covers AE4.` time-based row `Set 1 — 45s · Hold`; `Failed` shows **actual** duration, e.g. `30s · Failed`.
- Happy path — cardio row `30 min · Done` and `30 min · Skipped`.
- Edge case — `formatJournalSessionDate` appends the year for a prior-year date and omits it for a current-year date (year-boundary branch).
- Happy path — `groupSetLogsBySession` groups rows by session preserving newest-first session order with sets ascending within each group.

**Verification:**
- `stats.spec.ts` and the extended `format.spec.ts` pass; the AE-linked cases assert the exact strings/values in the acceptance examples.

---

- U4. **Summary header — identity line, type badge, type-aware tiles**

**Goal:** Render the exercise identity (name, type, parent routine, Archived marker) and the type-aware tile grid, hero tile per type, with data-derived tiles degrading to `—`/`0`.

**Requirements:** R6, R7, R8, R9, R10, R11, R12, R24, R26.

**Dependencies:** U3 (derivations/formatters).

**Files:**
- Create: `apps/swole/src/components/stats/ExerciseTypeBadge.tsx` (server)
- Create: `apps/swole/src/components/stats/StatTile.tsx` (server)
- Create: `apps/swole/src/components/stats/SummaryHeader.tsx` (server)

**Approach:**
- `ExerciseTypeBadge` maps `type` → label (`weighted`/`bodyweight`/`time-based`/`cardio`); all four variants use the neutral badge style (`bg-neutral-800 text-neutral-300 rounded-md px-2 py-0.5 text-xs font-medium`). The text label is the differentiator per R3 (navigation surface; no new tokens). Shared with the index (U8).
- `StatTile` is a presentational `{ label, value, hero? }` tile (house card idiom); the hero variant renders its value at a larger type size with `text-orange-500` accent (no new token — standard theme orange). Non-hero tiles render value at normal size/color. `value` accepts `—`/`0` for degraded data tiles.
- `SummaryHeader` chooses the tile set by `exercise.type` (exhaustive switch, mirroring the matrix), computes values via U3 helpers, renders the "Top set (planned)" label as planned/configured — **never** "Max weight" (R9). Parent routine name renders as **plain text** (decision). When `exercise.archivedAt != null`, render a small muted `Archived` badge (`bg-neutral-800 text-neutral-400 text-xs`) inline after the type badge on the header identity line (R26).

**Patterns to follow:** House card style `rounded-xl border bg-neutral-900/80 p-5`; `RoutineCard.tsx:152-164` badge idiom; `cns()` for conditional classes; exhaustive `switch (type)` from `format.ts`.

**Test scenarios:**
- Test expectation: none — presentational components. All value/label logic (top-set value, heaviest-logged `—`, last-result string, success-rate, hero selection) is unit-tested in U3 (AE1/AE2/AE5). The components only place tested values into tiles.

**Verification:**
- `Covers AE1, AE2.` On a seeded weighted exercise the header shows the starting-weight hero, `Top set (planned)` (never "Max weight"), and `Heaviest logged` as `—` with no logs / a real value with logs; type-check + lint pass.

---

- U5. **Trend region — weighted step-line chart (client) + consistency view (server) + low-data gates**

**Goal:** Render the type-aware trend: a recharts step-line chart for weighted (≥2 points), a server-rendered consistency strip for non-weighted (≥1 session), and the correct empty state otherwise — never a degenerate one-point chart.

**Requirements:** R13, R14, R15, R16, R17, R23, R25.

**Dependencies:** U1 (recharts), U3 (`shouldRenderWeightChart`, `hasLoggedSession`, `classifyConsistency`).

**Files:**
- Create: `apps/swole/src/components/stats/WeightTrendChart.tsx` (`'use client'`)
- Create: `apps/swole/src/components/stats/ConsistencyView.tsx` (server)
- Create: `apps/swole/src/components/stats/TrendRegion.tsx` (server)

**Approach:**
- `TrendRegion` (server) decides by type and applies the gate **server-side**: weighted → if `shouldRenderWeightChart(points)` render `<WeightTrendChart points />`, else the weighted empty state (R15/R23); non-weighted → if `hasLoggedSession(logs)` render `<ConsistencyView />`, else the non-weighted empty state (R16/R23). It maps progression rows to a serializable `{ date, weight }[]` before passing to the client island (no Date identity, no Drizzle rows across the boundary). Wrap the chart slot in a `min-h-[220px]` container so the space is reserved server-side before hydration — prevents layout shift (CLS) when the recharts island mounts.
- `WeightTrendChart` (`'use client'`): `<ResponsiveContainer width="100%" height={220}>` (220px default; tune visually against seeded data) + `<LineChart>` + `<Line type="stepAfter">`, dark-themed minimal axes/grid/tooltip. First step in U5 implementation: verify a minimal recharts `LineChart` renders with no React-19 console warnings before building the full component. Receives points as props; contains no data fetching.
- `ConsistencyView` (server): a compact strip of small filled dots/chips (badge idiom, `rounded-full w-3 h-3` or `rounded-md px-1.5 py-1`), one per completed session (oldest→newest). Orange (`bg-orange-500`) for hit/done, muted neutral (`bg-neutral-700`) for partial/skipped. Each marker's `title` attribute carries the session date for accessibility. No truncation in v1.
- Empty states are informational text only — **no CTA** (R23).

**Patterns to follow:** recharts v3.3.0 `LineChart`/`Line`/`ResponsiveContainer` (`type="stepAfter"`); the server→client island boundary used by `page.tsx`→`RoutineCard`; `EmptyState.tsx` layout (minus the CTA); yoink donut chart for house client-chart style.

**Test scenarios:**
- Test expectation: none — presentational. The gate (`shouldRenderWeightChart`) and marker classification (`classifyConsistency`) are unit-tested in U3 (`Covers AE3, AE4`). The components render tested outputs; recharts is verified via U1 + the page-level seed check.

**Verification:**
- `Covers AE3, AE8.` On a seeded weighted exercise with ≥2 progression points the step chart renders; with only the `initial` point the weighted empty state renders (no one-point chart). On a non-weighted exercise with no sessions the consistency empty state renders. No React-19 console/hydration warnings.

---

- U6. **History journal — session-grouped set log**

**Goal:** Render every logged set grouped by completed session, newest-first, with per-type row formatting and an empty state when no sets are logged.

**Requirements:** R18, R19, R20, R21, R22, R23.

**Dependencies:** U2 (`getSetLogsForExercise`), U3 (`groupSetLogsBySession`, set-row formatters, `formatJournalSessionDate`).

**Files:**
- Create: `apps/swole/src/components/stats/HistoryJournal.tsx` (server)

**Approach:**
- Receives the joined `{ setLog, session }[]` (already completed-only and ordered) + the exercise (for type-aware row formatting). Groups via `groupSetLogsBySession`; each group header shows `formatJournalSessionDate(session.completedAt)`; rows render through the U3 per-type formatters. The weighted shortfall fraction (`8/10`) renders in `text-orange-400` to signal the missed-reps case (R19 "visually distinct").
- Zero logged sets → a single informational empty state ("No sets logged yet.") — no header row, no empty table chrome (R22/R23). No pagination (R21).

**Patterns to follow:** `RecentSessionsStrip.tsx` (list-of-rows in a bordered/divided container + section header idiom); `cns()`.

**Test scenarios:**
- Test expectation: none — presentational. Grouping order and every per-type row string (incl. the `8/10` shortfall and time-based actual-duration `Failed`) are unit-tested in U3 (`Covers AE4`); the journal renders those tested outputs.

**Verification:**
- `Covers AE4, AE8.` On a seeded exercise the journal lists sessions newest-first with sets ascending and correct per-type rows; on a never-run exercise it shows only "No sets logged yet."

---

- U7. **Stats detail page `/stats/[exerciseId]`**

**Goal:** Compose the three regions into the server-rendered detail page, resolving the exercise (archived-aware), 404-ing on unknown ids, and reading all data in parallel.

**Requirements:** R5, R6, R7, R25, R26.

**Dependencies:** U2 (reads), U4 (header), U5 (trend), U6 (journal).

**Files:**
- Create: `apps/swole/src/app/stats/[exerciseId]/page.tsx` (server)

**Approach:**
- `export const dynamic = 'force-dynamic'`. Parse `exerciseId` from params; `Promise.all([getExerciseWithRoutine({ exerciseId, includeArchived: true }), getProgressionsForExercise({ exerciseId }), getSetLogsForExercise({ exerciseId })])`. If `getExerciseWithRoutine` returns `null`, call `notFound()`.
- Render `<SummaryHeader>` → `<TrendRegion>` → `<HistoryJournal>` inside the existing `layout.tsx` chrome, single-column with vertical gaps (mirror home's `flex flex-col gap-6 py-6`). `includeArchived: true` is what makes R26 (archived renders by direct URL) work.

**Patterns to follow:** `src/app/page.tsx` (`force-dynamic`, `Promise.all`, composition); Next.js `notFound()` for 404.

**Test scenarios:**
- Test expectation: none — server page (no page-test infra by swole convention). Data correctness is covered in U2; rendering is verified against the seed.

**Verification:**
- `Covers AE7, AE8.` `/stats/[id]` renders all three regions for a seeded exercise; a fresh-build (no history) exercise renders config tiles + empty trend + empty journal with no crash; an archived exercise's direct URL renders with the "Archived" marker; an unknown id 404s.

---

- U8. **Stats index page `/stats`**

**Goal:** Render the global exercise picker — every non-archived exercise grouped by routine, each row linking to its stats page — with an empty state when no exercises exist.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** U4 (`ExerciseTypeBadge`).

**Files:**
- Create: `apps/swole/src/app/stats/page.tsx` (server)

**Approach:**
- `export const dynamic = 'force-dynamic'`. Read `listRoutines()` (alphabetical), then fetch exercises per routine and group into a `Map` keyed by routine — bulk-fetch with `inArray(exercises.routineId, routineIds)` guarded against the empty-array case, or compose `listExercisesForRoutine` per routine (small N). Skip routines with zero non-archived exercises (no empty group header).
- Each routine renders a group header (routine name) + full-width MUI `<Button href={`/stats/${id}`} fullWidth>` rows (LinkComponent → Next Link via `MuiButtonBase.defaultProps.LinkComponent` in `theme.tsx`, consistent guaranteed tap target) showing name + `<ExerciseTypeBadge>` (R3). Archived exercises are excluded by the default list reads (R2).
- Zero non-archived exercises across all routines → centered empty state (headline + hint) with a `/routines/new` CTA (R4; interim-404 acceptable).

**Patterns to follow:** `src/app/page.tsx` (server page, empty-state gate, `force-dynamic`); `listRoutinesForHome` grouped-read pattern + its `inArray([])` guard; `EmptyState.tsx` (the index empty state keeps its CTA); `cns()`.

**Test scenarios:**
- Test expectation: none — server page. Grouping uses existing tested reads (`listRoutines`/`listExercisesForRoutine`); ordering/archived-exclusion are properties of those existing helpers.

**Verification:**
- `Covers AE7, F1.` On a seeded DB `/stats` lists every non-archived exercise grouped by routine (routines alphabetical, exercises by order), rows link to `/stats/[id]`, archived exercises are absent; with no exercises the empty state + `/routines/new` CTA renders.

---

- U9. **Nav: add "Stats" (and "Home") entry**

**Goal:** Add the canonical "Stats" nav entry to the app layout so the stats surface is reachable from anywhere.

**Requirements:** R7, R27, R28.

**Dependencies:** U8 (so the Stats link resolves rather than 404s at merge).

**Files:**
- Modify: `apps/swole/src/app/layout.tsx`

**Approach:**
- Change the nav's inner wrapper from `items-center` to `items-center justify-between` (`layout.tsx:36`); keep the "Swole" brand on the left and add a right-aligned "Stats" `<Link>` styled like the brand anchor (`hover:text-orange-500 active:text-orange-500 transition-colors`). The brand already navigates home — no "Home" link is added (R27 requires only Stats; a redundant Home link is unscoped). No changes to home's content links (R28).

**Patterns to follow:** Existing nav block (`layout.tsx:35-44`); the brand anchor's class list; `cns()` for any conditional classes.

**Test scenarios:**
- Test expectation: none — presentational layout change. Verified by navigation.

**Verification:**
- `Covers F1.` The "Stats" link appears in the nav on every page and routes to `/stats`; the brand navigates home as before; no other links are added or changed.

---

## System-Wide Impact

- **Interaction graph:** Read-only addition. Two new reads (`getExerciseWithRoutine`, `getSetLogsForExercise`) and one new route subtree (`/stats`, `/stats/[exerciseId]`). The only new client island is the chart (R17); everything else is server-rendered. The layout nav change (U9) is the only edit to a shared, every-page file — blast radius is the nav block only.
- **Error propagation:** Unknown `exerciseId` → `notFound()` (Next 404). The reads return `null`/`[]` rather than throwing for absent data, so empty/low-data states render rather than error pages (R25). No new server actions, so no new mutation error surface.
- **State lifecycle risks:** None new — read-only, no writes, no cache wiring. The existing `revalidatePath` contract already refreshes these pages once the runner writes logs/progressions (per ADR-001). **Chart/journal refresh independently by design:** chart points appear when progression decisions are committed (mid-session); journal/consistency entries appear when sessions complete. `manual_edit` progression rows (written via F5 editing) appear on the chart but never in the journal — intentional divergence, not a bug.
- **"History = completed sessions" invariant:** The completed-sessions filter in `getSetLogsForExercise` is the single point that scopes the journal, consistency view, heaviest-logged, and all counts. If the runner later needs in-progress sets shown anywhere, that is a deliberate change at this one query — flagged so it is not silently assumed.
- **API surface parity:** None — no exported APIs, env vars, or cross-repo contracts. The type badge and per-type formatting are internal.
- **Integration coverage:** The cross-layer behavior unit tests cannot prove (a server page composing three reads + a client chart under React 19) is covered by the seed-based manual verification in U5/U7/U8, consistent with swole's no-page-test convention.
- **Unchanged invariants:** Existing data-layer helpers, the home page, and all current routes are untouched except for the additive nav entry (U9). `formatRecentSessionDate` is preserved as-is for the home strip; the journal gets a separate formatter rather than changing the shared one.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| recharts incompatibility with React 19 / Next 16 (the one greenfield dependency) | Pin `^3.3.0` (3.x fixed the 2.x React-19 failures); **U1 isolates and verifies** the dependency before any chart UI is built on it. Hand-rolled SVG (yoink precedent) is a fallback if it regresses. |
| Per-exercise set-log query does not hit the existing index (keyed on `session_id`) | Accepted at N=1 single-user scale; flagged as a deferred "add an index only if slow" item. |
| Components are not unit-tested (no RTL/jsdom; swole convention) | All correctness logic is pushed into U2 (queries) and U3 (pure helpers), which **are** tested and AE-linked; components are thin glue. Page behavior is verified against the seed. |
| "History = completed sessions" deviates from a literal reading of R18 ("every set ever logged") | Deliberate, documented decision; aligns with R14's explicit "completed session" and the intent of a history surface. Only matters once the runner exists (one seeded active session today). Isolated to one query for easy revision. |
| Type-aware `Failed` handling missed in one branch (the FSM doc's documented near-miss) | U3 test scenarios explicitly cover `Failed` for every type (success rate, `8/10` shortfall, time-based actual-duration, "partial" markers); exhaustive `switch` over `type`. |
| Data layer (Survivor 3) assumed present on `jeremy/stats-page` | Confirmed in research — schema + `getProgressionsForExercise` / `listRoutines` / `listExercisesForRoutine` exist and are tested; only two additive reads are introduced. |

---

## Documentation / Operational Notes

- No runbook/ops changes — read-only feature behind the existing Traefik forward-auth; no new env vars, no new deploy surface (`deploy.yml` unchanged).
- After this lands, capture a `/ce-compound` learning on **"adding recharts to a Next.js 16 / React 19 server-component app in lilnas"** — it is the monorepo's first charting integration and the data-layer brainstorm already earmarked the first swole infra solutions entry.
- The dev demo path is `scripts/seed-home.mjs` (seeds routines + exercises **and** real history — multi-point charts and populated journals), which exercises both the populated and empty paths.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-28-swole-exercise-stats-requirements.md](docs/brainstorms/2026-05-28-swole-exercise-stats-requirements.md)
- Sibling plan (structural template): `docs/plans/2026-05-27-002-feat-swole-home-page-plan.md`
- Data-layer plan: `docs/plans/2026-05-27-001-feat-swole-data-layer-plan.md`
- ADR-001 (data flow): `apps/swole/docs/adr/001-data-flow.md`
- Learnings: `docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`, `docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`
- Key code: `apps/swole/src/app/{page,layout}.tsx`, `apps/swole/src/db/{setLogs,exercises,sessions,progressions,routines,schema,types}.ts`, `apps/swole/src/lib/format.ts`, `apps/swole/src/core/session-machine.ts`, `apps/swole/scripts/seed-home.mjs`
- recharts: npm `recharts@^3.3.0`, [3.0 migration guide](https://github.com/recharts/recharts/wiki/3.0-migration-guide), [React 19 issue #4558](https://github.com/recharts/recharts/issues/4558), Context7 `/recharts/recharts/v3.3.0`
