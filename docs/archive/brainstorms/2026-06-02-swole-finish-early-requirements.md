---
date: 2026-06-02
topic: swole-finish-early
---

# Swole — Finish a Session Early

## Problem Frame

The active-session runner can only reach the completion handoff after **every**
prescribed set is logged: the terminal "Finish session →" button (R23 of the
active-session brainstorm) appears only when `nextTarget` returns `null`. There
is no way to end a workout you didn't finish.

That brainstorm deliberately deferred this control — R18 and its Scope
Boundaries state "there is no abandon/discard control in this scope; leaving is
plain navigation, resumable via the banner." This brainstorm fills that gap.

Two facts from the codebase shape the whole design:

- **Progress is already durable.** Every set action persists immediately via
  `appendSetLog` (`apps/swole/src/components/session/SessionRunner.tsx`), so
  finishing early never needs to *save* anything — it only needs to *seal* the
  session.
- **The complete flow already handles partial sessions.** `classifyPostSession`
  (`apps/swole/src/core/session-machine.ts`) only emits progression for
  exercises with ≥1 logged set, and `CompleteRunner` auto-commits them. So an
  early finish can reuse the existing `/session/[id]/complete` handoff with no
  new completion or progression write path.

The user-visible gap today: if you leave mid-workout, the session stays active
(`completed_at IS NULL`) and — via the `one_active_session_per_routine` unique
index — **blocks starting that routine fresh**. The only escape is to resume and
log/skip every remaining set to reach the terminal card. "Finish early" gives a
two-tap exit that keeps what you did, advances the weights you earned, and
unblocks the routine.

---

## Key Flows

- F1. **Finish a workout early**
  - **Trigger:** Mid-session, after logging at least one set, the user has to leave and taps the top-bar **Finish** control.
  - **Actors:** The single lifter (one human actor).
  - **Steps:** A confirm sheet titled "Finish early?" shows a summary (exercises trained, total sets logged) and a one-line note that weights update only for trained exercises. The user taps "Finish session" → routes to the existing `/session/[id]/complete` handoff → progression auto-commits for trained exercises → `completeSession` seals the session → the "Session Complete" celebration shows → lands home.
  - **Outcome:** All logged sets are kept, trained exercises have advanced, untouched exercises are unchanged, the session is sealed, and the routine is immediately startable fresh.
  - **Escape path:** "Keep going" / dismiss closes the sheet with no write; the session stays active at the same set.
  - **Covered by:** R1, R4, R5, R7, R8, R10.

- F2. **No progress yet (gate)**
  - **Trigger:** A session with zero logged sets (e.g. opened by accident).
  - **Actors:** The single lifter.
  - **Steps:** The **Finish** control is unavailable (nothing to finish early). The user's only exit is the silent, resumable pause (`←`).
  - **Outcome:** No empty completed session is created. The accidental 0-set session remains active (its routine stays blocked) until a future discard path exists.
  - **Covered by:** R2.

---

## Requirements

**Entry point and visibility**

- R1. An always-visible **Finish** control sits in the top bar, far-right (after the drawer `≡` trigger), as a low-emphasis text button. It is present on the active runner screen, not behind a menu or drawer.
- R2. The control is unavailable until the session has ≥1 logged set. At zero logs there is nothing to finish early; the only exit is the resumable pause (`←`). Discarding a 0-set session is out of scope (see Scope Boundaries).
- R3. The control is visually distinct from and spatially separated from the per-set action grid (which lives in the bottom thumb-zone), so it cannot be mistaken for or mis-tapped as a set action such as `Failed` or the advance button.

**Confirm and progression preview**

- R4. Tapping **Finish** opens a confirm sheet titled "Finish early?" with a primary "Finish session" action and a secondary "Keep going" (dismiss). No session is sealed without this confirm — finishing early is irreversible (it auto-applies progression), unlike the reversible pause.
- R5. The confirm shows a summary: the count of exercises trained and total sets logged, plus a one-line note that progression applies only to trained exercises and untouched exercises are unchanged. This sheet is the user's only signal that weights will move, because progression auto-commits silently downstream.
- R6. "Keep going" / dismiss closes the sheet with no write and returns to the same active set; the session stays active.

**Finish behavior and handoff**

- R7. "Finish session" routes to the existing `/session/[id]/complete` handoff — the same destination as the terminal "Finish session →" button — which auto-commits post-session progression for trained exercises and seals the session via `completeSession`, then returns home. No new completion or progression write path is introduced.
- R8. Finishing early keeps every logged set; nothing is discarded or rolled back. Progression is derived from the logged sets exactly as in a normal finish (trained-exercises-only, via `classifyPostSession`). Remaining prescribed sets simply stay unlogged.
- R9. The top-bar **Finish** control and the terminal-state "Finish session →" button coexist and converge on the same `/complete` destination; reaching the natural end of a routine is unchanged.

**Consistency and copy**

- R10. After finishing early, the user sees the existing "Session Complete" celebration and lands on home — identical to a normal finish. There is no separate "finished early" screen or copy.
- R11. The control label reads "Finish" in every state (it stays accurate even when all sets happen to be logged); only the confirm title frames the action as "early".

---

## Acceptance Examples

- AE1. **Covers R7, R8.** Given a 5-exercise routine where the user logged sets for exercises 1–3 and none for 4–5, when they tap **Finish** → "Finish session", the 3 trained exercises advance per their logged sets (a weighted exercise whose last set was `Failed` holds its starting weight, per `classifyPostSession`), exercises 4–5 stay at their starting weight, the session is sealed, and the user lands home.
- AE2. **Covers R2.** Given a freshly started session with zero logged sets, the **Finish** control is unavailable; the user's only exit is `←` (pause), and no completed session is recorded.
- AE3. **Covers R4, R5, R6.** Given a session with 3 exercises trained and 7 sets logged, when the user taps **Finish**, the confirm reads "3 exercises · 7 sets logged" plus the progression one-liner; tapping "Keep going" dismisses it with no write and the user is back on the same set.

