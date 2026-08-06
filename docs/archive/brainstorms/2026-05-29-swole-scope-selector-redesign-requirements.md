---
date: 2026-05-29
topic: swole-scope-selector-redesign
---

# Swole — Routine Scope Selector Redesign (Scalable Active/Archived Split)

## Problem Frame

The stats page's routine scope selector (`apps/swole/src/components/stats/ScopeSelector.tsx`) is a single flat MUI `Select`: "All routines" → active routines → an "Archived" subheader → every archived-with-history routine, all sorted alphabetically. This treats two opposite populations as peers:

- **Active routines** — a small, stable, frequently-switched set (typically 1–6).
- **Archived-with-history** — an unbounded, rarely-accessed, relevance-decaying tail.

Because the list is alphabetical, relevance and order are uncorrelated: a routine archived last week sits below a two-year-old one. On a phone, one-handed in the gym, the athlete scrolls past stale archived routines to reach today's. The control's height is a function of *lifetime* routine count, which only grows.

This redesign **splits the asymmetry**: active becomes an always-visible inline control whose size is bounded by active count; archived is demoted behind a single search-first picker defaulted to a recent slice. The design must win at the realistic scale (≈5–15 archived), not only the 200+ stress case — the same moves (recency-order, split, capped search) make the common case calmer too.

**Who is affected:** the single user (athlete) viewing training stats. **Why it matters:** the selector is touched on most stats visits, yet today it degrades as lifetime routine count grows even though the *useful* set stays tiny.

### Layout sketch

```
Inline control (always visible) — header row, beside the "Stats" heading

  [All]  [Push]  [Pull]  [Legs]              View archived (12)…
   ^ filled = selected            chips wrap to a 2nd line if needed

Archived deep-link state  (?routine=42, where 42 = archived "Push v1")

  [All]  [Push]  [Pull]  [Legs]  [⌁ Push v1]   View archived (12)…
                                  ^ spliced transient chip, muted
                                    "archived" style, selected
  (existing banner renders below: "Archived — viewing frozen history")

"View archived (12)…"  →  bottom-sheet Drawer

      ┌─────────────────────────────────────────┐
      │  🔍  Search archived routines             │  sticky, low
      ├─────────────────────────────────────────┤  (thumb reach)
      │  Push v1                         3w ago   │
      │  Cutting Block                   5w ago   │  ~10 most-recently
      │  PPL 2024                        May 19   │  -trained, no query;
      │  …                                        │  type for the rest
      └─────────────────────────────────────────┘
       dismiss: swipe-down · backdrop tap · Back/Esc
```

---

## Key Flows

- F1. Switch among active routines (the common case)
  - **Trigger:** Athlete on `/stats` wants a different active routine's stats.
  - **Actors:** User
  - **Steps:** Taps a routine chip in the always-visible rail → `router.replace('/stats?routine=<id>')` under `useTransition` (rail dims while pending) → page re-scopes.
  - **Outcome:** Scope is the chosen active routine; one tap, no menu-open, no scroll past archived.
  - **Covered by:** R1, R2, R14

- F2. Reach an archived routine via the search-first picker
  - **Trigger:** Athlete wants frozen history for an archived routine.
  - **Actors:** User
  - **Steps:** Taps "View archived (N)…" → bottom sheet opens with the ~10 most-recently-trained archived routines (recency-ordered, relative-day labels) → either taps one from the recent slice, or types to filter the full archived set → selects a routine → sheet closes, page navigates.
  - **Outcome:** Scope is the chosen archived routine; the inline rail splices it in as a selected chip (F3).
  - **Covered by:** R3, R4, R5, R6, R7, R8, R9, R10

- F3. Land on an archived-scoped URL (deep link / Back button)
  - **Trigger:** A `/stats?routine=<archived-id>` URL is opened directly, shared, or returned to via Back.
  - **Actors:** User
  - **Steps:** `resolveStatsScope` resolves to `{kind:'archived'}` (or fails safe to "All" if invalid/stale) → the inline rail splices the one archived routine in as a transient selected chip so the controlled value is valid → the "frozen history" banner renders below.
  - **Outcome:** The control faithfully reflects an archived scope without that routine living in the rail permanently. Tapping any other chip leaves and the spliced chip disappears.
  - **Covered by:** R10, R11, R15

---

## Requirements

**Active inline control**
- R1. Render an always-visible inline control: "All" (first chip; selected when nothing is scoped) followed by the active routines, as MUI `Chip`s — selected = filled (orange accent), unselected = outlined. One tap navigates; there is no menu-open step.
- R2. Chips wrap to additional lines as needed — no horizontal scroll, no off-edge hidden items. Active count is bounded (~1–6), so wrapping stays within ~2 lines in practice.

