---
date: 2026-05-27
topic: swole-data-layer
---

# Swole — Data Layer (Survivor 3)

## Problem Frame

The session machine (`apps/swole/src/core/session-machine.ts`) is pure and fully tested, but lives in memory only. To make swole usable, every action — `Increment`, `Stay`, `Failed`, post-session prompt outcomes — has to land in SQLite, and the runner has to be able to resume an interrupted session.

ADR-001 already settled the high-level shape: Next.js server actions own all mutations, Drizzle+better-sqlite3 owns persistence, no internal HTTP hop, `useOptimistic` drives the active-session UI. The PRD sketches five tables (`routines`, `exercises`, `sessions`, `set_logs`, `progressions`) with FK and archival conventions.

What was still open — and is settled by this brainstorm — is how the data layer actually behaves: when set logs hit disk (per-action streaming vs batched at finish), how the FSM's positional `(exerciseIdx, setIdx)` translates to DB-native `(exercise_id, set_number)`, where `applyAction` runs given `useOptimistic`, how the post-session prompt is committed, and the operational details around migrations, PRAGMAs, and singleton clients in Next.js.

The output of this PR is everything below `apps/swole/src/db/`, plus the `instrumentation.ts` hook, plus the `drizzle.config.ts` at the package root. UI work that consumes this layer is Survivor 4.

---

## Requirements

**Dependencies and tooling**

- R1. Add `drizzle-orm`, `drizzle-kit` (dev), and `better-sqlite3` (plus `@types/better-sqlite3` dev) to `apps/swole/package.json`. Match versions used elsewhere in the monorepo where possible.
- R2. Add a `drizzle.config.ts` at `apps/swole/drizzle.config.ts` with `dialect: 'sqlite'`, `schema: './src/db/schema.ts'`, `out: './src/db/migrations'`, and `dbCredentials.url` reading `DATABASE_PATH`.
- R3. Add `DATABASE_PATH` to `apps/swole/src/env.ts` `EnvKeys`. Default in dev: `./swole.db` (gitignored at the app root). Production: `/data/swole.db`, set via `apps/swole/deploy.yml`.

**Client and connection**

