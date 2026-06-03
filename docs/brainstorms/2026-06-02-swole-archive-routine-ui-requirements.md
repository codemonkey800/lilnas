---
date: 2026-06-02
topic: swole-archive-routine-ui
---

# Swole — Archived Routine Management (View, Restore, Delete)

## Problem Frame

Archiving a routine is currently a **one-way door**. The archive *write* path
is fully shipped — the home `RoutineCard` ⋮ menu has an "Archive…" item that
opens a confirm dialog and calls `archiveRoutine` (`apps/swole/src/db/routines.ts`,
`apps/swole/src/actions/routines.ts`), which sets `routines.archivedAt` and
refuses while an active session references the routine. But there is no way back:

- **No restore exists.** There is no `unarchiveRoutine` mutation or action
  anywhere — verified absent in `apps/swole/src/db/routines.ts` and
  `apps/swole/src/actions/routines.ts`. Yet the archive confirm dialog literally
  promises *"You can restore later from the routine page."*
  (`apps/swole/src/components/home/RoutineCard.tsx`) — an unfulfillable promise.
- **The "routine page" is a dead end for archived routines.** `/routines/[id]`
  redirects any archived routine back to home
  (`apps/swole/src/app/routines/[id]/page.tsx:27`).
- **Zero-history archived routines are invisible.** The only place an archived
  routine surfaces today is the stats scope picker
  (`apps/swole/src/components/stats/ArchivedRoutinePicker.tsx`), which lists
  *archived-with-history only*, read-only, to view "frozen" stats. An archived
  routine with no completed sessions appears in **no surface at all** and cannot
  be recovered or removed.

This was a deliberate deferral: the routine-edit brainstorm states *"No editing
or restoring an archived routine. `/routines/[id]` for an archived routine is
treated as not-available"* (`2026-05-29-swole-routine-edit-requirements.md:149`).
This brainstorm fills that gap — it makes archive reversible and gives archived
routines a home where they can be viewed, restored, or (for junk routines)
permanently deleted.

The single highest-leverage outcome is **reversibility**: without it, the
existing Archive button is mildly dangerous (a mis-tap hides a routine forever).
Everything else here is in service of that.

---

## Key Flows

- F1. **Restore an archived routine**
  - **Trigger:** A routine was archived by mistake, or a retired routine is
    coming back into rotation. The single lifter wants it active again.
  - **Steps:** Home shows an "Archived routines (N)" link near "+ New Routine" →
    tap it → the `/routines/archived` list → either tap **Restore** inline on the
    row, **or** tap the row → read-only detail → **Restore**. No confirmation; a
    toast confirms ("Restored {name}").
  - **Outcome:** `archivedAt` is cleared; the routine reappears on home and
    rejoins active stats scope. If it was the last archived routine, the home
    "Archived routines" link disappears.
  - **Covered by:** R1, R2, R9, R10, R11, R16.

- F2. **Browse an archived routine's frozen config**
  - **Trigger:** The lifter wants to recall what a retired routine contained
    without bringing it back.
  - **Steps:** Archived list → tap a row → read-only detail showing schedule and
    exercises with their config. If the routine has completed history, a "View
    stats" link leads to the existing `/stats?routine=<id>` frozen-history view.
  - **Outcome:** Full recall of the routine's shape (and stats, if any) with no
    state change; the routine stays archived.
  - **Covered by:** R5, R6, R7.

- F3. **Permanently delete a junk routine**
  - **Trigger:** A routine created by mistake (no completed sessions) is
    cluttering the archived list.
  - **Steps:** Archived list → tap the row → detail → **Delete** (enabled because
    the routine has zero completed sessions) → confirm dialog "Delete {name}?
    This can't be undone." → confirm → routine and its exercises are removed →
    toast → back to the list.
  - **Outcome:** The routine is gone permanently. Because it had no completed
    sessions, it had no set logs and never appeared in stats, so nothing else is
    affected.
  - **Covered by:** R12, R13, R14, R15.

- F4. **Delete is gated for a routine with history**
  - **Trigger:** The lifter opens the detail of an archived routine that *does*
    have completed sessions and looks for a way to remove it.
  - **Steps:** On the detail, **Delete** is disabled (or hidden) with a one-line
    reason that logged history can't be deleted. **Restore** remains available.
  - **Outcome:** History is preserved; the routine stays archived (or can be
    restored). There is no hard-delete path for history-bearing routines.
  - **Covered by:** R12.