**Archived picker (search-first bottom sheet)**
- R3. A single trailing "View archived (N)…" affordance opens the picker, where N is the count of archived-with-history routines. The affordance is absent when that count is 0.
- R4. The picker is a bottom-sheet `Drawer` (mobile sheet), **archived-only** — it does not duplicate "All" or the active routines.
- R5. The sheet has a sticky, thumb-reachable search field and large touch-target rows.
- R6. With no query, the sheet shows a recency-capped default slice (~10 most-recently-trained archived routines). Typing filters across the full archived-with-history set, client-side and instant (no server-side search, no virtualization).
- R7. Each archived row shows the routine name and a muted relative-day "last trained" label via `formatRelativeDay` (`lib/format.ts`).
- R8. The sheet is dismissable by all of: swipe-down, backdrop tap, and Back/Esc. Selecting a routine navigates and closes the sheet.

**Ordering & labels**
- R9. Archived-with-history is ordered by last-trained date (`MAX(completedAt)`), newest-first — replacing today's alphabetical order. Active routines keep their current stable (alphabetical) order.

**Scope state, splice & render conditions**
- R10. Archived deep-link splice: when the current scope is an archived routine, splice that one routine into the inline control as a transient selected chip at the **end** of the rail, in a muted/"archived" style visually distinct from active selected chips. This preserves the exactly-one-selected invariant for an archived deep link.
- R11. The spliced archived chip exists only while that archived routine is the active scope; selecting any other chip navigates away and the spliced chip disappears on the next render.
- R12. Visibility — the table below governs when the selector renders and what is selected:

  | State | Renders? | Inline rail shows | Selected chip |
  |---|---|---|---|
  | 0 routines | No | — | — |
  | 1 active, 0 archived-w/-history | No | — | — |
  | ≥2 active, scope = All | Yes | All + active chips | All |
  | Active routine scoped | Yes | All + active chips | that routine |
  | Archived routine scoped | Yes | All + active chips + spliced archived chip | spliced chip |
  | 1 active + ≥1 archived-w/-history | Yes | All + the 1 active chip (+ View archived) | All (default) |

- R13. "All" aggregates active routines only; archived routines are excluded from the "All" rollup (unchanged from current data scoping in `getStatsIndexData`).

**Navigation & integration**
- R14. Selecting "All" navigates to `/stats`; selecting any routine navigates to `/stats?routine=<id>`. Navigation uses `router.replace` + `useTransition` with a pending (dimmed/disabled) state, as today. Scope stays URL-reflected and authoritative.
- R15. Scope resolution continues to fail safe via `resolveStatsScope`: invalid, stale, or archived-without-history ids fall back to "All". The existing archived "viewing frozen history" banner continues to render below the header for archived scope.

---

## Acceptance Examples

- AE1. **Covers R1, R13.** Given 3 active routines and no archived, when the page loads at `/stats`, the rail shows `All` (selected) · Push · Pull · Legs, and "All" reflects only those 3 active routines.
- AE2. **Covers R10, R11.** Given the user opens `/stats?routine=42` where 42 is archived-with-history ("Push v1"), when the page loads, the rail shows All + active chips plus a muted "Push v1" chip (selected) at the end; tapping "Pull" navigates to that active routine and the "Push v1" chip is gone on the next render.
- AE3. **Covers R6.** Given 40 archived-with-history routines, when the user opens the archived picker without typing, ~10 most-recently-trained are listed; typing "leg" filters to every archived routine matching "leg".
- AE4. **Covers R12.** Given exactly 1 active routine and 0 archived-with-history, when the stats page loads, the scope selector does not render; once a 2nd routine is created (or the 1st archived routine gains history) it appears.
- AE5. **Covers R9.** Given archived routines last trained "Yesterday", "3w ago", and "May 19", when the picker opens they are ordered newest-first with those relative-day labels.

---

## Success Criteria

- Switching to an active routine is one tap with no scrolling past archived, regardless of how many archived routines exist.
- Finding a specific archived routine takes a glance (recent slice) or a short type — never a long scroll.
- The inline control's height is a function of active count only; adding archived routines never grows or crowds it.
- Downstream-agent handoff is clean: a planner can implement without inventing interaction behavior — the two surfaces, the splice rule, the render/selection conditions (R12 table), the recency cap, and the archived ordering are specified; the data need (per-routine last-trained) and the fail-safe/banner integration are named.

---

## Scope Boundaries