---

## Success Criteria

- A lifter who must leave mid-workout can close out in two taps (Finish → confirm), keep every logged set, have weights advance for the exercises they trained, and immediately start that routine fresh next time — without logging or skipping the remaining sets to reach the terminal card.
- The feature reuses `/session/[id]/complete`, `completeSession`, and `classifyPostSession` without modifying them and without adding a new completion or progression write path. The only new surface is the top-bar control plus the confirm sheet.
- `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` pass; the existing active-session and complete suites pass unchanged.

---

## Scope Boundaries

- No discard / abandon (the "Option 2" sibling). Finishing early always **keeps** logged sets and **applies** progression. A "close out without progression" path — and the ability to clear an accidental 0-set session that blocks its routine — is a separate future brainstorm.
- No change to the silent, resumable pause (`←`): it stays instant, no confirm, non-destructive (active-session R18).
- No new completion semantics. Same `completeSession` seal and same auto-committed progression as a normal finish. No "partial" flag or distinct session status in history; an early-finished session is just a completed session with fewer sets.
- No per-exercise weight-delta UI in the confirm — that is the post-session screen's job, and it auto-commits.
- No editing or bulk-skipping of remaining sets as part of finishing; unfinished sets remain unlogged.
- No rest timer, notes, analytics/telemetry beyond the existing `/metrics` surface, and no new theme tokens — consistent with prior swole scope.

---

## Key Decisions

- **Always-visible control, not a fork of the back arrow or a drawer-buried action.** Discoverability matters for a "had to leave" moment, and an always-present control preserves the instant, friction-free pause that the active-session brainstorm deliberately protected (R18). Placing it in the top bar (glance/reach zone) keeps it away from the bottom action grid where a mistap is costly.
- **Confirm-with-summary, because finishing early is irreversible.** It seals the session and auto-applies progression — unlike the reversible pause — so the prior anti-confirmation stance does not apply. Folding the summary into the confirm avoids a second surface.
- **Reuse the existing `/complete` handoff rather than a new early-finish path.** `/complete` already operates on whatever sets exist, so a partial finish needs no new write or progression logic; one completion path, one celebration.
- **Gate at ≥1 logged set rather than allowing empty completed sessions.** "Finish early but keep progress" presupposes progress exists; empty sessions would clutter history and stats. The accidental-empty-session escape is the discard problem, deferred.
- **Progression applies to trained exercises only.** Inherited from `classifyPostSession`, not re-decided here.

---

## Dependencies / Assumptions

- The complete flow (`apps/swole/src/app/session/[id]/complete/page.tsx`, `apps/swole/src/components/session/CompleteRunner.tsx`), `completeSession`, `commitProgressionDecision`, and `classifyPostSession` exist, are tested, and operate correctly on partial sessions. Verified in the working tree.
- Sets persist per-tap via `appendSetLog`, so finishing early needs no save step — only the seal. Verified in `apps/swole/src/components/session/SessionRunner.tsx` and `apps/swole/src/db/setLogs.ts`.
- Nothing downstream (stats, recent-sessions strip, history) requires a completed session to contain all prescribed sets; partial completed sessions are already representable. Verified in `apps/swole/src/db/sessions.ts` — `completeSession` only stamps `completedAt`, and reads filter on `completedAt IS NOT NULL`, never on set counts.
- Progression auto-commits silently downstream (a recent change removed the Case A prompt), so the confirm sheet is the user's only progression signal. Verified in `apps/swole/src/components/session/CompleteRunner.tsx`.
- The `one_active_session_per_routine` partial unique index means a sealed session immediately unblocks `startSession` for that routine. Verified in `apps/swole/src/db/schema.ts` and `apps/swole/src/db/sessions.ts`.

---

## Visual sketch

Top bar gains a far-right **Finish** control (active once ≥1 set is logged):

```
┌──────────────────────────────────────────────────┐
│ ←  Push Day      Ex 2/3 ▕▏   ↶   ≡   Finish       │  ← R1/R3
│                  ▰▰▰▰▱▱▱▱▱▱  (sets bar)            │
├──────────────────────────────────────────────────┤
│                  (current-set card unchanged)      │
│              ┌───────────┐ ┌───────────┐          │
│              │ ▲ Increment│ │ = Stay    │          │  ← action grid
│              └───────────┘ └───────────┘          │     (thumb-zone)
└──────────────────────────────────────────────────┘
```

Confirm sheet (R4/R5):

```
        ┌──────────────────────────────────┐
        │  Finish early?                    │
        │                                   │
        │  3 exercises · 7 sets logged      │  ← R5 summary
        │  Weights update for the exercises │
        │  you trained; the rest stay put.  │
        │                                   │
        │     [  Keep going  ] [ Finish ]   │  ← R6 / R4
        └──────────────────────────────────┘
```

---

## Outstanding Questions

### Resolve Before Planning

_None. All product and interaction decisions are settled._

### Deferred to Planning

- [Affects R1, R3][Technical] Exact top-bar layout at narrow mobile width with a 6th element — text button vs icon+label, and whether the routine name truncates further to make room. Decide against a real device width during implementation.
- [Affects R4][Technical] Confirm primitive (MUI `Dialog` vs bottom sheet / `SwipeableDrawer`) — align with the existing Failed sheet for consistency.
- [Affects R2][Technical] Whether the control is hidden entirely vs rendered disabled at zero sets; pick whichever reads less like a bug on first glance.
- [Affects R5][Editorial] Final confirm copy and exact summary phrasing; align with the "Session Complete" celebration's voice.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
