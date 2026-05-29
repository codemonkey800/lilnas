---
date: 2026-05-28
topic: swole-exercise-catalog
---

# Swole — Exercise Catalog (Dropdown Picker)

## Problem Frame

The routine builder (shipped 2026-05-28) authors each exercise's name via a
free-text `TextField` (`apps/swole/src/components/routines/ExerciseCard.tsx:120`).
That brainstorm explicitly deferred this exact follow-up — its Scope Boundaries
read *"No exercise-name library or autocomplete; names are free text."* This
brainstorm un-defers it.

Free text has two costs. First, on mobile it is slow and error-prone — you type
"Cable High-to-Low Woodchoppers" by hand every time. Second, and less obvious,
it fragments names: "Pushups" vs "Push-Ups" vs "Push Ups" become three
different exercises, which will pollute any future cross-routine history or
stats keyed on `exercises.name`. Replacing the field with a curated, searchable,
**catalog-only** picker fixes both: fewer taps, and one canonical spelling per
movement.

The catalog content is seeded from Jeremy's existing Notion exercise doc plus a
curated set of common-movement additions (~100 exercises, weighted-heavy,
glute/hypertrophy-leaning). The change is purely additive to the builder: swap
one field, add one static data module. No schema, validation, or mutation change.

---

## Key Flows

- F1. **Pick an exercise from the grouped catalog**
  - **Trigger:** User adds or edits an exercise card and focuses the name field.
  - **Actors:** Jeremy (sole user).
  - **Steps:** The card's Type is already chosen (defaults `weighted`). The name field opens a dropdown of that type's catalog exercises, sectioned by muscle group with an icon per header. The user types to filter or scrolls a group, then taps an entry. For a time-based or cardio pick, the duration field is pre-filled with a sensible default if it was empty.
  - **Outcome:** The card's name is set to a canonical catalog name; the save gate re-evaluates. No free text was typed.
  - **Covered by:** R1, R2, R3, R4, R5, R11, R12.

- F2. **Attempt an exercise that isn't in the catalog**
  - **Trigger:** User types a movement that has no catalog entry (e.g. "Kettlebell Swing").
  - **Actors:** Jeremy.
  - **Steps:** The filtered list empties; the dropdown shows an inline "no matching exercise" notice. There is no free-text commit path, so the name stays unset.
  - **Outcome:** The card has no name, the save gate stays disabled, and the user either picks a real catalog entry or (later, in code) adds the movement to the catalog and redeploys.
  - **Covered by:** R1, R6.

---

## Requirements

**Input control**