- R4. Database client lives at `apps/swole/src/db/client.ts`. Exports a single `db` instance (Drizzle on top of `better-sqlite3`).
- R5. The client uses the `globalThis` singleton pattern so Next.js HMR does not leak handles in dev: stash on `globalThis.__swoleDb` if present, otherwise instantiate and stash. Production runs once per process and skips the global.
- R6. Apply PRAGMAs once on connection open: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`. `foreign_keys = ON` is the load-bearing one — SQLite ships with FKs off, so the PRD's `ON DELETE RESTRICT` is silent without it.

**Schema — tables and columns**

- R7. Schema lives at `apps/swole/src/db/schema.ts`. One module; one `export` per table; all five tables.
- R8. Primary keys: `integer({ mode: 'number' }).primaryKey({ autoIncrement: true })` on every table (rowid-aliased, fast joins, opaque-URL concerns moot at N=1).
- R9. Timestamps (`created_at`, `updated_at`, `archived_at`, `started_at`, `completed_at`, `logged_at`, `effective_from`): `integer({ mode: 'timestamp_ms' })` everywhere. Defaulted to `new Date()` via `$defaultFn` where applicable; `updated_at` updated in mutations (no SQLite trigger needed).
- R10. Foreign keys: every FK uses `ON DELETE RESTRICT` to honor the PRD's archive-don't-delete policy.
- R11. Soft-delete column: nullable `archived_at: integer({ mode: 'timestamp_ms' })` on `routines` and `exercises`. A small helper (`notArchived(table)`) returns `isNull(table.archived_at)` for reuse across queries.
- R12. `routines` table: `id`, `name`, `days` (`text({ mode: 'json' }).$type<DayCode[]>()` where `DayCode = 'mon' | 'tue' | … | 'sun'`), `archived_at`, `created_at`, `updated_at`.
- R13. `exercises` table: `id`, `routine_id` (FK), `name`, `type` (`text({ enum: ['weighted', 'bodyweight', 'time-based', 'cardio'] })`), `order_in_routine`, `sets`, `target_reps?`, `starting_weight?`, `increment?`, `duration_seconds?`, `archived_at`, `created_at`, `updated_at`. Nullable type-specific columns per the PRD.
- R14. `exercises` table includes a SQL `CHECK` constraint enforcing per-type field presence:
  - `weighted`: `target_reps`, `starting_weight`, `increment` not null; `duration_seconds` null
  - `bodyweight`: `target_reps` not null; `starting_weight`, `increment`, `duration_seconds` all null
  - `time-based`: `duration_seconds` not null; `target_reps`, `starting_weight`, `increment` all null
  - `cardio`: `duration_seconds` not null; `sets = 1`; `target_reps`, `starting_weight`, `increment` all null
- R15. `sessions` table: `id`, `routine_id` (FK), `started_at`, `completed_at?`. No routine snapshot column in v1; mid-session routine edits use live lookup.
- R16. `set_logs` table: `id`, `session_id` (FK), `exercise_id` (FK), `set_number` (1-indexed in DB; FSM uses 0-indexed `setIdx`; translation at the persistence boundary), `weight?`, `target_reps?`, `actual_reps?`, `duration_seconds?`, `action` (`text({ enum: ['Increment', 'Stay', 'Decrement', 'Complete', 'Failed', 'Hold', 'Done', 'Skipped'] })`), `logged_at`. Flat columns (not JSON) to keep stats queries indexable.
- R17. `set_logs` has a unique constraint on `(session_id, exercise_id, set_number)` so the streaming-write contract cannot duplicate a row.
- R18. `progressions` table: `id`, `exercise_id` (FK), `session_id?` (FK, nullable for `initial` and `manual_edit` rows), `effective_from`, `starting_weight`, `reason` (`text({ enum: ['initial', 'session_progression', 'manual_edit'] })`).
- R19. `exercises.starting_weight` semantics: it is the *current canonical* value. It is mutated whenever a `session_progression` or `manual_edit` row is written. The `progressions` table is the audit log + chart source. Writes that touch one must touch the other in the same transaction.
- R20. When a `weighted` exercise is created, the create mutation writes an `initial` `progressions` row in the same transaction so the chart has a starting point without special-casing the first session. Non-weighted exercises write no `progressions` rows ever.

**Migrations**

- R21. Migration files generated by `drizzle-kit generate` land at `apps/swole/src/db/migrations/`. The folder ships in the runtime Docker image alongside `server.js`.
- R22. Migrations are applied automatically once per process at boot via `apps/swole/instrumentation.ts` (Next.js's `register()` hook), calling `migrate(db, { migrationsFolder: './src/db/migrations' })`. `__drizzle_migrations` tracks applied state; re-applying is a no-op.
- R23. No separate `pnpm db:migrate` script in dev. The `instrumentation.ts` hook covers `next dev` too. A `pnpm db:generate` script wraps `drizzle-kit generate` for the author workflow.

**Queries and mutations**

- R24. Read functions live in `apps/swole/src/db/queries/{routines,exercises,sessions,setLogs,progressions}.ts`. Each file exports named async functions (e.g., `listRoutines`, `getRoutineWithExercises(id)`, `getActiveSession(id)`, `getSetLogsForSession(sessionId)`). No DTOs; functions return Drizzle's inferred row types or composed objects.
- R25. Mutation functions live in `apps/swole/src/db/mutations/{routines,exercises,sessions,setLogs,progressions}.ts`. Each mutation that touches multiple tables wraps its work in `db.transaction(tx => ...)`.
- R26. Mutations needed for Survivor 4 to be unblocked:
  - `createRoutine(input)`, `updateRoutine(id, patch)`, `archiveRoutine(id)`
  - `createExercise(routineId, input)` — writes the `initial` `progressions` row inline for `weighted` exercises
  - `updateExercise(id, patch)` — if `starting_weight` changed, writes a `manual_edit` `progressions` row in the same transaction
  - `archiveExercise(id)`, `reorderExercises(routineId, orderedIds[])`
  - `startSession(routineId)` → returns the new session id
  - `appendSetLog(sessionId, log)` — inserts one `set_logs` row; relies on the unique constraint to guarantee idempotence under retries
  - `undoLastSetLog(sessionId)` — deletes the most recent `set_logs` row by `logged_at DESC LIMIT 1`; valid only while no `session_progression` row exists for the session
  - `commitProgressionDecision(sessionId, exerciseId, chosenStartingWeight)` — writes one `progressions` row and updates `exercises.starting_weight` atomically. Used by every Case A "Stay/Roll up" tap and every Case B informational confirm.
  - `completeSession(sessionId)` — sets `completed_at = now()`. Called once all post-session prompts are committed (or immediately if no weighted exercises ran).
- R27. Every mutation that changes user-visible data calls `revalidatePath` / `revalidateTag` for the affected route(s) before returning, per ADR-001.

**FSM integration**

- R28. `applyAction` runs in *both* client (for optimistic UI under `useOptimistic`) and server (as the authoritative computation before persistence). Both sides import `apps/swole/src/core/session-machine.ts`; no FSM rules are duplicated in queries, mutations, or React components.
- R29. The `exerciseIdx → exercise_id` translation lives in the runner's server action wrapper, not in the FSM itself. The wrapper receives `(sessionId, action)` from the client, loads the routine, runs `applyAction`, then writes the resulting `SetLog` as a row using `exercise_id = routine.exercises[newLog.exerciseIdx].id` and `set_number = newLog.setIdx + 1`.
- R30. Resume hydration: when the runner loads `/session/[id]` for a not-yet-completed session, the server component loads (a) the session, (b) all `set_logs` for it, (c) the routine + exercises, (d) any `progressions` already written for this session. It maps each `set_logs` row → `SetLog` (translating `exercise_id` back to `exerciseIdx` via the routine's exercise order, and `set_number` back to `setIdx`) and constructs a `SessionState` directly — no action replay.
- R31. Post-session prompt outcomes stream: each "Stay" / "Roll up" tap on a Case A card invokes `commitProgressionDecision` directly; each Case B card auto-commits on view since there is no user choice. A final small server action ticks `completed_at` after all prompts are handled.
- R32. Undo is disabled (UI hides the button; server action rejects) once any `session_progression` row exists for the session. Reversing a starting-weight change after that point requires the routine-edit flow, which writes a new `manual_edit` `progressions` row.

**Tests**

- R33. Unit tests for queries and mutations use `better-sqlite3(':memory:')` with full migrations applied in `beforeEach`. Tests assert FK enforcement (deleting a routine with sessions throws), CHECK enforcement (writing a `weighted` row with null `starting_weight` throws), and atomic-transaction behavior (a mutation that fails mid-way leaves no partial state).
- R34. Round-trip tests pin the FSM ↔ DB mapping: build a `SessionState` from `setLogs`, persist via `appendSetLog` once per log, reload via the hydration path, and assert structural equality with the source state.
- R35. End-to-end of the F2/F3 PRD walkthrough at the query layer (no UI): create routine, start session, append 9 set logs (3 per exercise) per the PRD example, commit Case A "Roll up" for Bench Press, complete session, assert `exercises.starting_weight` for Bench Press = 105, two `progressions` rows for Bench Press (`initial` 100, `session_progression` 105), and that the session shows `completed_at != null`.

---

## Success Criteria

- `pnpm --filter @lilnas/swole test` passes, including new query/mutation suites with `:memory:` SQLite.
- `pnpm --filter @lilnas/swole lint` and `pnpm --filter @lilnas/swole type-check` pass.
- `docker-compose -f docker-compose.dev.yml up -d swole` boots the container, the `instrumentation.ts` hook applies migrations on first request, and `docker exec swole sqlite3 /data/swole.db ".tables"` shows all five tables.
- A Survivor 4 PR can import from `apps/swole/src/db/queries/*` and `apps/swole/src/db/mutations/*` to wire the runner UI without modifying the schema and without writing any new Drizzle queries inline in `app/**`.
- After `docker-compose restart swole`, all data persists (verified per PRD §Verification step 6).
- Restarting mid-session: tab dies between two sets → reopening `/session/[id]` shows the next active set is exactly where the user left off, with prior set logs in the history strip.

---

## Scope Boundaries

- No UI work. The runner page, routine editor, stats charts, and post-session prompt cards are all Survivor 4. This PR ships query/mutation primitives plus a smoke test page only if useful for verification.
- No backup tooling beyond what the host already provides. The SQLite file lives on `/storage/app-data/swole/` which is in the existing backup tier; no app-level snapshot, no `BEGIN IMMEDIATE` backup script, no S3 sync.
- No cleanup job for abandoned (started-but-never-completed) sessions. History views filter on `completed_at IS NOT NULL`; abandoned sessions sit harmlessly in the DB until a future janitor.
- No multi-routine snapshots, no soft-delete of `sessions` or `set_logs` (history is immutable; only routine-level entities archive).
- No JSON `config` blob on `exercises`. Nullable type-specific columns + CHECK constraint is the chosen pattern.
- No client-side ID generation. The server returns IDs after insert; the few places that need optimistic insertion (set logs, in particular) carry a client-side temp marker that's reconciled when the row's real id lands. (UI concern — Survivor 4.)
- No `routine_snapshot` column on `sessions`. Mid-session routine edits use live lookup; we accept the "don't do that mid-set" UX implicit contract.
- No drizzle-kit `push` workflow. Generated migrations are the only path; ad-hoc schema drift in dev is explicitly off the table.

---

## Key Decisions

- **Per-action streaming over batch-at-finish.** Every action button fires a server action that inserts one `set_logs` row. Reason: the gym is the worst place for "lost work" UX, and `useOptimistic` is honest only when there's a real server commit to confirm against. Cost: `undo` becomes a DB delete, and abandoned sessions exist in the DB forever. Both are cheap to live with — `undo` is one statement, and `WHERE completed_at IS NOT NULL` on history queries handles the second.
- **Nullable type-specific columns over JSON `config`.** Pressure-tested; PRD's pick stands. The CHECK constraint compensates for the "TypeScript types are nullable everywhere" downside by guaranteeing the DB never holds a malformed row, so the queries layer can confidently narrow.
- **`exercises.starting_weight` is canonical, `progressions` is audit + chart.** The alternative (derive current SW from latest progressions row) would force a join on every session start; the chosen pattern keeps reads cheap at a small write cost (two writes per progression, in one transaction).
- **FSM runs on both client and server.** Canonical React 19 `useOptimistic` pattern. The FSM is already pure and 100%-branch-covered; running it twice costs nothing and avoids re-implementing the rules in any layer.
- **Same FSM module survives Survivor 3 unchanged.** The reconciliation question raised in Survivor 2's "Dependencies" section is resolved in favor of *keeping FSM types where they are*. The queries layer maps DB rows → FSM types; the FSM module does not import Drizzle. Reason: the FSM is the domain truth; the DB is infrastructure. Inverting the dependency ("FSM imports schema-generated types") would couple a pure rules module to a persistence concern.
- **No routine snapshot on sessions.** Mid-session routine edits are a "don't do that" scenario at N=1; snapshotting adds one JSON column and an extra read path for no real user benefit.
- **Migrations auto-apply via `instrumentation.ts`.** Single-process, single-user app; no race risk. The alternative (explicit `pnpm db:migrate`) is friction with no payoff.
- **Singleton client via `globalThis`.** Next.js HMR re-imports modules on every save; without the global stash, every save leaks a `better-sqlite3` handle in dev.
- **Queries split from mutations, both module-level functions.** Thin layer; no repository class, no DTOs. The set of access patterns is finite (the FSM defines them) and consolidating them prevents drift between the routine editor and the active-session runner.
- **`set_number` is 1-indexed in the DB, 0-indexed in the FSM.** Translation at the persistence boundary. Reason: the DB is what someone reads in the `sqlite3` CLI; humans count from 1. The FSM is what code reads; arrays count from 0.

---

## Dependencies / Assumptions

- Survivors 1 (infra foundation) and 2 (session machine) are merged. The Next.js scaffold exists, NestJS is gone, and `src/core/session-machine.ts` exports the four FSM functions plus types.
- The PRD's data model section is final on table count and FK behavior. Any deviation here (e.g., adding a `notes` column to `sessions`) is a separate brainstorm.
- `better-sqlite3` v11+ is compatible with Node 20+ inside `lilnas-node-runtime`. Confirmed during planning if the base image needs a rebuild for the native binding.
- The forward-auth Traefik layer is the only auth gate. The data layer does no per-row authorization; every server action assumes "this is Jeremy" because Traefik already verified.
- `instrumentation.ts` is supported in the Next.js version pinned by `apps/swole/package.json` (Next 16.x). Confirmed during planning.
- Drizzle's `drizzle-orm/better-sqlite3/migrator` is stable on the chosen drizzle-orm version.
- `revalidatePath` / `revalidateTag` calls after mutations are sufficient cache invalidation — no manual SWR/React-Query story to maintain because ADR-001 already rejected client-side query libraries.

---

## Outstanding Questions

### Resolve Before Planning

_None. Product decisions and architectural choices are settled._

### Deferred to Planning

- [Affects R1][Technical] Exact pinned versions of `drizzle-orm`, `drizzle-kit`, `better-sqlite3`. Match other Drizzle consumers in the monorepo where versions align with `dialect: 'sqlite'`; if yoink's pin is too old or postgres-only, pin to Drizzle's latest stable as of the PR.
- [Affects R6][Needs research] Whether to set `synchronous = FULL` instead of `NORMAL` for extra durability on the personal-data file. Trade-off: small write latency vs marginally lower risk of one-set loss on a hard OS crash. Default to `NORMAL` (WAL handles crash safety well); revisit only if real data loss is observed.
- [Affects R22][Technical] Confirm `instrumentation.ts`'s `register()` hook is the right place for `migrate()` in Next.js 16 standalone output. If standalone mode doesn't run `instrumentation.ts`, fall back to running `migrate()` at the top of `src/db/client.ts` (guarded against re-entry).
- [Affects R26][Technical] Whether `undoLastSetLog` should hard-delete the row or soft-delete it with an `undone_at` column. Default: hard-delete (matches the FSM's `setLogs.slice(0, -1)` semantics; undo is not auditable history). Reconsider if "I want to see what I undid" ever becomes a feature.
- [Affects R30][Technical] If exercise reordering (R26 `reorderExercises`) is performed between sets of an in-progress session, the runner's stored `exerciseIdx` (a positional value) may now point at a different exercise on hydration. Either reject reorder while any session is active (preferred — same spirit as "no routine snapshot"), or rebuild `exerciseIdx` from `exercise_id` on hydration. Planner picks.
- [Affects R33][Technical] Whether to use `better-sqlite3(':memory:')` with `vitest` workers or Jest, given Jest is what swole already uses. Default: stick with Jest for consistency.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
