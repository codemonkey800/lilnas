---
date: 2026-05-29
topic: swole-scope-selector-scalability
focus: Make the stats-page routine scope selector (apps/swole/src/components/stats/ScopeSelector.tsx) scale as active + archived routines grow; identify the MUI component(s) that help. Includes a 200+ archived stress-test re-evaluation.
mode: repo-grounded
---

# Ideation: Swole — Routine Scope Selector Scalability

## Grounding Context (Codebase)

### Current state

`ScopeSelector.tsx` is a `'use client'` MUI `Select` (`size="small"`, `minWidth: 160`). It lists **"All routines" → active routines → an "Archived" `ListSubheader` → archived routines**, all in one flat menu. Selecting navigates via `router.replace('/stats?routine=<id>')` wrapped in `useTransition` (pending opacity); selecting "All" → `/stats`. Scope is URL-reflected (`?routine=<id>`, absent = all). Returns `null` when there are zero routines. The page body already shows a separate "Archived — viewing frozen history" banner when an archived routine is in scope.

### The asymmetry (the crux)

The two populations are opposites:

- **Active routines** = a small, stable, frequently-switched set (typically 1–6).
- **Archived-with-history** = an unbounded, rarely-accessed, relevance-decaying tail.

The single flat `Select` treats them as peers, which is why it doesn't scale.

### Data layer (`apps/swole/src/db/stats.ts`, server component, cheap reads)