---

## Requirements

**Entry point and the archived list**

- R1. Home shows an "Archived routines (N)" link near the existing "+ New
  Routine" button, where N = the **total** count of archived routines (with or
  without history). The link is absent when N = 0.
- R2. The link opens a dedicated `/routines/archived` page listing **all**
  archived routines, including those with zero completed sessions (which today
  surface nowhere).
- R3. The list is ordered newest-first by last-trained date (reuse
  `orderArchivedByRecency`, `apps/swole/src/lib/stats.ts`); never-trained
  routines sort last.
- R4. Each row shows: routine name, a muted last-trained relative-day label (or
  "Never trained"), exercise count, and an inline **Restore** action. Tapping the
  row outside the Restore control opens the read-only detail.

**Read-only routine detail (archived)**

- R5. `/routines/[id]` for an archived routine renders a **read-only** view
  instead of redirecting to home (today it redirects,
  `apps/swole/src/app/routines/[id]/page.tsx:27`). Editing remains impossible for
  archived routines — there is no form, no save.
- R6. The detail shows: routine name + an "Archived" badge + an "archived
  {relative day}" line; read-only day pills (same tokens as the home card); and a
  read-only exercise list (name, type badge, and config summary — sets×reps@weight
  / duration), reusing the existing formatters.
- R7. When the routine has ≥1 completed session, the detail shows a "View stats"
  link to `/stats?routine=<id>` (the existing frozen-history view). The link is
  absent when the routine has no history.
- R8. **Restore** and **Delete** actions are pinned at the bottom of the detail.

**Restore**

- R9. Restore is **unconditional**: it clears `archivedAt` (routine returns to
  active). It is available inline on each list row (R4) and on the detail page
  (R8).