- **No virtualization and no server-side/async search.** Client filtering of even 200 names is instant; the recency cap bounds the default view. (Virtualization only earns its cost past ~300 rendered options and conflicts with grouping; async search only past thousands.)
- **No generic/reusable picker primitive extracted in this change.** Build the archived picker well-factored but stats-local (`apps/swole/src/components/stats/`); extract a shared primitive when a second consumer (exercise picker / history filter) actually lands, designed against two real call sites.
- **No persisted/inferred default scope.** Cold-default stays "All" (survivor #6 is out for v1). Revisit only if the selector still feels over-touched after this ships.
- **No routine revisions/versioning** (the R8 upstream idea). That is a data-model change, not a selector change. It is the real upstream fix *only if* per-cycle routine minting proves to be the actual driver of large archived counts — worth its own brainstorm then, not bundled here.
- **Active-routine ordering is unchanged** (stays stable/alphabetical); recency reordering applies to archived only.
- **"All" semantics unchanged** (active-only rollup).

---

## Key Decisions

- **Active control = wrapping chip rail** (vs `ToggleButtonGroup`/segmented): most thumb-friendly; keeps all bounded active items visible without a hidden-scroll gotcha. Segmented degrades past ~4–5 on a narrow phone and doesn't scroll natively.
- **Archived picker = bottom-sheet `Drawer`** (vs inline `Autocomplete` / centered `Dialog`): one-handed gym use is the deciding lens — low thumb-reachable search field, big rows; avoids the iOS-autofill-overlay and cramped-popover problems of an anchored Autocomplete.
- **Archived splice = splice-in transient chip** (vs a separate overlay pill): compact, single mental model (one rail, one selected chip), preserves exactly-one-selected. The existing banner already explains "frozen history," so the chip need only be visually distinct.
- **Recency cap + search-first for archived** (Slack quick-switcher / zoxide pattern): bound the default view, search for the tail — list length stops mattering.
- **Recency-order archived** (ideation survivor #1): ordering encodes relevance; a cheap `MAX(completedAt)` aggregate following the existing `lastPerformedByExercise` pattern. Foundational — every other piece is better with it.
- **Hide the selector at 1 active + 0 archived-with-history:** a control with no real choice is noise.
- **Defer primitive extraction and default-scope persistence:** YAGNI / earn-the-abstraction; both are additive and reversible later.

---

## Dependencies / Assumptions

- **Per-routine last-trained date** (`MAX(completedAt)` per routine) must be added to the data layer for archived ordering (R9) and row labels (R7). Cheap aggregate, same pattern as the existing `lastPerformedByExercise` in `apps/swole/src/db/stats.ts`. (Exact return shape deferred to planning.)
- `formatRelativeDay` (`apps/swole/src/lib/format.ts`) already emits the relative-day labels ("Today" / "3d ago" / "2w ago" / "May 19"); reused as-is.
- `resolveStatsScope` / `StatsScope` (`apps/swole/src/lib/stats.ts`) already centralize param→scope and fail safe; reused as-is.
- `getStatsIndexData` already returns `activeRoutines` and `archivedWithHistory` separately and self-prunes archived to "≥1 completed session" — relied upon (verified).
- MUI 7.3.4 provides `Chip` and `Drawer`; Tailwind v4 + `cns()`; dark theme (neutral-900 surfaces, orange-500 accent). Available (verified in repo).
- Realistic archived N is small (≤~15 typically). 200 is a stress ceiling, not a steady state of this data model: routines are edited-in-place and soft-archived with no clone-on-edit (verified in the db layer), so the count grows only via deliberate create-and-train.

---

## Outstanding Questions

### Resolve Before Planning

- _(none — all product/interaction decisions are made.)_

### Deferred to Planning

- [Affects R9][Technical] Exact data-layer shape for per-routine last-trained — extend `getStatsIndexData`'s return vs a sibling helper; newest-first sort in SQL vs in a pure `lib/stats.ts` helper.
- [Affects R5, R8][Technical] MUI `Drawer` dismiss-path wiring (Back/Esc + swipe-down + backdrop) and focus / scroll-lock management on mobile.
- [Affects R10][Technical] The muted/"archived" chip styling tokens (fill, icon) so it reads as distinct-but-legible on the dark theme — without the opacity-contrast anti-pattern flagged in the ideation rejection list (R2).
- [Affects R3][Technical] Placement of the "View archived (N)…" affordance once the chip rail has wrapped (trailing inline vs its own line below the rail).
- [Affects R6][Needs research] Confirm the recency-cap number (~10) feels right against a realistic archived list; trivial to tune.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