`getStatsIndexData()` already returns `activeRoutines: RoutineRow[]` and `archivedWithHistory: RoutineRow[]` — and **already self-prunes** archived to routines with ≥1 completed session (routines archived without ever training don't appear). But **both lists are sorted alphabetically** (`asc(routines.name)`) — so relevance and order are uncorrelated; a routine archived last week sits below a two-year-old one. `RoutineRow` carries `id`, `name`, `days: DayCode[]`, `archivedAt`, `createdAt`, `updatedAt`. Per-routine last-trained date is a cheap `MAX(completedAt)` aggregate — the exact pattern already used for `lastPerformedByExercise`. `resolveStatsScope` centralizes param→typed-scope and fails safe to `all` on stale/invalid ids; `StatsScope = {kind:'all'} | {kind:'active';id} | {kind:'archived';id}`.

### How routines are minted (verified — shapes the 200+ question)

Routines are **edited in place** (`updateRoutine`) and **soft-archived** (`archiveRoutine` sets `archivedAt`). There is **no clone/duplicate action** and no per-edit tombstoning. New routine rows are only created by an explicit user "create routine". So the archived count grows only when the user deliberately creates and trains new routines — not as a side effect of editing.

### Conventions / constraints

- MUI 7.3.4 (`Autocomplete`, `Drawer`, `Dialog`, `ToggleButtonGroup`, `Chip` all available), React 19.2, Next 16.2 App Router. Tailwind v4, use `cns()`. **Mobile-first** (phone in the gym, one-handed). Dark theme (neutral-900 surfaces, orange-500 accent).
- Compute derivations in `lib/stats.ts` (pure, tested — `classifyTrend`, `resolveStatsScope`, etc.) / db helpers, not in JSX. `lib/format.ts` already has `formatRelativeDay` (emits "Today" / "3d ago" / "2w ago" / "May 19"). `db/types.ts` documents itself as the seam for a richer domain shape.
- The codebase favors pure tested helpers and batched, no-N+1 reads.

### External grounding (web research)

- **`Autocomplete` + `groupBy`** is MUI's canonical upgrade from a `Select` that outgrew ~10 items. Flat `Select` is an anti-pattern past ~10 items on mobile (multi-step, no type-to-filter, partial visibility).
- **Bound the default view, search for the tail:** Slack's quick-switcher caps the open list at 24 and requires a query for the rest (85ms→7ms after the change); zoxide makes cold directories search-only. Frecency (Firefox Places / Slack buckets) sinks stale items; add hysteresis only if reordering a small hot set.
- **Progressive disclosure of archived:** Linear keeps "Show archived" to a single toggle (excluded by default). Burying archived 3+ taps deep makes users treat it as deleted. Hevy/Strong move old programs out of the primary flow entirely.
- **Component fits:** Segmented control caps at 2–5 options. Bottom-sheet (`Drawer`/`Dialog`) is the mobile pattern for a picker needing search + grouping + variable length. `groupBy` + virtualization conflict architecturally; virtualization only earns its cost past ~300 simultaneously-rendered options; async/server search only past thousands.
- **Anti-patterns:** flat Select >10 on mobile; archived buried so deep it feels deleted; search-only with no browse path; frecency reshuffle without hysteresis; infinite-scroll dropdown on mobile.

### Prior art in repo

No UI/selector learning exists in `docs/solutions/` yet — this is a fresh decision and `/ce-compound` material once built (the first UI-layer learning). Adjacent: `docs/ideation/2026-05-29-swole-stats-index-overview-ideation.md` (the stats-page overview work that produced this selector, commits U6–U11).

## Ranked Ideas

A natural cheapest-scalable **v1 is #1 + #5**; the most durable target is **#1 + #2 + #3**; the smallest *searchable* upgrade is **#1 + #4**; **#6** composes with any. See the 200+ stress test below for how these re-rank under load.

### 1. Recency-order the archived tail + relative-day labels
**Description:** Stop sorting archived alphabetically. Derive last-trained date (`MAX(completedAt)` — the aggregate `getStatsIndexData` already runs for exercises), sort archived newest-first, append a muted recency label via the existing `formatRelativeDay`. Active stays alphabetical/stable.
**Rationale:** Cheapest fix and the literal answer to "older archived become less relevant" — the *ordering* now encodes relevance. No new component, ~one query + one sort key. Foundational: every idea below is better with it.
**Downsides:** Doesn't bound *length* — necessary but not sufficient at large N. Pair with #4 or #5 (and the recency cap from the stress test).
**Confidence:** 90%
**Complexity:** Low
**Status:** Unexplored

### 2. Split the asymmetry — active inline, archived behind an escape hatch  *(recommended brainstorm seed)*
**Description:** Render "All" + active routines as an always-visible inline control (`ToggleButtonGroup` or a `Chip` rail) — one tap, no menu-open, for the routines you actually switch between. Demote archived to a single trailing "View archived (N)…" affordance that opens a separate picker (→ #3). Critical mechanic: when the URL scopes to an archived routine, auto-splice just that one into the control so the controlled value stays valid.
**Rationale:** The primary control's height becomes a function of *active* count (bounded), not lifetime count (unbounded) — it structurally can't grow. Matches the data asymmetry exactly and kills "scroll past archived to reach today's routine" on a phone.
**Downsides:** Biggest interaction-model change of the cheap options. Needs a graceful answer when active count creeps up (horizontal scroll). The auto-splice edge case must be handled.
**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

### 3. Mobile bottom-sheet picker (`Drawer`/`Dialog`) with search
**Description:** Replace the cramped anchored `Select` popover with a full-height bottom `Drawer` (or `Dialog`): sticky search field, grouped Active/Archived list, large thumb-sized rows. This is where #2's "View archived" leads and the mobile-correct host for search.
**Rationale:** Flat `Select` is a known anti-pattern past ~10 items on mobile. NN/g + Material point to bottom sheets for selection tasks needing more room — the difference between fighting the control with gym fingers and a calm pick.
**Downsides:** Most UI to build of the survivors. Bottom-sheet pitfalls (swipe-only dismissal, no Back-button support) to avoid. Heavy if the active set is genuinely tiny.
**Confidence:** 75%
**Complexity:** Medium
**Status:** Unexplored

### 4. Drop-in: `Select` → MUI `Autocomplete` + `groupBy` + type-to-filter  *(the literal "MUI component" answer)*
**Description:** Swap `Select` for `Autocomplete` with `groupBy` (Active/Archived) and `renderOption` showing the #1 recency label. Type three letters, the list collapses to matches. The `router.replace` + `useTransition` glue is reused verbatim.
**Rationale:** MUI's *designed* escalation path for a `Select` that outgrew ~10 items, and the most drop-in fix — search makes list length stop mattering.
**Downsides:** Keeps one combined control (doesn't exploit the asymmetry like #2). `groupBy` needs options pre-sorted on the group key (handled by #1). Search-first is slightly worse than chips for the *frequent* 3-routine switch. iOS autofill can overlay the panel (known workaround).
**Confidence:** 85%
**Complexity:** Low–Medium
**Status:** Unexplored

### 5. Collapse archived behind a "Show N archived" toggle
**Description:** Keep the `Select`, but render active + "All" immediately and the archived group collapsed behind one "Show N archived" row (Linear's pattern), recency-ordered when revealed.
**Rationale:** Lightest middle ground — bounds the default visible list to the active set while keeping archived one tap away (not buried so deep it feels deleted). Almost no new surface area.
**Downsides:** Still a `Select` menu underneath, so the *revealed* list can still get long with no search — **breaks down at large N** (see stress test). Best at ≤~30 archived.
**Confidence:** 80% (at small N) / low at large N
**Complexity:** Low
**Status:** Unexplored

### 6. Reduce how often the selector is touched — persist / infer default scope  *(orthogonal)*
**Description:** Don't cold-default `/stats` to "All". Infer the most-recently-trained active routine, or persist the last-viewed scope (cookie/localStorage; the URL is already the source of truth). The selector then mostly *confirms* rather than re-navigates.
**Rationale:** Reframes the problem — a control opened weekly tolerates being long; the real cost is reckoning with it every visit. Stacks on any other survivor.
**Downsides:** Doesn't shrink the list. Inferred defaults can surprise ("why did it open on Leg Day?"). Needs a safe fallback when the persisted routine was deleted (`resolveStatsScope` already fails safe).
**Confidence:** 70%
**Complexity:** Low–Medium
**Status:** Unexplored

### 7. Command-palette escape hatch — "Find a routine…"  *(bold, future-proof)*
**Description:** Tiny inline control for the hot set + a searchable palette (`Dialog`/`Drawer`, touch-first) that materializes only on query and absorbs unbounded growth. Axis-agnostic — later could jump to exercises or training blocks.
**Rationale:** The canonical answer to "a control that must stay small but occasionally address an unbounded set," and it future-proofs against the other scope axes the prior stats ideation floated.
**Downsides:** Most net-new infrastructure (no command primitive in swole today). Overkill for the realistic routine count. Must pair with a browse path.
**Confidence:** 60%
**Complexity:** Medium–High
**Status:** Unexplored

**Cross-cutting:** whichever wins, build it as a reusable grouped/recency **picker primitive** — exercise pickers and history filters are coming, and there's no shared picker today.

## Stress test: 200+ archived routines

**Premise check (grounded):** routines are edited in place and soft-archived, with no clone-on-edit. Reaching 200 archived-with-history requires manually creating *and training* 200 distinct routines (~one new trained-then-retired routine every couple weeks for a decade). That's not a steady state this data model produces by itself — it only arises if the user **mints a fresh routine per mesocycle** instead of editing the existing one.

So there's a fork:

- **If 200 is a worst-case stress test** → design for it cheaply (below); don't over-engineer.
- **If 200 is the real trajectory** (per-cycle minting) → the better fix is **upstream**: a routine **"revisions/versions"** concept so "Push Day v1…v14" collapses into one entry that expands, rather than 14 peers in any picker. Building a 200-item picker for data that should be ~15 grouped entries solves the wrong layer. (Captured as R8 — worth its own brainstorm if this is the real usage.)

**The principle at scale:** bound the default view to a recent slice; make the long tail **search-only** (Slack quick-switcher / zoxide). Against that bar the survivors re-rank:

| Idea | At 200+ | Verdict |
|------|---------|---------|
| #2 split (active inline, archived behind hatch) | Primary control shows only active (1–6); archived count can't bloat it | **Backbone** |
| #4 Autocomplete + type-to-filter | Type → 200 collapses to matches; cap the no-query view to recent-N | **Best find-one** |
| #3 Drawer + search | Holds *with* search; browse-only 200-row sheet does not | Holds if search-first |
| #1 recency-order + labels | Floats recent up, but 200 sorted items is still 200 to scroll | Necessary, not sufficient |
| #5 "Show 200 archived" toggle | Reveals a 200-row menu, no search — recreates the problem | **Breaks** (≤~30 only) |
| #7 command palette | Designed-for-unbounded; shines here; what you'd reach for at 2,000 | Holds, heaviest |
| #6 persist/infer default | Doesn't help find-one-of-200, but you rarely go looking | Orthogonal |

**Sharpened recommendation at scale:** #2 (keep archived out of the primary control) + a **search-first archived picker** (#4 inline, or #3 as a sheet) + a **recency cap** ("show ~10 most-recent archived, type to reach the rest"; #1 is the ordering inside that capped slice). #5 drops out; #7 is the same idea at its limit.

**Don't over-engineer the number:** 200 needs **no virtualization and no server-side search**. 200 rows is nothing for SQLite, ~200 names ship trivially, client-side filtering 200 strings is instant, and MUI `Autocomplete` renders 200 grouped options fine. Virtualization only earns its complexity (and its `groupBy` conflict) past ~300 simultaneously-rendered options; async/server search only past thousands. The capped-default-view trick sidesteps even that.

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| R1 | Virtualize the option list (react-window / TanStack) | Overkill at personal-app scale; `groupBy` + virtualization conflict in MUI. Hedge only, past ~300 rendered options. |
| R2 | Dim old archived items by opacity ("temperature") | Contrast/a11y anti-pattern on the dark theme; #1's ordering demotes them without hurting readability. |
| R3 | Full frecency scoring + hysteresis on the active list | Active is 1–6 stable items; keeping it alphabetical avoids the reshuffle hysteresis exists to fix. |
| R4 | Per-user LRU "working set" promotion of archived | Needs new state + eviction; recency-sort (#1) gets ~90% of the value far cheaper. |
| R5 | Reframe scope to date-range / training-block | A different feature (page already has internal time windows); doesn't replace routine-scoping. Brainstorm seed. |
| R6 | URL-codec / render-as-links refactors | Good code-quality cleanups but adjacent to scalability — belong in the plan, not as ideas. |
| R7 | Remove the selector entirely; scope by tapping routine sections | Too radical; kills the quick-switch the active set needs. Variant of #2 minus the inline control. |
| R8 | Routine revisions/versioning to collapse a 200-item tail | Not rejected on merit — it's the *upstream* fix if per-cycle minting is the real cause of 200+. Out of scope for a selector-only change; flagged for its own brainstorm. |
