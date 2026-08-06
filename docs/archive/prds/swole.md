# PRD — `swole`

A personal-use web app for tracking weightlifting workouts with per-set progression and history.

## Context

Jeremy wants a single-user web app to drive his own workouts: design routines (e.g., MWF Push Day), run an active session that walks set-by-set, and decide after every set whether to bump the weight up, hold, or drop. The app should record every set in detail so he can see progression history and charts over time.

It lives in the `lilnas` monorepo as a new `apps/swole/` app, deployed at `swole.lilnas.io` behind the existing forward-auth, with a single Next.js process and a SQLite file persisted to `/storage/app-data/swole/`.

## Goals

- Design and edit workout routines tied to specific days of the week
- Support four exercise types: **weighted**, **bodyweight**, **time-based**, **cardio**
- Run an active session that drives set-by-set progression with explicit user choice every set
- Capture detailed set-level history (weight, target reps, actual reps when failed, action taken)
- Show stats per exercise: current starting weight, increment, computed max weight, full history with charts
- Record every completed session with full set-by-set detail
- Persist durably to a local SQLite file (survives browser cache wipes; one device of truth)

## Non-goals (v1)

- Multi-user / sharing
- Rest timer
- Per-session free-text notes
- Calendar / schedule awareness (no "today's routine" auto-select on open)
- Cross-device sync beyond what a shared backend naturally provides
- Skipped-session tracking & streak gamification (only completed sessions are recorded)
- Importing data from other apps
- Mobile-native app (web responsive is enough)

## Glossary

| Term | Meaning |
|---|---|
| **Routine** | A workout plan assigned to one or more days of the week (e.g., "Push Day" on MWF). Contains an ordered list of exercises. |
| **Exercise** | A single movement inside a routine (e.g., "Bench Press"). Has a type and type-specific config. |
| **Session** | One instance of executing a routine. Tied to exactly one routine. |
| **Set log** | One row recording one set inside a session: the weight/duration used, target reps, actual reps if failed, and the user's chosen action. |
| **Progression** | A history entry recording a change to an exercise's starting weight (initial, manual edit, or session-driven roll-forward). |
| **Action** | The button pressed at the end of a set: `Increment`, `Stay`, `Decrement`, `Complete`, or `Failed`. |

## User flows

### F1 — Create a routine
1. From home, tap "New Routine"
2. Name it ("Push Day"), pick days (MWF)
3. Add exercises one at a time. For each:
   - Name
   - Type (weighted / bodyweight / time-based / cardio)
   - Sets count
   - Type-specific fields (see "Exercise types" below)
4. Reorder exercises if needed
5. Save

### F2 — Run a session
1. From home, pick any routine (no auto-select). Tap "Start session"
2. App opens at the routine's first exercise, set 1
3. For each set:
   - View target (reps × weight, or duration, or just reps for bodyweight)
   - Do the set in real life
   - Tap one of the action buttons (see "Set actions" below)
   - App advances to next set, or asks for actual reps if `Failed` was tapped
4. After the last set of an exercise, app auto-advances to the next exercise in the routine
5. User may jump to any exercise out of order via an exercise list / drawer
6. After the last set of the last exercise, session ends and the post-session prompt fires (see F3)
7. Session is recorded as completed

### F3 — End-of-session weight prompt

For each **weighted** exercise that was performed in the session, show a per-exercise summary card with:
- Original starting weight
- Lowest weight used in any set during the session
- Highest weight used in any set
- Ending weight (weight of the last set performed)

Then, based on whether any set dipped below the original starting weight:

**Case A — all sets at or above original SW** (normal case)
> **Bench Press** — you ended at 110 lb (started 100, highest 110). Stay at 100 or roll up to 105 next session?
- `Stay` keeps the starting weight unchanged
- `Roll up` advances the starting weight by `+increment`
- Writes a `progression` row with `reason = 'session_progression'`

**Case B — at least one set dipped below original SW**
> **Bench Press** — you ended at 95 lb (started 100, lowest 95). Starting weight is now 95.
- No choice offered — informational only
- Starting weight auto-updates to the **lowest weight used** in any set during the session
- Writes a `progression` row with `reason = 'session_progression'`

Non-weighted exercises (bodyweight, time-based, cardio) have no post-session prompt.

### F4 — View stats / history
- Per exercise:
  - Current starting weight, increment, configured sets × reps
  - **Max weight** = `starting_weight + (increment × (sets − 1))` (weighted only; n/a for others)
  - Line chart of starting weight over time
  - Table of every set ever logged (date, weight, target reps, actual reps, action)
- Per routine:
  - List of exercises, sets, reps configured
  - Days of the week assigned
  - History of completed sessions (date, exercises performed)

### F5 — Edit a routine
- Edit any field on any routine or exercise after creation
- Editing a starting weight writes a new `progression` row with `reason = 'manual_edit'`
- Editing reps/sets/type does **not** rewrite history; old set logs keep their original target reps and weights
- Deleting an exercise soft-deletes it (preserves history); deleting a routine soft-deletes it