- R1. The exercise name is entered via a searchable single-select combobox (MUI `Autocomplete`), replacing the free-text `TextField` at `apps/swole/src/components/routines/ExerciseCard.tsx:120`. Typing filters options; the field is **catalog-only** (`freeSolo` disabled) — a value that is not a catalog entry cannot be committed.
- R2. The option list is **filtered to the card's current type** — a `weighted` card shows only weighted entries, `cardio` only cardio entries, etc. (type-first; matches "common exercises for each type").
- R3. Options are **grouped by muscle group** with section headers inside the dropdown, ordered Legs/Glutes → Back → Chest → Shoulders → Arms → Core. Cardio renders as a single ungrouped list (muscle groups don't apply). Bodyweight and time-based use the same muscle-group sections where applicable.
- R4. Each group header shows a small **icon / visual marker** for fast scanning. (Exact glyph set is a design detail — see Outstanding Questions; emoji map cleanly to only some groups.)
- R5. Within each group, exercises are sorted **alphabetically**.
- R6. When the typed query matches no catalog entry, the dropdown shows an inline **no-match notice** (MUI `noOptionsText`), e.g. *"No matching exercise — add it to the catalog."* No toast; the notice is contextual to the field. This is the "notify the user" behavior for catalog-only entry.

**Catalog data**

- R7. The catalog is a **static module** (a plain TS constant, e.g. `apps/swole/src/lib/exercise-catalog.ts` — exact path is planning's call), not a database table. No schema change and no new dependency.
- R8. Each entry carries a **name** and a **muscle group** tag (drives R3 grouping). Names are canonical (one agreed spelling); an entry's *type* is implied by which type-list it appears in.
- R9. The catalog ships with the **agreed v1 contents** (see "Catalog Contents (v1)" below): Jeremy's Notion list plus curated common-movement additions, ~100 entries total, weighted-heavy.
- R10. An exercise may appear under more than one type (a movement done both weighted and bodyweight) by listing it in each type's set; the type filter (R2) keeps the two contexts distinct.

**Selection behavior**

- R11. Selecting an entry sets the card's **name** to that entry's canonical name.
- R12. Selecting a **time-based** or **cardio** entry pre-fills the **duration** field with a **type-level default** (time-based holds → 30 s; cardio → 20 min), respecting each type's input unit (time-based seconds, cardio minutes, per `apps/swole/src/lib/format.ts`), but **only when the duration field is currently empty**, so a value the user already typed is never clobbered. Weighted and bodyweight selections set only the name — the card already defaults sets 3 / reps 10 / increment 5 via `createEmptyCard`.
- R13. Changing a card's **type clears the exercise name**, because each type has its own catalog list and a name from the prior type's list must not carry over into a catalog-only field. This refines today's `applyTypeSwitch`, which preserves `name`.

**Persistence and validation**

- R14. The selected value persists exactly as today: `exercises.name` is the chosen name string. No schema, migration, mutation, or DB-layer change.
- R15. Catalog membership is a **UI-only gate**, not a data invariant. `exercises.name` stays free text at the DB level, so existing/seed rows and the future `/routines/[id]` edit page (which may load names not in the current catalog) keep working. The server continues to enforce only the existing `name` non-empty rule (builder R5/R14).

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R5.** On a weighted card, opening the name field shows catalog exercises sectioned Legs/Glutes → Back → Chest → Shoulders → Arms → Core, alphabetized within each section. Typing "row" narrows to Barbell Bent-Over Row, Dumbbell Rows, Seated Cable Rows, Seated Row Machine, T-Bar Row.
- AE2. **Covers R1, R6.** On a weighted card, typing "Kettlebell Swing" (not in the catalog) yields no selectable option and shows the inline "No matching exercise — add it to the catalog" notice; the card's name stays empty and `Create routine` stays disabled.
- AE3. **Covers R11, R12.** Selecting "Plank" on a time-based card sets name = "Plank" and, because duration was empty, sets duration = 30 (seconds). Selecting "Stairmaster" on a cardio card sets duration = 20 (minutes).
- AE4. **Covers R12.** A cardio card where the user already typed duration = 35 then selects "Rowing Machine": name updates to "Rowing Machine" but duration stays 35 — the default does not overwrite user input.
- AE5. **Covers R13.** A weighted card with name = "Hip Thrust" is switched to `cardio`: the name field clears and the dropdown now lists cardio options; the user must pick a cardio entry to re-fill it.
- AE6. **Covers R14, R15.** Saving a routine whose cards were all chosen from the catalog writes `exercises.name` values identical to the catalog names; no schema or validation path differs from the builder.

---

## Success Criteria

- **Human outcome:** Building a routine no longer requires typing exercise names — each exercise is a 1–2 tap pick from a grouped, searchable list, and names are consistent across routines (no "Pushups" vs "Push-Ups" drift).
- **Observable on a dev deploy:** Opening a new card's name field shows the grouped catalog filtered to the card's type; an off-catalog query is blocked with the inline notice; a time-based/cardio pick fills a sensible duration without clobbering typed input.
- **Downstream-agent handoff:** Planning can build this without re-deciding the input model, catalog shape/location, content, grouping, no-match behavior, duration-default rule, or type-switch behavior — all settled here, with the catalog contents enumerated below.
- **Quality gates:** `pnpm --filter @lilnas/swole lint`, `type-check`, and `test` pass. The updated `applyTypeSwitch` (name-clear) and any catalog/selection helpers have tests; the builder's existing suite still passes, with the `applyTypeSwitch` name-preservation assertion updated to the new clear-on-switch behavior.

---

## Scope Boundaries

- **No custom / free-text exercises.** If a movement isn't in the catalog it cannot be entered in the UI; it is added to `exercise-catalog.ts` and the app is redeployed. Deliberate — the broad catalog is the safety margin.
- No DB-backed or runtime-editable catalog, and no catalog-management UI.
- No self-growing catalog (union of past `exercises.name` values) — rejected because it would also resurface typos, and it needs a server read the builder avoids.
- No per-exercise sets / reps / increment defaults — only type-level **duration** defaults for time-based and cardio.
- No "recently used" / most-used ordering or pinned-recents cluster (needs usage data + a server read; out for v1).
- No assist-weight or machine-level/intensity tracking (assisted pull-ups, Stairmaster, Elliptical, etc. stay reps- or duration-only).
- No exercise metadata beyond name + muscle group — no equipment, description, images, primary/secondary muscles, or video links.
- No fuzzy/synonym matching or typo correction beyond MUI's default substring filter.
- No change to the four exercise types, the schema, the CHECK constraint, or the atomic-create mutation.
- No edit-page work; the future `/routines/[id]` page inherits this change for free via the shared form.
- No de-duplication/canonicalization of historical rows — catalog-only governs new selections, not past data.

---

## Key Decisions

- **Catalog-only searchable Autocomplete (not `freeSolo`).** Chosen over free-text-with-suggestions because the goal is consistent canonical names. The broad catalog (R9) is the escape valve, and a missing movement is a one-line code edit. Trade-off consciously accepted: you cannot invent an exercise mid-gym. (This reverses the session's earlier lean toward `freeSolo`.)
- **Static const over DB.** Single-user app with no runtime-editing need; matches the builder's no-table/no-deps posture. A self-growing DB or union-of-past-names was rejected — it would resurface typos and needs a server read.
- **Entry = name + muscle group; type-level duration defaults only.** Grouping is the real scannability win on a ~70-item weighted list. Per-exercise numeric defaults are high authoring cost for low yield, since `createEmptyCard` already covers sets/reps/increment; the only genuine gap is duration on time-based/cardio.
- **Clear the name on type switch (refines `applyTypeSwitch`).** Each type has its own list; carrying a prior-type name into a catalog-only field would display an unselectable value.
- **UI-only catalog enforcement; DB stays free text.** Keeps seed data and the future edit page working with legacy/off-catalog names, and avoids any schema/validation change.

---

## Dependencies / Assumptions

- Builds on the merged routine builder (`RoutineForm`, `ExerciseCard`, `apps/swole/src/lib/routine-form.ts`). The only component change is swapping the name `TextField` for an `Autocomplete` in `ExerciseCard.tsx` and threading in the catalog.
- MUI `Autocomplete` ships in `@mui/material`, which the app already uses heavily (`Select`, `TextField`, `Button`, etc. in `ExerciseCard`/`RoutineForm`). No new dependency.
- Duration input units (time-based seconds, cardio minutes) follow the builder's deferred decision and `apps/swole/src/lib/format.ts`; the defaults in R12 respect those units.
- The catalog module is a plain static const with no `server-only` imports, so it is safe in the client bundle — the same constraint `routine-form.ts` already documents.
- Verified against the codebase: no catalog concept exists today (grep clean); exercise names live only as per-routine `exercises.name` rows and demo data in `apps/swole/scripts/seed-home.mjs`.

---

## Outstanding Questions

### Resolve Before Planning

_None. All product decisions are settled._

### Deferred to Planning

- [Affects R4][Design/Editorial] Final per-group icon set — emoji (clean for 🦵 Legs/Glutes, 💪 Arms, 🔥 Core but thin for Back/Chest/Shoulders), a Material Symbol per group, or a color-coded section accent.
- [Affects R12][Technical] Confirm exact default values (proposed: time-based 30 s, cardio 20 min) and that they live at the type level rather than per-entry.
- [Affects R3, R5][Technical] Whether the short bodyweight/time-based lists are muscle-grouped like weighted or rendered flat, and how MUI `Autocomplete` `groupBy` orders group headers.
- [Affects R7][Technical] Exact module path/name and TS shape for the catalog constant.
- [Affects R13][Technical] Update `applyTypeSwitch` to clear `name` and update its unit test (currently asserts name preservation).
- [Affects R9][Content] Final prune of the additions — confirm the ~100-entry list or trim toward only movements actually trained.

---

## Catalog Contents (v1)

Source key: unmarked = from Jeremy's Notion doc; `+` = curated addition. Muscle-group tags drive dropdown sectioning (R3). Final prune is a planning content task (R9).

**Weighted — Legs / Glutes**
Romanian Deadlifts (Barbell) · Dumbbell RDLs · Dumbbell Sumo Deadlift · Sumo Squats · Goblet Squats · Bulgarian Split Squats · Smith Squats · Hip Thrust · Frog Pumps · Leg Press · Leg Extension Machine · Leg Curl / Hamstring Curl · Cable Kickbacks · Glute Kickback Machine · Hip Abduction Machine · Hip Adduction Machine · Standing Cable Adduction · Back Extensions · Glute Bridge Machine · Cable Pull Throughs · Dumbbell Step-Ups · Reverse Lunges · `+`Barbell Back Squat · `+`Front Squat · `+`Hack Squat (Machine) · `+`Conventional Deadlift · `+`Stiff-Leg Deadlift · `+`Walking Lunges · `+`Seated Calf Raise · `+`Standing Calf Raise

**Weighted — Back**
Lat Pulldowns · Seated Cable Rows · Seated Row Machine · Dumbbell Rows · Straight Arm Pulldowns · Resistance Band Pulldowns · Rear Delt Fly Machine · `+`Barbell Bent-Over Row · `+`T-Bar Row · `+`Dumbbell Shrugs · `+`Face Pulls

**Weighted — Chest**
Chest Press Machine · Chest Fly / Pec Deck Machine · `+`Barbell Bench Press · `+`Incline Dumbbell Press · `+`Dumbbell Bench Press

**Weighted — Shoulders**
Shoulder Press (Machine) · `+`Overhead Press (Barbell) · `+`Dumbbell Shoulder Press · `+`Lateral Raises · `+`Cable Lateral Raises · `+`Front Raises

**Weighted — Arms**
Tricep Pushdowns · Tricep Press Machine · Triceps Dips (Machine) · Tricep Kickbacks · Overhead Triceps Extension · Bicep Curls · Hammer Curls · Forearm Curls (Bar) · Preacher Curls Machine · `+`Skull Crushers · `+`Dumbbell Curl · `+`Cable Bicep Curl

**Weighted — Core**
Abdominal Crunch Machine · Pallof Press · Cable High-to-Low Woodchoppers · Medicine Ball Slams · `+`Cable Crunches · `+`Weighted Russian Twists

**Bodyweight**
Back: Assisted Pullups · `+`Pull-Ups · `+`Chin-Ups — Chest: `+`Push-Ups — Arms: `+`Tricep Dips · Wrist Rotations — Legs/Glutes: Glute Bridges · `+`Bodyweight Squats — Core: `+`Bird Dog · `+`Supermans · `+`Mountain Climbers · `+`Bicycle Crunches · `+`Sit-Ups · `+`Lying Leg Raises · `+`Hanging Leg Raises

**Time-based** (duration default 30 s)
Core: Vacuum Holds · `+`Plank · `+`Side Plank · `+`Hollow Body Hold — Legs/Glutes: `+`Wall Sit · `+`Glute Bridge Hold — Back: `+`Dead Hang

**Cardio** (ungrouped; duration default 20 min)
Stairmaster · Elliptical · Incline Treadmill · `+`Treadmill Run · `+`Stationary Bike · `+`Rowing Machine · `+`Jump Rope · `+`Assault Bike · `+`Walking

---

## Visual Sketch

```
Exercise name  [ row|                    ▾ ]
┌────────────────────────────────────────┐
│ 🦵 LEGS / GLUTES                        │  ← group header + icon (R3, R4)
│   (no matches in this group)            │
│ ⬚ BACK                                  │
│   Barbell Bent-Over Row                 │  ← alphabetical within group (R5)
│   Dumbbell Rows                         │
│   Seated Cable Rows                     │
│   Seated Row Machine                    │
│   T-Bar Row                             │
└────────────────────────────────────────┘

Off-catalog query (R6):
Exercise name  [ kettlebell swing        ▾ ]
┌────────────────────────────────────────┐
│ No matching exercise — add it to the    │
│ catalog.                                │
└────────────────────────────────────────┘
```

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