- R10. Restore needs **no confirmation**. On success it shows a toast ("Restored
  {name}") optimistically; the routine reappears on home and rejoins active stats
  scope. Re-archiving via the existing home-card control is the undo.
- R11. Restore needs no special-case handling: routine names are non-unique (no
  collision), an archived routine cannot have an active session (archive blocks
  it), and exercises individually removed during a prior edit stay archived —
  restore un-archives the *routine* only, not intentionally-removed exercises.

**Delete (permanent)**

- R12. Permanent delete is allowed **only** for archived routines with **zero
  completed sessions**. For routines with ≥1 completed session, Delete is disabled
  or hidden with a one-line reason; those stay archivable-only. (History rows are
  FK-protected with `onDelete: 'restrict'`.)
- R13. Delete lives **only on the detail page**, never inline on list rows — the
  irreversible action requires landing on full context first.
- R14. Deleting a zero-history routine removes the routine and its exercises (and
  their initial progressions) permanently in one transaction; on success, a toast
  shows and the user returns to the archived list. Because such a routine has no
  completed sessions, it has no set logs and never appeared in stats, so deletion
  has no history or stats impact.
- R15. Delete requires a simple confirm dialog ("Delete {name}? This can't be
  undone."). No typed-name ceremony — there is no history to lose under R12.

**Empty states and consistency**

- R16. With zero archived routines, the home link is absent (R1) and direct-
  navigating to `/routines/archived` shows a plain "No archived routines" empty
  state. After the last archived routine is restored or deleted, the home link
  disappears (N → 0) and the page falls to that empty state.
- R17. The home "Archived routines (N)" (total count) and the stats "View
  archived (N)…" (history-only count) are intentionally distinct surfaces with
  distinct counts; the differing N is accepted, and the labels differ to reduce
  confusion.

---

## Acceptance Examples

- AE1. **Covers R2, R3, R4.** Given 3 archived routines — two with history (last
  trained "Yesterday" and "3w ago") and one never trained — when the user opens
  `/routines/archived`, all three are listed newest-first with the never-trained
  one last and labeled "Never trained"; each row shows its exercise count, an
  inline Restore control, and opens the detail when tapped elsewhere.
- AE2. **Covers R9, R10.** Given an archived routine, when the user taps Restore
  on its row, no confirm appears, a "Restored {name}" toast shows, the row leaves
  the archived list, and the routine reappears on home.
- AE3. **Covers R12, R13, R14, R15.** Given an archived routine with zero
  completed sessions, its detail's Delete is enabled; tapping it shows "Delete
  {name}? This can't be undone."; confirming removes the routine and its
  exercises and returns to the list.
- AE4. **Covers R12.** Given an archived routine with ≥1 completed session, its
  detail's Delete is disabled/hidden with a one-line reason; Restore remains
  available; there is no path to hard-delete it.
- AE5. **Covers R5, R6, R7.** Given an archived routine *with* history,
  `/routines/[id]` renders a read-only view (name, "Archived" badge, day pills,
  exercise list) plus a "View stats" link; given one *without* history, the same
  view renders minus the stats link; neither offers an edit form.
- AE6. **Covers R16.** Given exactly one archived routine, when the user restores
  it, the home "Archived routines" link disappears and `/routines/archived` shows
  "No archived routines".

---

## Success Criteria

- Archive is no longer a one-way door: a mis-archived routine is recoverable in
  ≤3 taps, and the archive dialog's "you can restore later" promise becomes true.
  Zero-history archived routines — invisible today — are now visible and either
  recoverable or removable.
- A junk routine created by mistake can be permanently removed without
  endangering any logged history; routines with history can never be
  hard-deleted, preserving the app's preserve-everything invariant.
- Downstream handoff is clean: planning can implement without re-deciding the
  delete scope (zero-history only), the restore semantics, the surfaces, or the
  action placement — only the named technical questions remain.
- `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` pass; existing
  routine, stats, and home suites pass unchanged.

---

## Scope Boundaries

- **No cascade delete of history-bearing routines.** Permanent delete is
  zero-completed-sessions only; routines with logged history stay archivable-only
  forever (archived is cheap). Nuking history is a separate, deliberate future
  decision, not a default.
- **No bulk actions** (multi-select restore/delete). One routine at a time.
- **No archived-exercise restore or management.** This is routine-level only;
  individually edit-removed exercises stay archived (the routine-edit brainstorm
  deferred exercise restore, and it remains deferred).
- **No editing an archived routine.** The detail is strictly read-only; to change
  one, restore it first, then edit via the existing flow.
- **No undo toast / soft-delete for permanent Delete.** The confirm dialog is the
  only guard — acceptable because R12 bounds delete to no-history routines.
- **No change to the existing stats archived picker** (history-only, view-only)
  or to the archive trigger on the home card.
- **No new theme tokens, rest timer, notes, or telemetry** beyond the existing
  `/metrics` surface — consistent with prior swole scope.

---

## Key Decisions

- **Block delete when history exists (vs cascade).** The whole app is built on
  preserving history — soft-archive everywhere, FK `restrict`, stats derived from
  set logs. The genuine need for *delete* is junk cleanup, which is exactly the
  zero-history case; bounding delete there keeps it safe and has zero stats
  impact. Cascade-deleting history would fight the app's design and is rejected.
- **Reuse `/routines/[id]` as the archived read-only detail (vs a new route).**
  It already owns "this routine," and the archive dialog already points users to
  "the routine page." We add a read-only branch where today there is a redirect.
- **Restore inline + unconfirmed; Delete detail-only + confirmed.** Asymmetric by
  design: the safe, common, reversible action is one tap and discoverable on the
  list; the irreversible action gets friction and demands full context first.
- **Include zero-history routines in the list (vs mirroring the stats picker).**
  This closes a real hole — today such routines are invisible and unrecoverable.
  The management list is intentionally broader than the history-only stats picker.
- **Distinct "Archived routines (N)" vs stats "View archived (N)…".** Different
  populations (all vs history-only) serving different jobs (manage vs view stats).
  Aligning them would either pollute stats with no-history routines or hide
  recoverable ones from management, so we keep them separate and label them
  differently.

---

## Dependencies / Assumptions

- The `routines.archivedAt` soft-archive column, the `archiveRoutine`
  mutation/action, and the home-card Archive trigger exist and work. Verified in
  `apps/swole/src/db/schema.ts`, `apps/swole/src/db/routines.ts`,
  `apps/swole/src/actions/routines.ts`, `apps/swole/src/components/home/RoutineCard.tsx`.
- No `unarchiveRoutine` or `deleteRoutine` exists today — both are net-new
  (data-layer mutation + server action with `revalidatePath`). Verified absent in
  `apps/swole/src/db/routines.ts` and `apps/swole/src/actions/routines.ts`.
- `/routines/[id]` currently redirects archived routines to home; this brainstorm
  changes that to a read-only branch. Verified in
  `apps/swole/src/app/routines/[id]/page.tsx:27`.
- `listRoutinesForHome` and the stats "All" rollup filter on
  `isNull(archivedAt)`, so restore/delete need only the existing
  `revalidatePath('/')` plus revalidation of the archived list to reflect
  correctly. Verified in `apps/swole/src/db/routines.ts` and
  `apps/swole/src/db/stats.ts`.
- The helpers `orderArchivedByRecency` and `formatRelativeDay` exist and are
  reusable for the list's ordering and labels. Verified in
  `apps/swole/src/lib/stats.ts` and `apps/swole/src/lib/format.ts`.
- The `exercises.routine_id` FK is `onDelete: 'restrict'`, and
  `set_logs`/`progressions` reference `exercises`/`sessions` with `restrict` —
  so a hard delete must remove children in dependency order within a transaction,
  and is only safe (no orphan, no aborted constraint) when the routine has no
  sessions (hence R12). Verified in `apps/swole/src/db/schema.ts`.
- Archiving a routine does **not** archive its exercises (only edit-remove does),
  so a restored routine returns with exactly its pre-archive non-archived
  exercises. Verified in `apps/swole/src/db/routines.ts` (`archiveRoutine` sets
  only `routines.archivedAt`).

---

## Visual sketch

Home gains a low-key entry point near "+ New Routine" (absent when N = 0):

```
┌───────────────── Home ─────────────────┐
│  [ Push ]   [ Pull ]   [ Legs ]         │  ← active routine cards
│  ┌───────────────────────────────────┐ │
│  │        + New Routine               │ │
│  └───────────────────────────────────┘ │
│            Archived routines (3)        │  ← R1 (hidden at 0)
└─────────────────────────────────────────┘
```

Archived list (`/routines/archived`), newest-first by last trained:

```
┌──────────── Archived routines ──────────┐
│  Push v1            Yesterday   5 ex  ⤺  │  ← R4 row + inline Restore
│  PPL Cut            3w ago      6 ex  ⤺  │
│  Test routine       Never trained 2 ex ⤺ │  ← R3 never-trained sorts last
└──────────────────────────────────────────┘
        (tap a row → read-only detail)
```

Read-only detail (`/routines/[id]` when archived):

```
┌──────────────────────────────────────────┐
│  Push v1            [ Archived ]           │  ← R6 badge
│  archived 2w ago                           │
│  [Mon] [Wed] [Fri]                         │  ← read-only day pills
│  ──────────────────────────────────────   │
│  Bench Press   weighted  3×5 @ 135 (+5)    │  ← read-only exercise list
│  Overhead Press weighted 3×5 @ 75 (+5)     │
│  …                                         │
│  View stats →                              │  ← R7 (only if has history)
│  ──────────────────────────────────────   │
│        [  Restore  ]      [ Delete ]       │  ← R8 (Delete disabled if history)
└──────────────────────────────────────────┘
```

---

## Outstanding Questions

### Resolve Before Planning

_None. All product and interaction decisions are settled._

### Deferred to Planning

- [Affects R5][Technical] How to branch `/routines/[id]` between the existing
  edit form and the new read-only archived view (in-place branch vs separate
  component), and the not-found behavior for a genuinely nonexistent id vs an
  archived one.
- [Affects R14][Technical] The exact `deleteRoutine` transaction: child-delete
  order (progressions → exercises → routine) and re-checking the zero-session
  invariant inside `BEGIN IMMEDIATE` to avoid a race with a concurrent
  `startSession` — mirror `archiveRoutine`'s in-transaction guard.
- [Affects R3][Technical] Tie-break ordering for never-trained routines (by
  `archivedAt` desc, `createdAt`, or name); `orderArchivedByRecency` currently
  sorts missing-last-trained last, then by name.
- [Affects R4, R9][Technical] The inline Restore affordance on a row (button vs
  ⋮ menu) so it doesn't fight the row's tap-to-detail target; align with the home
  card's interaction model.
- [Affects R1][Editorial] Final link copy and placement on home ("Archived
  routines (N)"), including whether it sits above or below "+ New Routine".
- [Affects R6][Technical] Whether to extract a shared read-only
  exercise-summary renderer from the existing card/stats formatters or inline it
  in the detail view.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