## Exercise types

| Type | Config fields | Set action buttons | Per-set data captured |
|---|---|---|---|
| **Weighted** | sets, target reps, starting weight, increment | `Increment` / `Stay` / `Decrement` / `Failed` (last set: `Complete` replaces `Increment`) | weight used, target reps, actual reps (= target unless `Failed`), action |
| **Bodyweight** | sets, target reps | `Complete` / `Failed` | target reps, actual reps (= target unless `Failed`), action |
| **Time-based** | sets, target duration (s) | `Hold` / `Failed` | target duration, action |
| **Cardio** | target duration (s), 1 "set" | `Done` / `Skipped` | target duration, action |

### Set actions — semantics

- **Increment** — set completed at full reps; next set within this exercise uses `current_weight + increment`
- **Stay** — set completed at full reps; next set uses the same weight (no bump)
- **Decrement** — set was too heavy; next set uses `current_weight − increment`. Any number of decrements is allowed, including past the configured starting weight. If at end of session the lowest weight used is below the previous starting weight, the starting weight is auto-updated to that lowest value (see F3 case B)
- **Complete** — replaces `Increment` on the **last set** only; finishes the exercise and advances to the next exercise. `Stay` and `Decrement` are still shown on the last set and also finish the exercise (their semantics carry forward into the post-session prompt for next session's starting weight).
- **Failed** — opens a small modal: "How many reps did you get?" defaulting to the target. User enters the actual number. The set is logged with `actual_reps < target_reps`. The next set behaves as if `Stay` was chosen (weight does not advance up; user can still drop next set manually by tapping `Decrement` on the following set).

### Decrement amount

Decrement uses `−increment`. No separate decrement-size setting in v1.

## Data model

SQLite via Drizzle ORM. Five tables:

- **`routines`** — `id`, `name`, `days` (JSON array of day codes), `archived_at`, timestamps
- **`exercises`** — `id`, `routine_id` (FK), `name`, `type`, `order_in_routine`, `sets`, `target_reps?`, `starting_weight?`, `increment?`, `duration_seconds?`, `archived_at`, timestamps
- **`sessions`** — `id`, `routine_id` (FK), `started_at`, `completed_at` (nullable until finished)
- **`set_logs`** — `id`, `session_id`, `exercise_id`, `set_number`, `weight?`, `target_reps?`, `actual_reps?`, `duration_seconds?`, `action`, `logged_at`
- **`progressions`** — `id`, `exercise_id`, `session_id?`, `effective_from`, `starting_weight`, `reason` (`initial` | `session_progression` | `manual_edit`)

Foreign keys with `ON DELETE RESTRICT`; archive instead of hard-delete to preserve history.

## Tech stack & architecture

Single Next.js process that serves the UI and owns its database directly. swole is the first Next.js-only lilnas service; the data-flow direction is recorded in [ADR-001](../../apps/swole/docs/adr/001-data-flow.md).

- **Frontend & server**: Next.js 16 (App Router, standalone output) + React 19 + MUI 7 + Tailwind v4 + `cns()` from `@lilnas/utils`. TypeScript 5.9. Mirrors `apps/yoink/` and `apps/token/` (Next.js half).
  - Active-session state machine lives in client components, driven by React 19's `useOptimistic` for set-by-set advance.
  - Forms: plain React state + `zod` for validation, no form library.
  - Charts: `recharts` (or `visx` if Recharts feels heavy).
- **Data layer**: SQLite via Drizzle ORM with `better-sqlite3`, imported directly in Next.js server components (reads) and server actions (mutations). No internal REST hop. See [ADR-001](../../apps/swole/docs/adr/001-data-flow.md).
  - SQLite file at `/data/swole.db` inside the container; mounted from `/storage/app-data/swole/` on the host.
  - Drizzle schema at `apps/swole/src/db/schema.ts`; migrations under `apps/swole/src/db/migrations/`, applied on boot.
  - Server actions in `src/app/**/actions.ts` call `revalidatePath` / `revalidateTag` after mutations.
- **Observability**: Direct `pino` logger at `src/lib/logger.ts` (NODE_ENV-aware, redact for auth headers). `/api/health` and `/metrics` route handlers under the Next.js App Router; `/metrics` uses `prom-client`'s default registry. Prometheus scrapes `swole:8080` via the Docker network.
- **Deploy**: Single container, single primary Traefik router. Behind `forward-auth` middleware at `swole.lilnas.io`; a higher-priority router blocks external `/metrics` access at the Traefik layer. Dev at `swole.localhost`.

### File structure

```
apps/swole/
├── package.json                        # scripts: build, dev, dev:start, start, test, lint
├── tsconfig.json
├── next.config.ts                      # output: 'standalone'
├── Dockerfile                          # multi-stage; mirrors apps/portal/Dockerfile
├── deploy.yml                          # prod: traefik forward-auth + storage volume
├── deploy.dev.yml                      # dev: swole.localhost, no auth, volume-mount source
├── drizzle.config.ts                   # (lands with Survivor 3)
├── docs/
│   └── adr/
│       └── 001-data-flow.md            # data-flow direction
├── README.md
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                    # home
    │   ├── api/
    │   │   └── health/route.ts         # JSON health endpoint
    │   ├── metrics/
    │   │   └── route.ts                # prom-client default metrics
    │   ├── routines/[id]/              # routine detail
    │   ├── session/[id]/               # active-session runner
    │   └── stats/[exerciseId]/         # per-exercise stats
    ├── components/
    │   ├── Home.tsx
    │   ├── Layout.tsx
    │   └── Provider.tsx                # MUI ThemeProvider + v16-appRouter
    ├── db/                             # (lands with Survivor 3)
    │   ├── client.ts                   # better-sqlite3 + Drizzle init
    │   ├── schema.ts                   # Drizzle schema
    │   └── migrations/
    ├── env.ts                          # EnvKeys (NODE_ENV, LOG_FILE_PATH)
    ├── lib/
    │   └── logger.ts                   # direct pino instance
    ├── tailwind.css
    └── theme.ts                        # MUI theme
```

### Key files to reuse from the monorepo

- `packages/utils/src/cns.ts` — class merging (per CLAUDE.md, "always use cns()").
- `packages/utils/src/env.ts` — env var parsing.
- `infra/base-images/build-base-images.sh` — base images that the Dockerfile extends.
- `apps/portal/Dockerfile` and `apps/portal/package.json` — closest reference for a Next.js-only standalone build.
- `apps/yoink/` — closest reference for `Provider.tsx`, MUI integration, and Drizzle conventions. swole diverges from yoink on data flow (no NestJS layer); see [ADR-001](../../apps/swole/docs/adr/001-data-flow.md).
- `apps/token/src/app.module.ts:17-53` — NODE_ENV-aware logger config that swole's direct-pino setup translates from `pinoHttp` to root pino options.

## Out of scope / future ideas

- Rest timer between sets
- Per-session free-text notes
- Calendar awareness ("today's routine" on home)
- Mobile-native (PWA later if useful)
- Exporting CSV / sharing routines
- Multi-user accounts
- Apple Health / Strong app import
- Body weight tracking (separate from exercise weight)
- 1RM estimator
- "Plate calculator" (what plates to load to hit a target weight)

## Verification

Once implemented, the end-to-end happy path is:

1. **Boot dev stack**
   - `docker-compose -f docker-compose.dev.yml up -d swole`
   - Visit `http://swole.localhost`. Home renders with empty state.

2. **Create a routine**
   - Make "Push Day" with days MWF
   - Add three exercises: Bench Press (weighted, 3×10 @ 100 lb, +5), Pushups (bodyweight, 3×15), Plank (time-based, 3×30s)
   - Verify routine appears on home

3. **Run a full session**
   - Start session on "Push Day"
   - Bench Press: tap `Increment` set 1 → weight shows 105 for set 2; tap `Stay` set 2 → still 105 for set 3; tap `Complete` set 3 → advances to Pushups
   - Pushups: tap `Failed` set 1 → modal prompts for actual reps, enter 12 → advances; tap `Complete` sets 2 & 3
   - Plank: tap `Hold` sets 1, 2, 3
   - Post-session prompt fires for Bench Press only: "Stay at 100 or roll up to 105?" → pick Roll up
   - Session shows as completed in history

4. **Check stats & history**
   - On Bench Press stats page: starting weight = 105 (rolled up), increment = 5, max = 115, chart shows the new progression point, set log shows all 3 sets with weights 100/105/105
   - Pushups stats page: actual reps for set 1 = 12, set 2 & 3 = 15
   - Plank stats page: 3 successful 30-second holds logged

5. **Edit a routine after history exists**
   - Change Bench Press increment from 5 to 10
   - Verify next session uses new increment
   - Verify old set logs still show the original 5-lb steps (history untouched)

6. **Persistence**
   - `docker-compose -f docker-compose.dev.yml restart swole`
   - All routines / sessions / stats still present
   - Inspect with `docker exec -it swole sqlite3 /data/swole.db ".tables"` to confirm schema

7. **Lint / type-check / tests**
   - `pnpm --filter @lilnas/swole lint`
   - `pnpm --filter @lilnas/swole type-check`
   - `pnpm --filter @lilnas/swole test` (unit tests on the session state machine and post-session-progression logic at minimum)

## Resolved decisions

1. ✅ Post-session prompt shows ending weight, lowest, and highest — see F3.
2. ✅ Skipped-session tracking dropped from v1; only completed sessions are recorded.
3. ✅ Decrements are unlimited. Going below starting weight is allowed; starting weight auto-updates to the lowest weight used at end of session — see F3 case B and the Decrement semantics.
