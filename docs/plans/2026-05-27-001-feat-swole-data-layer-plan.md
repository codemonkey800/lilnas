---
title: 'feat: Swole data layer — SQLite via Drizzle, queries/mutations, FSM↔DB bridge'
type: feat
status: active
date: 2026-05-27
deepened: 2026-05-27
origin: docs/brainstorms/2026-05-27-swole-data-layer-requirements.md
---

# feat: Swole data layer — SQLite via Drizzle, queries/mutations, FSM↔DB bridge

## Overview

Land the persistence layer under `apps/swole/src/db/` so the in-memory `SessionState` from Survivor 2's FSM can survive a tab close, a container restart, and the user's next session. Five Drizzle tables (`routines`, `exercises`, `sessions`, `set_logs`, `progressions`) backed by `better-sqlite3` on a single SQLite file at `/data/swole.db`. One singleton client with PRAGMAs applied on open. A small `instrumentation.ts` boot hook that applies generated migrations once per process. Module-level query and mutation functions consumed directly from Next.js server components and server actions (per ADR-001). A hydration helper that translates `set_logs` rows back into a `SessionState` so the runner page can resume an interrupted session.

No UI work in this PR — Survivor 4 imports from `src/db/queries/*` and `src/db/mutations/*` to wire the runner. The contract is: every mutation the runner needs is here, every query the runner and stats pages need is here, the FSM ↔ DB mapping is tested end-to-end against the PRD F2/F3 walkthrough at the query layer.

---

## Problem Frame

The session FSM (`apps/swole/src/core/session-machine.ts`) is pure, fully tested, and in-memory only. To make swole actually usable, every `applyAction` result needs to land in SQLite as the user taps the button, and the next `/session/[id]` load needs to reconstruct the same `SessionState` from those rows. The PRD's five-table model and ADR-001's "Drizzle in server actions, no NestJS hop" are settled — what is open is *how* the data layer behaves: when set logs hit disk (per-action streaming vs. batched-at-finish), how the FSM's positional `(exerciseIdx, setIdx)` translates to DB-native `(exercise_id, set_number)`, how the `exercises.starting_weight` canonical-vs-`progressions` audit-log split stays consistent, where migrations apply at boot, and how the singleton client and PRAGMAs survive Next.js HMR.

The brainstorm (origin: `docs/brainstorms/2026-05-27-swole-data-layer-requirements.md`) settled all of those product/architectural choices. This plan turns those decisions into ordered, file-by-file implementation slices with concrete test scenarios.

---

## Requirements Trace

- R1. Add `drizzle-orm`, `drizzle-kit` (dev), `better-sqlite3`, `@types/better-sqlite3` (dev) to `apps/swole/package.json`.
- R2. `apps/swole/drizzle.config.ts` with `dialect: 'sqlite'`, `schema: './src/db/schema.ts'`, `out: './src/db/migrations'`, `dbCredentials.url` from `DATABASE_PATH`.
- R3. `DATABASE_PATH` in `apps/swole/src/env.ts` `EnvKeys`. Dev default `./swole.db` (gitignored). Production `/data/swole.db` via `apps/swole/deploy.yml`.
- R4. Client at `apps/swole/src/db/client.ts` exports a single `db` instance.
- R5. `globalThis` singleton pattern for HMR safety in dev; one-shot in production.
- R6. PRAGMAs on open: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- R7. Schema at `apps/swole/src/db/schema.ts` — one module, all five tables.
- R8. Autoincrement integer PKs on every table.
- R9. Timestamps as `integer({ mode: 'timestamp_ms' })`.
- R10. Every FK uses `ON DELETE RESTRICT`.
- R11. Nullable `archived_at` on `routines` and `exercises` + `notArchived(table)` helper.
- R12. `routines` table shape.
- R13. `exercises` table shape with nullable type-specific columns.
- R14. `exercises` SQL `CHECK` constraint enforcing per-type field presence.
- R15. `sessions` table shape (no routine snapshot column).
- R16. `set_logs` table shape with 1-indexed `set_number` (FSM 0-indexed setIdx; translation at persistence boundary).
- R17. `set_logs` unique constraint on `(session_id, exercise_id, set_number)`.
- R18. `progressions` table shape.
- R19. `exercises.starting_weight` canonical-write rule: mutated whenever `session_progression`/`manual_edit` row is written, in the same transaction.
- R20. Create-exercise writes `initial` `progressions` row for weighted exercises in the same transaction; non-weighted writes none.
- R21. Migration files at `apps/swole/src/db/migrations/`; ship in runtime Docker image.
- R22. Migrations applied via `apps/swole/src/instrumentation.ts` `register()` hook calling Drizzle's `migrate()` once per process.
- R23. `pnpm db:generate` script wraps `drizzle-kit generate`; no `pnpm db:migrate` script.
- R24. Read functions in `apps/swole/src/db/queries/{routines,exercises,sessions,setLogs,progressions}.ts`.
- R25. Mutation functions in `apps/swole/src/db/mutations/{routines,exercises,sessions,setLogs,progressions}.ts`; multi-table mutations wrap in `db.transaction(tx => ...)`.
- R26. Specific mutations required: `createRoutine`, `updateRoutine`, `archiveRoutine`, `createExercise`, `updateExercise`, `archiveExercise`, `reorderExercises`, `startSession`, `appendSetLog`, `undoLastSetLog`, `commitProgressionDecision`, `completeSession`.
- R27. Every mutation calls `revalidatePath` / `revalidateTag` for the affected route(s) before returning.
- R28. `applyAction` runs in *both* client (optimistic) and server (authoritative); both sides import the same FSM module.
- R29. `exerciseIdx → exercise_id` translation lives in the runner's server action wrapper (Survivor 4 owns the wrapper; this PR ships the helper primitives).
- R30. Resume hydration: load session + set_logs + routine + progressions, map rows → `SessionState` via routine order, no action replay.
- R31. Post-session prompt outcomes stream via `commitProgressionDecision` per prompt; `completeSession` ticks at the end.
- R32. Undo disabled once any `session_progression` row exists for the session (mutation rejects).
- R33. Unit tests use `better-sqlite3(':memory:')` with migrations applied per test; assert FK / CHECK / atomicity.
- R34. Round-trip tests pin the FSM ↔ DB mapping.
- R35. End-to-end PRD F2/F3 walkthrough at query layer.

---

## Scope Boundaries

- No UI work. The runner page, routine editor, stats charts, and post-session prompt cards are all Survivor 4. This PR ships query/mutation primitives plus the hydration helper.
- No backup tooling beyond what the host already provides. SQLite file lives on `/storage/app-data/swole/`, which is in the existing backup tier; no app-level snapshot, no `BEGIN IMMEDIATE` backup script, no S3 sync.
- No cleanup job for abandoned (started-but-never-completed) sessions. History views filter on `completed_at IS NOT NULL`; abandoned sessions sit harmlessly in the DB until a future janitor.
- No multi-routine snapshots, no soft-delete of `sessions` or `set_logs` (history is immutable; only routine-level entities archive).
- No JSON `config` blob on `exercises`. Nullable type-specific columns + CHECK constraint is the chosen pattern.
- No client-side ID generation. The server returns IDs after insert; the few places that need optimistic insertion carry a client-side temp marker that's reconciled when the row's real id lands. (UI concern — Survivor 4.)
- No `routine_snapshot` column on `sessions`. Mid-session routine edits use live lookup; we accept the "don't do that mid-set" UX implicit contract, but with a guardrail (see U10 — `reorderExercises`, `archiveRoutine`, and `archiveExercise` all reject while any session is active on the affected routine).
- No `drizzle-kit push` workflow. Generated migrations are the only path; ad-hoc schema drift in dev is explicitly off the table.
- No server action wrapper in `app/**`. R29's wrapper is a Survivor 4 file; this PR provides the primitives (hydration helper, `appendSetLog`) the wrapper composes from.
- No `docs/solutions/` entry. The brainstorm's "first `docs/solutions/` entry reserved for Survivor 3 SQLite-in-monorepo writeup" is a `ce-compound` follow-up after this PR lands and proves out — not part of the implementation.

### Deferred to Follow-Up Work

- The runner's `'use server'` action wrapper that calls `applyAction` + `appendSetLog` from `src/app/session/[id]/actions.ts`: Survivor 4 (depends on this PR's `appendSetLog` and hydration helper landing first).
- Stats / charts / history queries beyond what the runner page needs (e.g., line-chart aggregations for F4): Survivor 4 or later. Per-set-log reads and basic `getProgressionsForExercise` are in this PR; aggregation/window functions are not.
- Smoke test page (e.g., `src/app/_dev/db-check/page.tsx`): considered and skipped — the test suite and `sqlite3 .tables` verification on a deployed container are sufficient.

---

## Context & Research

### Relevant Code and Patterns

- **`apps/swole/src/core/session-machine.ts`** — the FSM types (`SetLog`, `SessionState`, `Routine`, `Exercise`, exercise variants) the queries layer maps DB rows to. The schema does NOT import these types (keeps the boundary clean per ADR-001 + the brainstorm's "FSM is domain truth; DB is infrastructure" decision); the bidirectional mapping (`toSetLog`, `toSetLogArgs`) lives in `apps/swole/src/db/mappers.ts`, with `hydration.ts` composing it.
- **`apps/swole/src/core/session-machine.spec.ts`** — sets the precedent for adjacent `.spec.ts` files and table-driven scenarios. New tests under `src/db/` follow the same pattern.
- **`apps/swole/jest.config.js`** — accepts both adjacent `.spec.ts` and `__tests__/` layouts; new specs go adjacent. `moduleNameMapper` already wires `src/*` to `<rootDir>/src/*`.
- **`apps/swole/src/env.ts`** — `EnvKeys` shape with `as const` for type-safe lookup via `@lilnas/utils/env`'s `env(key, default)` helper.
- **`apps/swole/src/lib/logger.ts`** — sample of `EnvKeys` consumption pattern this plan extends.
- **`apps/swole/next.config.ts`** — `output: 'standalone'` is the build mode that needs the migrations folder shipped alongside `server.js`.
- **`apps/swole/Dockerfile`** — multi-stage build with `lilnas-monorepo-builder` → `lilnas-nextjs-runtime`. Build stage copies `.next` to `/app/.next` and `server.js` to `/app/server.js`. This plan extends the build stage to copy `src/db/migrations` to a location the runtime can find.
- **`apps/swole/deploy.yml`** — already mounts `/storage/app-data/swole:/data` and pulls env from `infra/.env.swole`. This plan adds `DATABASE_PATH=/data/swole.db` to that env file or via inline env in deploy.yml.
- **`apps/yoink/`, `apps/token/`, `apps/tdr-bot/`** — existing Drizzle consumers, but all PostgreSQL-only. Useful precedent for `drizzle-orm` version pinning (`^0.45.1`) and `drizzle-kit` (`^0.31.9` dev); divergent on dialect and on the migrate-at-boot pattern (they all run `dist/db/migrate.js` as a separate process before backend start; swole runs migrations in-process via Next.js's `register()` hook because there is no second process).
- **`apps/yoink/src/db/schema.ts`** — sample of Drizzle schema-module conventions (one file, one named export per table). Swole's `schema.ts` follows the same shape with `sqliteTable` instead of `pgTable`.
- **`docs/plans/2026-05-26-002-feat-swole-session-machine-plan.md`** — Survivor 2 plan; sets the style precedent for U-IDs, test-scenario granularity, and per-unit verification.
- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — confirms FSM is the source of truth; the data layer maps to it, not the other way around. The schema does not import FSM types; both translation directions (DB row → `SetLog` via `toSetLog`, and `SetLog` → DB args via `toSetLogArgs`) live in `src/db/mappers.ts`.

### Institutional Learnings

- `docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md` — applies directly. "The FSM is the domain truth; the DB is infrastructure" sets the import direction: data layer imports FSM types, FSM never imports schema or Drizzle. This plan honors that contract in `mappers.ts` (both translation directions) and `hydration.ts` (composition).

### External References

- [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started/sqlite-new) — canonical `drizzle/better-sqlite3` + `migrate` pattern. Confirms `drizzle-orm/better-sqlite3` and `drizzle-orm/better-sqlite3/migrator` as the right entry points for Drizzle 0.45+.
- [Drizzle migrations docs](https://orm.drizzle.team/docs/migrations) — confirms `drizzle-kit generate` + `migrate()` pattern; the `__drizzle_migrations` table makes re-application a no-op.
- [Next.js instrumentation.ts file conventions](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) — `register()` is auto-detected (no `experimental.instrumentationHook` flag needed in Next.js 15+); supported in `output: 'standalone'`.
- [vercel/next.js#49897](https://github.com/vercel/next.js/issues/49897) — historical bug where instrumentation didn't fire in standalone mode; fixed in Next.js 15. Confirms that swole's Next.js 16 standalone build will run the hook.
- [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3) — current stable is v12.10.0. Combined with the [Node 24/25 prebuilt binary issue](https://github.com/WiseLibs/better-sqlite3/issues/1384), pinning to v12.10.0 is safer than v11 on the `node:25.0.0-slim` base image used by `lilnas-nextjs-runtime`.

---

## Key Technical Decisions

- **Pinned versions.** `drizzle-orm: ^0.45.1` and `drizzle-kit: ^0.31.9` (dev) — matches yoink/token/tdr-bot, which use the same versions for PostgreSQL. Both support `dialect: 'sqlite'` via separate sub-paths. `better-sqlite3: ^12.10.0` (latest stable, with Node 25 prebuilt binaries) instead of v11 because the `lilnas-nextjs-runtime` base extends `node:25.0.0-slim` and v11 may not ship Node 25 N-API binaries (resolves the brainstorm's Outstanding Question on R1). `@types/better-sqlite3: ^7.6.x` as a devDependency.
- **`instrumentation.ts` location: `apps/swole/src/instrumentation.ts`.** R22 wrote `apps/swole/instrumentation.ts` but swole uses `src/` throughout. Next.js accepts both root and `src/`; placing it under `src/` matches the rest of swole's layout and the `tsconfig.json` `include` pattern (`src/**/*.ts`). The `register()` semantics are identical.
- **Migrate-on-boot via `instrumentation.ts` register hook.** Single-process, single-user app — no race risk. The alternative (explicit `pnpm db:migrate` before `pnpm start`, as yoink/token/tdr-bot do) is friction without payoff for a Next.js-only service. Guard the migrate call with `if (process.env.NEXT_RUNTIME === 'nodejs')` so it never fires in Edge runtime; throw on migration failure so the process crashes loudly (Docker restart-on-failure handles the rest).
- **Reorder during active session is rejected, not handled.** R30's outstanding question is resolved in favor of *guard*, not *rebuild*. `reorderExercises(routineId, orderedIds[])` queries for any `sessions` row with `routine_id = routineId AND completed_at IS NULL`; throws `ReorderBlockedByActiveSession` if any. Same spirit as "no routine snapshot" — the implicit "don't do that mid-set" contract gets a load-bearing guardrail. Hydration still translates `exercise_id → exerciseIdx` deterministically via routine order, which is correct regardless because the gating prevents the ambiguity from ever materializing.
- **Hard-delete in `undoLastSetLog`.** Matches FSM `setLogs.slice(0, -1)` semantics. Undo is not auditable history; once a `session_progression` row exists for the session, undo rejects (R32), so the hard-delete window is bounded to "before any progression has committed". Resolves the brainstorm's Outstanding Question on R26.
- **`synchronous = NORMAL` on PRAGMA open.** WAL handles crash safety adequately for a personal-data file. `FULL` adds write latency for marginal durability improvement; revisit only if real data loss is observed. Resolves the brainstorm's Outstanding Question on R6.
- **`set_number` is 1-indexed in DB, 0-indexed in FSM.** Translation at the persistence boundary in `mappers.ts` — `toSetLogArgs` writes `set_number = setLog.setIdx + 1`; `toSetLog` reads `setIdx = row.set_number - 1`. Reason: the DB is what someone reads in the `sqlite3` CLI; humans count from 1. The FSM is what code reads; arrays count from 0. (Carried verbatim from brainstorm Key Decisions.)
- **`exercises.starting_weight` is canonical; `progressions` is audit + chart.** Reads only ever look at `exercises.starting_weight` for the current value. The `progressions` table is the chart source and audit log. Every mutation that writes a `session_progression` or `manual_edit` row also updates `exercises.starting_weight` *in the same transaction* — this is the contract that `commitProgressionDecision` and the `starting_weight`-branch of `updateExercise` enforce. (Carried from brainstorm.)
- **Schema doesn't import FSM types; mapping lives in `mappers.ts`.** `schema.ts` defines DB row shapes; FSM defines domain shapes. A `set_logs` row has `id`, `session_id`, `exercise_id`, `set_number`, `logged_at`; a `SetLog` has `exerciseIdx`, `setIdx`, no `session_id`. The translation is symmetric — `toSetLog` (DB → domain) and `toSetLogArgs` (domain → DB args) — both in `mappers.ts`. Drizzle's inferred `typeof setLogs.$inferSelect` stays out of `src/core/`.
- **`'server-only'` import at the top of `src/db/client.ts`.** Defensive — prevents a future client component from accidentally importing the Drizzle client and bundling `better-sqlite3` into the browser bundle. Cheap to add; closes a real footgun.
- **`next/cache` is mocked at the test-file level.** `revalidatePath` / `revalidateTag` only work inside the Next.js request context. Every mutation test file mocks `next/cache` via `jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn() }))` at the top. Avoids polluting `jest.config.js` with a global `setupFiles` for what is really a per-suite mock concern.
- **`db.transaction(tx => ...)` for multi-table mutations.** `better-sqlite3` transactions are synchronous and cannot accept async callbacks. Drizzle's `db.transaction(tx => ...)` on better-sqlite3 returns synchronously and rolls back if the callback throws. Mutations that touch two tables (`createExercise` for weighted, `updateExercise` when `starting_weight` changed, `commitProgressionDecision`) wrap their work in a `tx` callback. Mutations that touch one table (`appendSetLog`, `archiveRoutine`) skip the wrapper.
- **Inside `db.transaction(tx => ...)`, every DB call MUST use `tx`, never the outer `db`.** Calls that go through `db` inside a `tx` callback execute *outside* the transaction's atomic scope on better-sqlite3 — they commit unconditionally regardless of whether the surrounding `tx` rolls back. This is a silent footgun, especially for implementers copy-pasting from `apps/yoink/src/db/` where the async/await ergonomics blur the distinction. Atomicity tests in U6/U10 explicitly force this case: force a CHECK violation on the second statement and assert the first did NOT persist. (Reviewer-driven addition.)
- **Read-then-modify mutations use `db.transaction(callback, { behavior: 'immediate' })`.** Drizzle's default better-sqlite3 transaction mode is `BEGIN DEFERRED` (read lock acquired lazily). For mutations that check state and then act based on that check — `undoLastSetLog` (checks for `session_progression` rows then deletes), `reorderExercises` (checks for active sessions then updates), `updateExercise` (reads existing `starting_weight` then conditionally writes a `manual_edit` row), `archiveRoutine`/`archiveExercise` (checks for active sessions) — `DEFERRED` is unsafe across concurrent tabs because a second writer can interleave between read and write. `BEGIN IMMEDIATE` acquires the write lock at transaction start, serializing these reads with subsequent writes. Verify Drizzle 0.45 supports the `behavior` option; if not, fall back to a raw `sqlite.prepare('BEGIN IMMEDIATE').run()` at the top of the callback. (Reviewer-driven addition addressing TOCTOU risks across multi-tab usage.)
- **Partial unique index enforces "at most one active session per routine."** `CREATE UNIQUE INDEX one_active_session_per_routine ON sessions(routine_id) WHERE completed_at IS NULL`. Encoded in `schema.ts` as a partial unique index. This DB-enforced invariant makes `startSession`-while-reorder-in-flight (and analogous races) impossible without the mutations needing to coordinate. It also matches the product reality: a user with one body cannot literally have two sessions of the same routine running at once. (Reviewer-driven addition replacing a read-then-modify guard with a DB invariant.)
- **`appendSetLog` always throws `DuplicateSetLog` on UNIQUE constraint violation; never silently no-ops.** The brainstorm and original plan considered "silent no-op" as a valid implementation choice. Reviewer feedback rejects this: a duplicate `(session_id, exercise_id, set_number)` does NOT necessarily mean the same action was retried — the persisted row's `weight`/`actualReps`/`action` may differ from the optimistic FSM computation. Silent no-op makes those divergences invisible, and the next hydration would show a `SetLog` the client never thought it persisted. Contract: `appendSetLog` catches `SQLITE_CONSTRAINT_UNIQUE`, re-queries the existing row by the key, and throws `DuplicateSetLog` carrying that row in its payload. The caller (Survivor 4's server action wrapper) is responsible for comparing the existing row field-by-field against the FSM's computed `SetLog`; if they diverge, force a client re-hydration. Tested in U6. (Reviewer-driven correctness fix.)
- **Archive mutations (`archiveRoutine`, `archiveExercise`) reject while any active session exists on the affected routine.** Without this guard, `getRoutineWithExercises(routineId)` in `hydration.ts` (which defaults to excluding archived rows) would either drop the archived exercise from the hydrated routine — causing `toSetLog`'s `findIndex` to return `-1` for that exercise's set_logs and throwing — or return a routine missing exercises the active session has logs against. Both render the session un-resumable. Same `BEGIN IMMEDIATE` discipline as `reorderExercises`. (Reviewer-driven correctness fix.)
- **Hydration always reads with `includeArchived: true`.** Even with the archive-guards above, a session that completes shortly after an exercise is archived (e.g., race between archive and the last set log) might land with archived exercises still referenced by its set_logs. `buildSessionState` passes `includeArchived: true` to `getRoutineWithExercises` so the full original routine is always reconstructable from set_log evidence. The runner UI (Survivor 4) may then gray out archived exercises visually, but the hydration layer never loses data. (Reviewer-driven correctness fix.)
- **`updateExercise`'s `starting_weight` patch reads the existing value INSIDE the transaction.** The "did `starting_weight` change?" comparison MUST happen inside the same `db.transaction({ behavior: 'immediate' }, tx => ...)` as the conditional `manual_edit` write and the `exercises.starting_weight` update. A read outside the transaction risks racing with `commitProgressionDecision` and producing an inconsistent `progressions` audit trail. (Reviewer-driven correctness fix.)
- **Schema enforces `set_number >= 1` and `exercises.sets >= 1` via CHECK constraints.** The 1-indexed `set_number` convention has no DB-level guard in the brainstorm's R16; a caller bug that writes `set_number = 0` would compute `setIdx = -1` in hydration and silently corrupt the FSM's reconstruction. Cheap defensive CHECK constraints at the schema layer convert this from "silent corruption" to "loud insert failure." (Reviewer-driven addition.)
- **`migrationsFolder` resolves via `path.join(__dirname, 'migrations')`, not relative to CWD.** Drizzle's `migrate(db, { migrationsFolder: './src/db/migrations' })` is process-CWD-relative, which couples migration application to whichever directory the runtime happened to be launched from. The Dockerfile sets `WORKDIR /app`, but any future refactor or local-test invocation that runs from a different CWD silently breaks migrations. `__dirname`-relative resolution is process-location-independent. (Reviewer-driven robustness fix.)
- **`'server-only'` import on every file under `src/db/` except `schema.ts`, `test-db.ts`, and `mappers.ts`.** `schema.ts` and `mappers.ts` are pure (types + translation functions); `test-db.ts` is test-only. Everything else (`client.ts`, `migrate.ts`, `hydration.ts`, all of `queries/`, all of `mutations/`) imports `'server-only'` at the top. Defense in depth — prevents a future refactor that imports a query helper into a client component from silently bundling `better-sqlite3`. (Reviewer-driven addition.)
- **Migrations are append-only; editing a committed `.sql` file is a code-review-blocking offense.** Drizzle's `__drizzle_migrations` table tracks applied state by filename + hash, so an edited migration is either silently skipped (if hash unchanged) or treated as a new migration to apply (if hash changed, which would re-run on an already-migrated DB and likely error). Production divergence from `:memory:` tests is invisible from inside a test run. Documented in `apps/swole/README.md` and a CI check that diffs `apps/swole/src/db/migrations/*.sql` against `main` and fails if any existing file is modified. (Reviewer-driven safety guarantee.)
- **Symmetric FSM↔DB translation lives in `src/db/mappers.ts`.** The original plan named `mutations/setLogs.ts` as one of two translation seams; reviewer feedback noted that `appendSetLog` actually takes primitive args, so no translation lives there. The two real translation helpers — `toSetLog(row, routine)` (DB → FSM) and `toSetLogArgs(setLog, routine)` (FSM → DB args for `appendSetLog`) — both live in `src/db/mappers.ts` and are consumed by `hydration.ts`, U8's round-trip test, and Survivor 4's server action wrapper. Schema still doesn't import FSM types; mappers do the unidirectional import. (Reviewer-driven boundary clarification.)
- **Test layout: adjacent `.spec.ts` files; integration tests live in `src/db/__integration__/`.** Unit tests (queries/mutations/hydration) live adjacent to source. The PRD F2/F3 end-to-end walkthrough is a cross-cutting test that doesn't pair with a single source file, so it lives at `apps/swole/src/db/__integration__/prd-walkthrough.spec.ts`. Both directories are picked up by Jest's `testMatch`.
- **In-memory test DB factory in `src/db/test-db.ts`.** `createTestDb(): { db, close }` returns a fresh `better-sqlite3(':memory:')` Drizzle instance with migrations applied and PRAGMAs set, alongside a `close` callable. Every test calls `const { db, close } = createTestDb()` in `beforeEach` (or destructures directly inside the test body) and `afterEach(() => close())`. The wrapper-object shape (reviewer-driven boundary fix) ensures `db` has the same type as production's `db` and gives test authors exactly one escape hatch (`close()`) — no raw `better-sqlite3` connection on the returned shape. No global state; each test gets a clean DB.

---

## Open Questions

### Resolved During Planning

- **`drizzle-orm` and `drizzle-kit` version pins?** `^0.45.1` and `^0.31.9` (matches yoink/token/tdr-bot).
- **`better-sqlite3` version pin?** `^12.10.0` — latest stable with Node 25 N-API support. (Brainstorm said "v11+ compatible with Node 20+", but `lilnas-nextjs-runtime` uses Node 25; v11 may not ship Node 25 N-API prebuilts per WiseLibs/better-sqlite3#1384.)
- **`synchronous` PRAGMA value?** `NORMAL`. WAL handles crash safety.
- **`instrumentation.ts` placement: root or `src/`?** `src/instrumentation.ts`. Matches swole's layout; Next.js 16 accepts both.
- **Migrations-on-boot in standalone Next.js 16?** Confirmed via Next.js docs and #49897 resolution — `register()` fires in standalone mode in Next.js 15+. Guard with `process.env.NEXT_RUNTIME === 'nodejs'`.
- **`undoLastSetLog` hard-delete vs soft-delete?** Hard-delete. Bounded undo window (rejected after any `session_progression` row), so no audit-log motivation.
- **Reorder during active session?** Reject via guard in `reorderExercises`. Matches "no routine snapshot" spirit.
- **Test framework — Jest or vitest?** Jest. Already configured; consistency with `session-machine.spec.ts`.
- **Test DB strategy — file-based or `:memory:`?** `:memory:`. Faster, no cleanup, fully isolated per test.
- **Where does the FSM ↔ DB mapping live?** In `src/db/mappers.ts` — `toSetLog` (DB row → FSM `SetLog`) and `toSetLogArgs` (FSM `SetLog` → primitive args for `appendSetLog`). The FSM module does not import from `src/db/`; the schema module does not import from `src/core/`; `mappers.ts` is the unidirectional bridge between them.
- **Should `appendSetLog` accept a full `SetLog` or just primitive args?** Primitive args (`{ sessionId, exerciseId, setNumber, weight?, targetReps?, actualReps?, durationSeconds?, action }`). The caller (Survivor 4's server action wrapper) is the one translating from the FSM's `SetLog` to these args; `appendSetLog` itself is a thin Drizzle insert. This keeps the data layer independent of any specific FSM revision.
- **`set_logs.duration_seconds` column — does the FSM `actualDuration` field also persist?** Yes. `set_logs` adds an `actual_duration_seconds` column to mirror `actualReps` ↔ `actual_reps`. The FSM's `SetLog.actualDuration` (set on `Failed` of time-based exercises) maps to it. (Tightens R16 slightly — R16 lists `duration_seconds?` as the only duration column, but the FSM's split between `duration` and `actualDuration` requires both. Schema gets `duration_seconds` and `actual_duration_seconds`.)

### Deferred to Implementation

- **Exact migration filename(s).** Drizzle Kit generates names like `0000_<random_adjective>_<random_noun>.sql`. The implementer commits whatever name `drizzle-kit generate` produces; the meta journal tracks application state regardless.
- **Specific revalidate path/tag values per mutation.** ADR-001 prescribes the pattern; the exact paths depend on Survivor 4's route layout (`/routines/[id]`, `/session/[id]`, `/stats/[exerciseId]`). The implementer picks the obvious path per mutation (e.g., `createExercise` invalidates `/routines/${routineId}`) and Survivor 4 refines if the route table changes.
- **Whether to expose `getActiveSession(sessionId)` as a single composite query (session + set_logs + routine + progressions in one server-component call) or as separate query functions.** Both work; the hydration helper composes them either way. Implementer's call based on what feels cleanest when calling from a Next.js server component.
- **CHECK constraint expression style.** Drizzle's `sqliteTable` accepts a `check()` constraint or raw `sql\`\`` predicates. The constraint logic is fixed (R14), but the syntax form is implementer's call.
- **Exact error-class hierarchy.** The plan names two distinct errors (`ReorderBlockedByActiveSession`, `UndoBlockedByCommittedProgression`, optionally `DuplicateSetLog`). The implementer decides whether they share a base `SwoleDbError` or stand alone; either is fine.

---

## Output Structure

```text
apps/swole/
├── .gitignore                              # MODIFY: add swole.db
├── drizzle.config.ts                       # NEW
├── package.json                            # MODIFY: deps + db:generate script
├── deploy.yml                              # MODIFY (or .env.swole): DATABASE_PATH
├── Dockerfile                              # MODIFY: ship migrations folder
└── src/
    ├── env.ts                              # MODIFY: add DATABASE_PATH to EnvKeys
    ├── instrumentation.ts                  # NEW: register() hook for migrate()
    └── db/                                 # NEW
        ├── client.ts                       # singleton + PRAGMAs + 'server-only'
        ├── client.spec.ts                  # PRAGMA + singleton tests
        ├── schema.ts                       # 5 tables + notArchived helper
        ├── schema.spec.ts                  # FK + CHECK + UNIQUE enforcement tests
        ├── migrate.ts                      # runMigrations(db); path via __dirname
        ├── test-db.ts                      # createTestDb() → { db, close }
        ├── mappers.ts                      # toSetLog (DB→FSM), toSetLogArgs (FSM→DB args)
        ├── mappers.spec.ts                 # symmetric translation tests
        ├── hydration.ts                    # buildSessionState() composes queries + mappers
        ├── hydration.spec.ts               # round-trip + archived-parent tests
        ├── migrations/                     # generated by drizzle-kit
        │   ├── 0000_<name>.sql
        │   └── meta/
        │       ├── _journal.json
        │       └── 0000_snapshot.json
        ├── queries/
        │   ├── routines.ts
        │   ├── routines.spec.ts
        │   ├── exercises.ts
        │   ├── exercises.spec.ts
        │   ├── sessions.ts
        │   ├── sessions.spec.ts
        │   ├── setLogs.ts
        │   ├── setLogs.spec.ts
        │   ├── progressions.ts
        │   └── progressions.spec.ts
        ├── mutations/
        │   ├── routines.ts
        │   ├── routines.spec.ts
        │   ├── exercises.ts
        │   ├── exercises.spec.ts
        │   ├── sessions.ts
        │   ├── sessions.spec.ts
        │   ├── setLogs.ts
        │   ├── setLogs.spec.ts
        │   ├── progressions.ts
        │   └── progressions.spec.ts
        └── __integration__/
            └── prd-walkthrough.spec.ts     # F2/F3 end-to-end
```

*This is a scope declaration showing the expected output shape. The implementer may consolidate or split files (e.g., merge tiny query/mutation files) if implementation reveals a better layout; per-unit `**Files:**` sections remain authoritative.*

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

The data layer has three integration seams worth visualizing.

### 1. FSM ↔ DB mapping

```text
                    write path (FSM → DB)                          read path (DB → FSM)
                    ───────────────────────                        ───────────────────────
SetLog              {                                              {
  exerciseIdx: 0      exerciseIdx → routine.exercises[0].id          exerciseIdx ← derived from
  setIdx: 2           setIdx + 1   → set_number                          routine.exercises.findIndex(
  weight: 105         weight       → weight                             e => e.id === row.exercise_id
  reps: 10            reps         → target_reps                      )
  actualReps: 10      actualReps   → actual_reps                      setIdx ← row.set_number - 1
  action: Stay        action       → action (text enum)               weight ← row.weight
}                   }                                              }

                    appendSetLog({ sessionId, exerciseId,           buildSessionState(sessionId):
                      setNumber, weight, ... })                        rows = getSetLogsForSession(sessionId)
                                                                       routine = getRoutineForSession(sessionId)
                                                                       return {
                                                                         setLogs: rows.map(row =>
                                                                           toSetLog(row, routine)
                                                                         )
                                                                       }
```

The mapping is one-way on each side. Schema never imports FSM types; FSM never imports schema. Both translation directions live in `src/db/mappers.ts` — `toSetLogArgs` (FSM → DB args) and `toSetLog` (DB row → FSM `SetLog`). `mappers.ts` is the only file under `src/db/` that imports FSM types (and only as types, with a compile-time enum-drift assertion). Both functions are pinned by tests in U8.

### 2. Mutation transaction boundaries

| Mutation | Tables touched | Transaction? | Notes |
|---|---|---|---|
| `createRoutine` | `routines` | no | single insert |
| `updateRoutine` | `routines` | no | single update; bumps `updated_at` |
| `archiveRoutine` | `routines`, reads `sessions` for guard | **yes (IMMEDIATE)** | guard + UPDATE; rejects if any active session exists |
| `createExercise` | `exercises`, `progressions` (weighted only) | **yes** | initial progression row in same tx (R20) |
| `updateExercise` | `exercises`, `progressions` (if `starting_weight` changed) | **yes (IMMEDIATE)** | reads existing SW + manual_edit row in same tx (R26) |
| `archiveExercise` | `exercises`, reads `sessions` for guard | **yes (IMMEDIATE)** | guard + UPDATE; rejects if any active session exists |
| `reorderExercises` | `exercises`, reads `sessions` for guard | **yes (IMMEDIATE)** | guard + bulk update of `order_in_routine` |
| `startSession` | `sessions` | no | single insert; partial unique index enforces "at most one active per routine" |
| `appendSetLog` | `set_logs` | no | single insert; UNIQUE constraint surfaces as `DuplicateSetLog` (always throws, never silent) |
| `undoLastSetLog` | `set_logs`, reads `progressions` for guard | **yes (IMMEDIATE)** | guard + delete; tiebreak by `id DESC` |
| `commitProgressionDecision` | `progressions`, `exercises` | **yes (IMMEDIATE)** | new progression row + canonical SW update (R19) |
| `completeSession` | `sessions` | no | sets `completed_at` |

### 3. Boot sequence

```text
Container starts
   ↓
Next.js server boots (production: node server.js; dev: next dev)
   ↓
instrumentation.ts `register()` fires (Next 15+: works in standalone)
   ↓
if NEXT_RUNTIME === 'nodejs':
   ↓
   import db from './db/client'    ← singleton instantiates; PRAGMAs applied
   ↓
   runMigrations(db)               ← drizzle-orm/better-sqlite3/migrator
   ↓
   migrations folder: ./src/db/migrations    ← shipped in Docker image
   ↓
   __drizzle_migrations tracks applied state; re-runs are no-ops
   ↓
   logger.info('migrations applied')
   ↓
Server ready to handle requests
```

Failure mode: if migration throws, `register()` propagates the error and Next.js fails to come up. Docker `restart: unless-stopped` keeps trying; logs show the migration SQL that failed. This is the desired loud-failure behavior — running on a partially-migrated DB is the *real* hazard.

### Schema sketch (directional)

```ts
// apps/swole/src/db/schema.ts — DIRECTIONAL, not literal
import { check, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const routines = sqliteTable('routines', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  days: text({ mode: 'json' }).$type<DayCode[]>().notNull(),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
})

export const exercises = sqliteTable('exercises', {
  id: integer().primaryKey({ autoIncrement: true }),
  routineId: integer('routine_id').notNull().references(() => routines.id, { onDelete: 'restrict' }),
  name: text().notNull(),
  type: text({ enum: ['weighted', 'bodyweight', 'time-based', 'cardio'] }).notNull(),
  orderInRoutine: integer('order_in_routine').notNull(),
  sets: integer().notNull(),
  targetReps: integer('target_reps'),
  startingWeight: integer('starting_weight'),
  increment: integer(),
  durationSeconds: integer('duration_seconds'),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).$defaultFn(() => new Date()).notNull(),
}, t => [
  check('exercise_type_fields_match',
    sql`(
      (type = 'weighted'    AND target_reps IS NOT NULL AND starting_weight IS NOT NULL AND increment IS NOT NULL AND duration_seconds IS NULL) OR
      (type = 'bodyweight'  AND target_reps IS NOT NULL AND starting_weight IS NULL     AND increment IS NULL     AND duration_seconds IS NULL) OR
      (type = 'time-based'  AND target_reps IS NULL     AND starting_weight IS NULL     AND increment IS NULL     AND duration_seconds IS NOT NULL) OR
      (type = 'cardio'      AND target_reps IS NULL     AND starting_weight IS NULL     AND increment IS NULL     AND duration_seconds IS NOT NULL AND sets = 1)
    )`
  ),
])

// ... sessions, set_logs (with UNIQUE constraint), progressions follow same shape ...

export const notArchived = (table: { archivedAt: typeof routines.archivedAt }) =>
  sql`${table.archivedAt} IS NULL`
```

### Client sketch (directional)

```ts
// apps/swole/src/db/client.ts — DIRECTIONAL
import 'server-only'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { env } from '@lilnas/utils/env'
import { EnvKeys } from 'src/env'
import * as schema from './schema'

function instantiate() {
  const sqlite = new Database(env(EnvKeys.DATABASE_PATH, './swole.db'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return drizzle(sqlite, { schema })
}

declare global { var __swoleDb: ReturnType<typeof instantiate> | undefined }

export const db =
  process.env.NODE_ENV === 'production'
    ? instantiate()
    : (globalThis.__swoleDb ??= instantiate())
```

---

## Implementation Units

- U1. **Bootstrap: dependencies, env keys, gitignore, Drizzle config**

**Goal:** Land everything needed to run `drizzle-kit generate` and instantiate a Drizzle/better-sqlite3 client, but no domain code yet. After this unit, `pnpm install` resolves cleanly, `pnpm --filter @lilnas/swole type-check` and `lint` still pass, and `pnpm --filter @lilnas/swole db:generate` is wired up (though there's nothing to generate yet since schema.ts doesn't exist).

**Requirements:** R1, R2, R3, R23

**Dependencies:** None

**Files:**
- Modify: `apps/swole/package.json`
- Modify: `apps/swole/src/env.ts`
- Modify: `apps/swole/.gitignore` (create if absent at app level — the monorepo root `.gitignore` already covers most; verify swole-level addition is needed for `swole.db`)
- Modify: `infra/.env.swole.example` — add `DATABASE_PATH=./swole.db`
- Create: `apps/swole/drizzle.config.ts`

**Approach:**
- Add to `dependencies`: `"drizzle-orm": "^0.45.1"`, `"better-sqlite3": "^12.10.0"`.
- Add to `devDependencies`: `"drizzle-kit": "^0.31.9"`, `"@types/better-sqlite3": "^7.6.13"`.
- Add to `scripts`: `"db:generate": "drizzle-kit generate"`.
- `src/env.ts`: append `DATABASE_PATH: 'DATABASE_PATH'` to `EnvKeys`.
- `infra/.env.swole.example`: append `DATABASE_PATH=./swole.db` for the dev default.
- Add `swole.db` and `swole.db-journal` and `swole.db-wal` and `swole.db-shm` to the swole-app gitignore (either `apps/swole/.gitignore` or extend root `.gitignore` with `apps/swole/swole.db*`).
- `drizzle.config.ts`:
  ```ts
  import { defineConfig } from 'drizzle-kit'
  export default defineConfig({
    schema: './src/db/schema.ts',
    out: './src/db/migrations',
    dialect: 'sqlite',
    dbCredentials: { url: process.env.DATABASE_PATH ?? './swole.db' },
  })
  ```

**Patterns to follow:**
- `apps/yoink/drizzle.config.ts`, `apps/token/drizzle.config.ts` — same `defineConfig` shape, just `dialect: 'sqlite'` instead of `'postgresql'`.
- `apps/swole/src/env.ts` existing `EnvKeys` `as const` shape.

**Test scenarios:**
- Test expectation: none — config + dependency setup. Lint + type-check are the gate.

**Verification:**
- `pnpm install` succeeds; `pnpm-lock.yaml` updates with the new packages.
- `pnpm --filter @lilnas/swole type-check` passes.
- `pnpm --filter @lilnas/swole lint` passes.
- `pnpm --filter @lilnas/swole db:generate` runs (will error because `schema.ts` doesn't exist yet — fine; it's wired up correctly).

---

- U2. **Schema: 5 tables, CHECK constraint, UNIQUE constraint, notArchived helper**

**Goal:** Define all five tables in `apps/swole/src/db/schema.ts` with FKs (`ON DELETE RESTRICT`), the per-type CHECK constraint on `exercises`, the UNIQUE constraint on `set_logs(session_id, exercise_id, set_number)`, integer PKs, and `timestamp_ms` columns. Generate the initial migration with `drizzle-kit generate` and commit the resulting SQL + meta files. Adjacent spec file asserts that FK / CHECK / UNIQUE enforcement is real (the spec file exists in this unit; the assertions are filled in once the test-db helper exists in U4 — for now, structural placeholder tests are sufficient and U4 wires the helper).

**Requirements:** R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R21

**Dependencies:** U1

**Files:**
- Create: `apps/swole/src/db/schema.ts`
- Create: `apps/swole/src/db/schema.spec.ts`
- Create (via drizzle-kit): `apps/swole/src/db/migrations/0000_<name>.sql` and `apps/swole/src/db/migrations/meta/_journal.json` and `apps/swole/src/db/migrations/meta/0000_snapshot.json`

**Approach:**
- Define five `sqliteTable` exports: `routines`, `exercises`, `sessions`, `setLogs`, `progressions`. Use camelCase JS property names mapped to snake_case DB columns where divergent.
- Use `integer({ mode: 'number' }).primaryKey({ autoIncrement: true })` on every PK.
- Use `integer({ mode: 'timestamp_ms' })` on every timestamp column; default applicable ones via `$defaultFn(() => new Date())`.
- FK references via `.references(() => routines.id, { onDelete: 'restrict' })`.
- `routines.days` as `text({ mode: 'json' }).$type<DayCode[]>().notNull()` where `DayCode = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'`. Define `DayCode` near the top of the schema module (it's a DB-layer concept).
- `exercises.type` as `text({ enum: ['weighted', 'bodyweight', 'time-based', 'cardio'] }).notNull()`.
- `exercises` CHECK constraints via the third arg to `sqliteTable` (Drizzle 0.45+ pattern). Two CHECK constraints on this table:
  - `exercise_type_fields_match` — R14's four-branch per-type field-presence rule.
  - `exercise_sets_positive` — `sets >= 1` (cheap caller-bug guard; cardio's `sets = 1` is already implied by the type-branch constraint).
- `set_logs.action` as `text({ enum: [...] }).notNull()` with the eight enum values from R16 (deliberately excluding `JumpTo` — the FSM never persists a log on JumpTo).
- `set_logs` UNIQUE constraint on `(session_id, exercise_id, set_number)` via the third arg.
- `set_logs` CHECK constraint `set_number_one_indexed` — `set_number >= 1`. Defensive guard against caller bugs that would corrupt hydration's `setIdx = set_number - 1` translation. (Reviewer-driven addition.)
- `set_logs` adds `actual_duration_seconds` column (not in R16 verbatim but required by the FSM's `actualDuration` field; see Resolved Open Questions).
- `progressions.reason` as `text({ enum: ['initial', 'session_progression', 'manual_edit'] }).notNull()`.
- `sessions` partial unique index `one_active_session_per_routine`: `CREATE UNIQUE INDEX one_active_session_per_routine ON sessions(routine_id) WHERE completed_at IS NULL`. Encoded via `sqliteTable`'s third-arg constraint helpers (Drizzle 0.45's `uniqueIndex(...).where(sql\`completed_at IS NULL\`)` or a raw `sql\`\`` migration if Drizzle Kit cannot emit partial indexes — fall back is acceptable). Closes the TOCTOU window between `startSession` and `reorderExercises`. (Reviewer-driven addition.)
- Export `notArchived(table)` helper at the bottom of the module — a typed `sql\`\`` predicate reusable across queries.
- Run `pnpm --filter @lilnas/swole db:generate` to produce the initial migration. Commit the generated SQL and meta files.
- `schema.spec.ts` placeholder: one `describe('schema module', () => { it.todo(...) })` block per table. Real assertions come in U4/U5/U6 when the test-db helper is available.

**Execution note:** Test-first works less well here than for behavior code — the schema is the contract, and the implementer iterates on `schema.ts` → `db:generate` → inspect SQL → repeat until the generated SQL matches the brainstorm's spec. The first round of real assertions (FK enforcement, CHECK enforcement, UNIQUE enforcement) lands in U4 once the test-db helper exists.

**Patterns to follow:**
- `apps/yoink/src/db/schema.ts` — for the one-module / one-export-per-table convention and the constraint syntax.
- Drizzle SQLite docs (linked in Context & Research) — for `sqliteTable`, `check`, `unique`, `text({ mode: 'json' })`.

**Test scenarios:**
- (Real assertions deferred to U4/U5/U6 where the test-db helper enables them.)
- Static/structural: `schema.spec.ts` has one `describe` block per table with `it.todo()` placeholders for FK / CHECK / UNIQUE / archive enforcement. This is documentation-as-code that the next units fill in.

**Verification:**
- `pnpm --filter @lilnas/swole db:generate` produces `0000_<name>.sql` with all five tables, `CREATE INDEX` lines for FK columns (Drizzle generates these automatically), the `CHECK` constraint clauses on `exercises` and `set_logs`, the `UNIQUE` constraint on `set_logs`, and the partial unique index on `sessions`.
- Manual SQL inspection: open the generated `.sql` file and confirm — five `CREATE TABLE` statements, `FOREIGN KEY ... ON DELETE RESTRICT` on every FK, the `exercises` CHECK clause's four branches match R14 verbatim, the `set_logs` `set_number >= 1` CHECK is present, the UNIQUE constraint on `(session_id, exercise_id, set_number)` is present, and the partial unique index `one_active_session_per_routine` is present with `WHERE completed_at IS NULL`.
- Static CI-grade regression test inside `schema.spec.ts` (added later in U4 when the test-db helper exists, but verify the migration file content here): a test reads the latest migration `.sql` file from `apps/swole/src/db/migrations/` and regex-matches the four type-branch substrings `type = 'weighted'`, `type = 'bodyweight'`, `type = 'time-based'`, `type = 'cardio'`. Fails loudly if any are missing — prevents a future Drizzle Kit refactor from silently dropping the constraint. (Reviewer-driven addition.)
- `pnpm --filter @lilnas/swole type-check` passes (Drizzle's inferred row types compile).
- `pnpm --filter @lilnas/swole lint` passes.
- `pnpm --filter @lilnas/swole test schema` runs and reports the `it.todo()` placeholders.

---

- U3. **Client + 'server-only' + globalThis singleton + PRAGMAs**

**Goal:** Land `apps/swole/src/db/client.ts` that exports a single `db` Drizzle instance backed by `better-sqlite3`. Singleton via `globalThis.__swoleDb` in dev; one-shot in production. PRAGMAs applied on every open. `'server-only'` import at the top to prevent client-bundling. Adjacent spec asserts PRAGMA values via `db.pragma()` reads (not migrations — that's U4).

**Requirements:** R4, R5, R6

**Dependencies:** U1

**Files:**
- Create: `apps/swole/src/db/client.ts`
- Create: `apps/swole/src/db/client.spec.ts`

**Approach:**
- `import 'server-only'` at the top (add the `server-only` package as a dependency — it's already transitively present via Next.js, but explicitly listing it via `pnpm add server-only --filter @lilnas/swole` makes the dependency intent visible).
- Define `instantiate()` per the Client sketch above: open `better-sqlite3(env(DATABASE_PATH, './swole.db'))`, apply four PRAGMAs, wrap in `drizzle(sqlite, { schema })`.
- Export `db`: production-mode does one-shot `instantiate()`; non-production uses `globalThis.__swoleDb ??= instantiate()`.
- Declare `globalThis.__swoleDb` via `declare global { var __swoleDb: ... }`.
- The PRAGMA order matters: `foreign_keys = ON` must be set after the connection opens but before any query runs. `journal_mode = WAL` should be set early (it has side effects on the file). The PRAGMAs run synchronously in order.
- `client.spec.ts`: instantiate a fresh in-memory client (bypass the singleton by importing the `instantiate` function directly — refactor it to be exported for testing, or duplicate the PRAGMA application in the test). Assert: `db.pragma('journal_mode')` returns `'wal'`, `db.pragma('synchronous')` returns `1` (NORMAL = 1), `db.pragma('foreign_keys')` returns `1`, `db.pragma('busy_timeout')` returns `5000`.

**Patterns to follow:**
- Drizzle SQLite docs for the `drizzle/better-sqlite3` entry point.
- No direct lilnas precedent — first SQLite consumer.

**Test scenarios:**
- Happy path: `journal_mode` is `wal` after open. Covers R6.
- Happy path: `synchronous` is `1` (NORMAL) after open. Covers R6.
- Happy path: `foreign_keys` is `1` (ON) after open. Covers R6 — this one is load-bearing; without it, `ON DELETE RESTRICT` is silent.
- Happy path: `busy_timeout` is `5000` after open. Covers R6.
- Happy path (dev singleton): in `NODE_ENV !== 'production'`, importing `db` twice (via `jest.isolateModules` to force re-evaluation) returns the same instance. Set `globalThis.__swoleDb = undefined` in `beforeEach`, then re-import twice in separate `isolateModules` blocks; assert the second import retrieves the cached instance from `globalThis.__swoleDb` (this is the HMR-safety contract, not just "two imports in one Jest run").
- Happy path (production one-shot): in `NODE_ENV === 'production'`, the production branch does not stash on `globalThis`. Use `jest.isolateModules(() => { ... })` wrapping a `process.env.NODE_ENV = 'production'` then a re-import; assert `globalThis.__swoleDb` is `undefined` after import. (Reviewer-driven correction — the original "verified by reading the source" was not a real test.)

**Verification:**
- `pnpm --filter @lilnas/swole test client` passes.
- `pnpm --filter @lilnas/swole type-check` passes (the `declare global` block compiles cleanly).
- `pnpm --filter @lilnas/swole lint` passes.

---

- U4. **Test infrastructure: in-memory DB factory + migrate helper**

**Goal:** Land two helpers that every subsequent test relies on. `apps/swole/src/db/migrate.ts` exports `runMigrations(db)` — wraps Drizzle's `migrate()` so the same callable is used by both `instrumentation.ts` (U7) and the test factory. `apps/swole/src/db/test-db.ts` exports `createTestDb(): { db, close }` — each call returns a brand-new in-memory Drizzle client (with PRAGMAs set and migrations applied) alongside a `close` callable for teardown. Backfill the U2 `schema.spec.ts` placeholders with real FK / CHECK / UNIQUE enforcement assertions using these helpers.

**Requirements:** R22 (partial — the helper that boots will call this), R33 (load-bearing — test DB strategy)

**Dependencies:** U2, U3

**Files:**
- Create: `apps/swole/src/db/migrate.ts`
- Create: `apps/swole/src/db/test-db.ts`
- Modify: `apps/swole/src/db/schema.spec.ts` (replace `it.todo()` with real FK / CHECK / UNIQUE / archive tests)

**Approach:**
- `migrate.ts` resolves the migrations folder via `__dirname` so the path is process-CWD-independent:
  ```ts
  import 'server-only'
  import path from 'node:path'
  import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
  import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

  const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations')

  export function runMigrations(db: BetterSQLite3Database) {
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
    // Re-assert FK enforcement after migrate(). Drizzle's migrator opens its own
    // statement context inside the transaction; if a future destructive migration
    // toggles foreign_keys mid-flow, the connection's post-migrate state isn't
    // guaranteed. Reasserting is cheap and load-bearing for the singleton client.
    const sqlite = (db as unknown as { $client: { pragma: (s: string) => void } }).$client
    sqlite?.pragma?.('foreign_keys = ON')
  }
  ```
  `__dirname` resolves to the location of `migrate.ts` at runtime. Next.js standalone preserves the file layout under `/app/.next/server/...` predictably, and `apps/swole/Dockerfile` copies migrations to a sibling path so `path.join(__dirname, 'migrations')` lands on the right folder regardless of CWD. (Reviewer-driven robustness fix.)
- `test-db.ts` returns an object with `db` and `close` so the raw `better-sqlite3` handle does not leak into the type signature consumed by production code:
  ```ts
  import Database from 'better-sqlite3'
  import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
  import * as schema from './schema'
  import { runMigrations } from './migrate'

  export type TestDb = { db: BetterSQLite3Database<typeof schema>; close: () => void }

  export function createTestDb(): TestDb {
    const sqlite = new Database(':memory:')
    sqlite.pragma('journal_mode = WAL')        // no-op for :memory: but cheap and consistent
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    const db = drizzle(sqlite, { schema })
    runMigrations(db)
    // Re-assert FK after migrate (defense in depth — see migrate.ts comment)
    sqlite.pragma('foreign_keys = ON')
    return { db, close: () => sqlite.close() }
  }
  ```
  The wrapper-object shape removes the `& { __sqlite }` intersection type from production-code surfaces and gives test authors exactly one escape hatch (`close()`) — no raw connection access. (Reviewer-driven boundary fix.)
- Tests do `const { db, close } = createTestDb()` and `afterEach(() => close())`. The `db` they receive has the same type as production's `db`, so query/mutation specs can pass it through without type gymnastics.
- `schema.spec.ts`: replace `it.todo()` with real assertions:
  - Insert a routine + a session referencing it; attempt to delete the routine → expect `SqliteError` with `SQLITE_CONSTRAINT_FOREIGNKEY` (FK enforcement, R10).
  - Insert a `weighted` exercise with `starting_weight: null` → expect CHECK constraint violation (R14).
  - Insert a `bodyweight` exercise with `target_reps: 10, starting_weight: 50` → expect CHECK constraint violation (`starting_weight` must be null for bodyweight).
  - Insert two `set_logs` rows with the same `(session_id, exercise_id, set_number)` → second insert throws UNIQUE constraint violation (R17).
  - Insert a `set_logs` row with `set_number = 0` → throws `SQLITE_CONSTRAINT_CHECK` (new `set_number >= 1` CHECK from U2).
  - Start two sessions on the same routine with `completed_at = null` → second insert throws `SQLITE_CONSTRAINT_UNIQUE` (new partial unique index `one_active_session_per_routine` from U2). After completing the first, starting a second succeeds.
  - Insert a routine, archive it (`archived_at = new Date()`), then run `select(...).where(notArchived(routines))` → returns empty (R11 helper works).
  - **CHECK-constraint regression test:** read the latest migration `.sql` file from `apps/swole/src/db/migrations/` via `fs.readFileSync`; assert all four `type = '<value>'` branches and `set_number >= 1` are present. (Reviewer-driven addition catching future Drizzle Kit regression.)

**Patterns to follow:**
- Drizzle's `migrate` API per the [SQLite docs](https://orm.drizzle.team/docs/get-started/sqlite-new).
- Jest's `beforeEach` / `afterEach` for fresh-DB-per-test (no module-level state).

**Test scenarios:**
- Happy path: `createTestDb()` returns `{ db, close }`; the db has all five tables. Insert+select a routine round-trips.
- Happy path: `close()` closes the underlying `better-sqlite3` handle (subsequent queries through `db` throw `Database is closed`).
- Edge case: calling `createTestDb()` twice in the same process returns two independent DBs (each `:memory:` connection is its own DB).
- Error path (FK enforcement, R10, R33): delete-with-children throws `SQLITE_CONSTRAINT_FOREIGNKEY` for each FK relationship: routines→sessions, routines→exercises, exercises→set_logs, exercises→progressions, sessions→set_logs, sessions→progressions.
- Error path (CHECK enforcement, R14, R33): four type-mismatch insertion attempts (weighted missing `starting_weight`, bodyweight with `starting_weight`, time-based with `target_reps`, cardio with `sets = 2`) all throw `SQLITE_CONSTRAINT_CHECK`.
- Error path (UNIQUE enforcement, R17, R33): duplicate `(session_id, exercise_id, set_number)` insert throws `SQLITE_CONSTRAINT_UNIQUE`.
- Error path (`set_number >= 1` CHECK): inserting `set_number = 0` throws `SQLITE_CONSTRAINT_CHECK`. (New, reviewer-driven.)
- Error path (one-active-session partial unique index): seeding two `sessions` rows on the same `routine_id` both with `completed_at = null` throws `SQLITE_CONSTRAINT_UNIQUE` on the second insert. (New, reviewer-driven.)
- Happy path (partial unique index allows reuse after completion): start a session, complete it, start a second session on the same routine → succeeds.
- Happy path (R11): `notArchived` predicate filters out rows where `archived_at IS NOT NULL`.
- Regression test: CHECK constraint clauses present in the committed migration `.sql` (reviewer-driven; reads the file and regex-matches the four type branches and `set_number >= 1`).

**Verification:**
- `pnpm --filter @lilnas/swole test schema` passes — all FK / CHECK / UNIQUE / archive assertions green.
- `pnpm --filter @lilnas/swole test test-db` (or whatever the inline tests are named) passes.
- `pnpm --filter @lilnas/swole type-check` and `lint` pass.

---

- U7. **instrumentation.ts boot hook + Dockerfile migrations ship**

*(U7's stable ID is preserved per the U-ID stability rule; it now sequences earlier in the doc per a reviewer finding that placing it after queries+mutations risked shipping 6 units of code without ever booting the real container. The order in the doc is U1, U2, U3, U4, **U7**, U5, U6, U8, U9 — U-IDs preserved, sequencing fixed.)*

**Goal:** Land `apps/swole/src/instrumentation.ts` so migrations apply once per process at boot. Modify the Dockerfile so the `src/db/migrations/` folder is copied into the runtime image. After this unit, the production container can boot fresh against a real on-disk SQLite file, the migrations apply, and basic Drizzle reads work. Subsequent units (U5, U6, U8) can then build on a verified end-to-end boot rather than discovering boot issues after 6 more units land.

**Requirements:** R21, R22

**Dependencies:** U4 (for `runMigrations`)

**Files:**
- Create: `apps/swole/src/instrumentation.ts`
- Modify: `apps/swole/Dockerfile`
- Modify: `apps/swole/deploy.yml`
- Create: `apps/swole/src/instrumentation.spec.ts`

**Approach:**
- `src/instrumentation.ts`:
  ```ts
  export async function register() {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return
    // Dynamic import so Edge runtime never even tries to resolve better-sqlite3.
    const { db } = await import('./db/client')
    const { runMigrations } = await import('./db/migrate')
    const { logger } = await import('./lib/logger')

    // Log boot context so partial-migration drift is detectable from container logs.
    // The count delta (before vs after) tells us whether this boot applied anything new.
    // Reviewer-driven addition.
    const beforeCount = (db as any).$client
      .prepare('SELECT count(*) as n FROM sqlite_master WHERE type = ? AND name = ?')
      .get('table', '__drizzle_migrations')
      ? (db as any).$client.prepare('SELECT count(*) as n FROM __drizzle_migrations').get().n
      : 0
    runMigrations(db)
    const afterCount = (db as any).$client.prepare('SELECT count(*) as n FROM __drizzle_migrations').get().n
    logger.info(
      { applied: afterCount - beforeCount, total: afterCount },
      'swole migrations applied',
    )
  }
  ```
  The dynamic imports are load-bearing: Edge runtime would fail to resolve `better-sqlite3` even if the conditional skips the call, because Next.js bundles the module graph. Dynamic imports defer resolution to the Node runtime. The before/after count logging makes partial-migration drift visible from `docker-compose logs` (reviewer-driven addition for safer rollouts).
- `apps/swole/Dockerfile` — after the `RUN cp -r /source/apps/swole/.next /app/.next` line, add:
  ```dockerfile
  # Copy migrations into the runtime so instrumentation.ts can apply them on boot.
  # migrate.ts resolves the path via __dirname so it lands correctly regardless of CWD,
  # but the folder must be present at a sibling path to the compiled migrate.js.
  RUN cp -r /source/apps/swole/src/db/migrations /app/.next/standalone/apps/swole/src/db/migrations
  ```
  The destination path depends on how Next.js standalone lays out compiled code; the implementer verifies via `docker-compose exec swole find / -name "migrations" -type d 2>/dev/null` after first build and adjusts. The `__dirname`-relative resolution in `migrate.ts` (set up in U4) means as long as `migrations/` sits next to `migrate.js` at runtime, the path resolves correctly.
- `apps/swole/deploy.yml` — add an `environment:` block alongside `env_file:`:
  ```yaml
  environment:
    - DATABASE_PATH=/data/swole.db
  ```

**Execution note:** This is the unit where "does it actually boot end-to-end?" gets answered. The implementer should manually verify the dev container boots after this unit lands and the `.tables` output shows all five tables before moving to U5.

**Patterns to follow:**
- [Next.js instrumentation.ts docs](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) — guard with `NEXT_RUNTIME === 'nodejs'`; export `register`.
- Existing Dockerfile structure — add the `RUN cp -r` line in the build stage, before the runtime stage.

**Test scenarios:**
- Happy path (unit): set `process.env.NEXT_RUNTIME = 'nodejs'`, mock the dynamic imports of `./db/client`, `./db/migrate`, `./lib/logger` to return spies, call `register()`, assert all three spies called and the logger spy was called with a `{ applied, total }` payload.
- Edge case (unit): `NEXT_RUNTIME !== 'nodejs'` (set to `'edge'` or undefined) → `register()` returns without importing or calling anything; spies untouched.
- Integration (manual, no automated test): `docker-compose -f docker-compose.dev.yml up -d swole` → container boots; first request triggers `register`; `docker-compose logs swole | grep "swole migrations applied"` shows the structured log line with `applied` count > 0 on first boot.

**Verification:**
- `pnpm --filter @lilnas/swole test instrumentation` passes.
- Manual: `docker-compose -f docker-compose.dev.yml up -d swole` starts the container cleanly; logs show the structured `"swole migrations applied"` line with a non-zero `applied` count on first boot; `docker-compose -f docker-compose.dev.yml exec swole sqlite3 /data/swole.db ".tables"` (or its dev equivalent) shows `routines`, `exercises`, `sessions`, `set_logs`, `progressions`, `__drizzle_migrations`.
- Manual: `docker-compose -f docker-compose.dev.yml restart swole` — second boot's log shows `applied: 0, total: N` (no new migrations; idempotent).
- Manual: `docker-compose -f docker-compose.dev.yml down && docker-compose -f docker-compose.dev.yml up -d swole` — fresh boot reapplies cleanly against the persisted `/storage/app-data/swole/swole.db`; `applied: 0` confirms the file persisted and migrations were already there.

---

- U5. **Query functions: 5 modules, read-only access patterns the runner and stats pages need**

**Goal:** Implement the read side. Five files under `apps/swole/src/db/queries/`, each exporting named async functions that return Drizzle's inferred row types (or composed objects). No DTOs, no repository class. Adjacent spec files use the U4 `createTestDb` helper to seed and assert behavior.

**Requirements:** R24

**Dependencies:** U4

**Files:**
- Create: `apps/swole/src/db/queries/routines.ts`
- Create: `apps/swole/src/db/queries/routines.spec.ts`
- Create: `apps/swole/src/db/queries/exercises.ts`
- Create: `apps/swole/src/db/queries/exercises.spec.ts`
- Create: `apps/swole/src/db/queries/sessions.ts`
- Create: `apps/swole/src/db/queries/sessions.spec.ts`
- Create: `apps/swole/src/db/queries/setLogs.ts`
- Create: `apps/swole/src/db/queries/setLogs.spec.ts`
- Create: `apps/swole/src/db/queries/progressions.ts`
- Create: `apps/swole/src/db/queries/progressions.spec.ts`

**Approach:**
- Every query file starts with `import 'server-only'` (reviewer-driven defense-in-depth — prevents a future client component from accidentally bundling a query helper).
- Each query file imports `db` from `../client` and the relevant table from `../schema`. Functions take primitive args (e.g., `routineId: number`) and return either an inferred row or `null`/`undefined`/`[]`.
- `queries/routines.ts`:
  - `listRoutines(opts?: { includeArchived?: boolean })` — defaults to non-archived; orders by `name` ascending.
  - `getRoutine(id: number)` — single row or `null`.
  - `getRoutineWithExercises(id: number, opts?: { includeArchived?: boolean })` — composite object `{ routine, exercises }`; `exercises` ordered by `order_in_routine` ascending. **By default excludes archived exercises**, but hydration (U8) passes `{ includeArchived: true }` so a session that references an exercise archived mid-session can still reconstruct (reviewer-driven correctness fix). UI pages that want to render the active routine pass the default (or explicitly `false`).
- `queries/exercises.ts`:
  - `listExercisesForRoutine(routineId: number, opts?: { includeArchived?: boolean })`.
  - `getExercise(id: number)`.
- `queries/sessions.ts`:
  - `getSession(id: number)`.
  - `listSessionsForRoutine(routineId: number, opts?: { completedOnly?: boolean })` — `completedOnly` true → `WHERE completed_at IS NOT NULL`.
  - `getActiveSession(id: number)` — returns `null` if `completed_at IS NOT NULL`.
  - `hasActiveSessionForRoutine(routineId: number): boolean` — returns true if any session has `routine_id = routineId AND completed_at IS NULL`. Consumed by archive/reorder mutation guards in U6/U10 (reviewer-driven addition).
- `queries/setLogs.ts`:
  - `getSetLogsForSession(sessionId: number)` — ordered by `logged_at` ascending; returns all rows for the session.
- `queries/progressions.ts`:
  - `getProgressionsForExercise(exerciseId: number)` — ordered by `effective_from` ascending; chart source.
  - `getProgressionsForSession(sessionId: number)` — used by hydration in U8 to detect committed Case A/B decisions per R30(d).
  - `hasCommittedSessionProgression(sessionId: number): boolean` — returns true if any `progressions WHERE session_id = sessionId AND reason = 'session_progression'`. Consumed by `undoLastSetLog` guard in U10 (reviewer-driven addition; lifts the guard's read into a named, testable helper).
- Test files mock `next/cache` (defensive — queries don't call it, but mutations they share specs with might; consistent mocking helps).

**Patterns to follow:**
- Drizzle query builder: `db.select().from(table).where(eq(...)).orderBy(asc(...))`.
- `apps/yoink/src/db/index.ts` for the `db` import style (already extends in U3).
- Plain async functions, no class wrappers.

**Test scenarios:**

For each query function, the test scenarios follow this pattern. Below lists representative scenarios — the implementer enumerates per-function coverage:

- Happy path (`listRoutines`): seed 3 routines, one archived; `listRoutines()` returns 2; `listRoutines({ includeArchived: true })` returns 3, ordered by name.
- Edge case (`listRoutines`): empty DB → returns `[]`, not throws.
- Happy path (`getRoutine`): seed one, fetch by id → returns row.
- Edge case (`getRoutine`): nonexistent id → returns `null` (not throws).
- Happy path (`getRoutineWithExercises`): seed one routine with 3 exercises (one archived); returns `{ routine, exercises }` with 2 exercises ordered by `order_in_routine`.
- Edge case (`getRoutineWithExercises`): nonexistent routine id → returns `null`.
- Happy path (`getActiveSession`): seed a session with `completed_at = null` → returns the row; seed a session with `completed_at = new Date()` → returns `null`.
- Happy path (`getSetLogsForSession`): seed 5 set_logs with varying `logged_at` → returns 5 rows ordered ascending.
- Edge case (`getSetLogsForSession`): no logs for session → returns `[]`.
- Happy path (`getProgressionsForExercise`): seed initial + session_progression + manual_edit rows → returns 3, ordered by `effective_from`.

**Verification:**
- `pnpm --filter @lilnas/swole test queries` passes.
- `pnpm --filter @lilnas/swole type-check` passes (inferred row types compile in consumers).
- `pnpm --filter @lilnas/swole lint` passes.

---

- U6. **Mutation functions: single-table mutations (no transactions needed)**

*(Original U6 — "all mutations" — was split during deepening into U6 (single-table) and U10 (transactional). U6 keeps its ID on the simpler half that ships first. Per the U-ID stability rule, the transactional half is U10, not "U6b".)*

**Goal:** Implement the single-table mutations: `createRoutine`, `updateRoutine`, `startSession`, `appendSetLog`, `completeSession`. None of these touch more than one table per call; none of them need `db.transaction(...)`. Each calls `revalidatePath` per ADR-001 and R27. `appendSetLog` always throws `DuplicateSetLog` on UNIQUE-constraint violation (reviewer-driven correctness fix from Key Decisions).

**Requirements:** R25 (partial — single-table mutations only), R26 (partial), R27

**Dependencies:** U7

**Files:**
- Create: `apps/swole/src/db/mutations/routines.ts` (only `createRoutine`, `updateRoutine` — archive is in U10 because of the active-session guard)
- Create: `apps/swole/src/db/mutations/routines.spec.ts`
- Create: `apps/swole/src/db/mutations/sessions.ts` (`startSession`, `completeSession`)
- Create: `apps/swole/src/db/mutations/sessions.spec.ts`
- Create: `apps/swole/src/db/mutations/setLogs.ts` (`appendSetLog` only — `undoLastSetLog` is in U10)
- Create: `apps/swole/src/db/mutations/setLogs.spec.ts`

**Approach:**
- Every mutation file starts with `import 'server-only'` (reviewer-driven defense-in-depth).
- Every mutation file mocks `next/cache` at the top: `jest.mock('next/cache', () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn() }))`.
- Every mutation function:
  1. Validates input shape lightly (non-empty `name` etc.); deep shape validation is the UI layer's job.
  2. Does the work — single insert/update/delete.
  3. Calls `revalidatePath` for the affected route(s).
  4. Returns the new/updated row (or `void` for destructive ops).
- `mutations/routines.ts`:
  - `createRoutine({ name, days })` → returns the inserted row. Revalidates `/`.
  - `updateRoutine(id, patch: Partial<{ name, days }>)` → updates `updated_at`. Revalidates `/routines/${id}`.
- `mutations/sessions.ts`:
  - `startSession(routineId)` → inserts one row with `started_at = new Date(), completed_at = null, routine_id = routineId`. Returns the new id. Revalidates `/` and `/session/${newId}`. Note: the partial unique index `one_active_session_per_routine` (from U2 schema) DB-enforces "at most one active session per routine" — a second `startSession` while one is active throws `SQLITE_CONSTRAINT_UNIQUE`; the mutation translates this into a tagged `RoutineAlreadyHasActiveSession` error. (Reviewer-driven correctness fix — replaces the original "TOCTOU read-then-modify guard" with a DB invariant.)
  - `completeSession(sessionId)` → updates `completed_at = new Date()`. Idempotent on already-completed sessions (no-op if already set). Revalidates `/session/${sessionId}` and `/`.
- `mutations/setLogs.ts`:
  - `appendSetLog({ sessionId, exerciseId, setNumber, weight?, targetReps?, actualReps?, durationSeconds?, actualDurationSeconds?, action })` → single insert; sets `logged_at = new Date()` implicitly. On `SQLITE_CONSTRAINT_UNIQUE` (duplicate `(session_id, exercise_id, set_number)`), **always throws `DuplicateSetLog`** carrying the existing row in its payload (`new DuplicateSetLog(existingRow)`). The caller — Survivor 4's server action wrapper — compares the existing row field-by-field against the FSM's computed `SetLog` and forces a client re-hydration on divergence. (Reviewer-driven correctness fix from Key Decisions — never silent no-op.) Revalidates `/session/${sessionId}` on success.

**Patterns to follow:**
- Drizzle `db.insert(table).values({...}).returning()` for inserts that need the new id back.
- `next/cache`'s `revalidatePath(path: string, type?: 'page' | 'layout')` — default page revalidation is fine for swole.

**Test scenarios:**

`createRoutine`:
- Happy path: returns the inserted row with `id`, `created_at`, `updated_at` populated.
- Happy path: appears in `listRoutines()` after.
- Happy path: `revalidatePath('/')` called once.
- Edge case: empty `name` — reject (throw `ValidationError`); pin in test.

`updateRoutine`:
- Happy path: name patch persists; `updated_at` advances.
- Edge case: empty patch object — no-op (returns existing row).
- Error path: nonexistent id — throws `NotFound`; pin in test.

`startSession`:
- Happy path: new session row with `completed_at = null, started_at ≈ now, routine_id = input`. Returned id is the new row's id.
- Edge case: nonexistent routine id → FK violation (RESTRICT means insert with bad FK throws).
- Error path (reviewer-driven): a second `startSession` on the same routine while one is active → throws `RoutineAlreadyHasActiveSession`. After completing the first, a second succeeds.

`completeSession`:
- Happy path: row's `completed_at` set to ~now.
- Happy path (idempotent): calling twice does not re-update `completed_at`; second call returns the same row unchanged.
- Edge case: nonexistent session id → throws `NotFound`.

`appendSetLog`:
- Happy path: single insert; row visible via `getSetLogsForSession`.
- Happy path: `logged_at` populated to ~now (close enough — within test tolerance).
- Error path (reviewer-driven correctness): two calls with same `(sessionId, exerciseId, setNumber)` — second call throws `DuplicateSetLog` with the existing row in the error payload (NOT silent no-op).
- Error path: nonexistent `sessionId` or `exerciseId` → FK violation throws.
- Error path: `setNumber = 0` → CHECK constraint throws `SQLITE_CONSTRAINT_CHECK` (catches caller bugs at the persistence boundary).

**Verification:**
- `pnpm --filter @lilnas/swole test mutations/routines mutations/sessions mutations/setLogs` passes.
- `pnpm --filter @lilnas/swole type-check` and `lint` pass.
- Every spec asserts `revalidatePath` was called with the expected path(s).

---

- U10. **Transactional mutations: createExercise, updateExercise, archiveExercise, archiveRoutine, reorderExercises, undoLastSetLog, commitProgressionDecision**

*(New unit assigned U10 because U6 was split during deepening. U10 holds the load-bearing transactional invariants: the canonical-SW + audit-log pairing (R19, R20), the undo-vs-committed-progression guard (R32), and the archive/reorder active-session guards. These are the "dangerous half" of mutations — splitting them out gives the implementer a focused surface for atomicity tests.)*

**Goal:** Implement the seven multi-step mutations that must be atomic. Every one of these wraps its work in `db.transaction({ behavior: 'immediate' }, tx => ...)` to serialize read-then-modify operations across tabs. Every `tx`-handle call uses `tx`, never the outer `db`. Atomicity tests force mid-transaction failures and assert nothing partial persists.

**Requirements:** R19, R20, R25 (transactional mutations), R26 (transactional mutations), R27, R31 (streaming `commitProgressionDecision` per post-session prompt), R32

**Dependencies:** U6

**Files:**
- Create: `apps/swole/src/db/mutations/exercises.ts` (`createExercise`, `updateExercise`, `archiveExercise`, `reorderExercises`)
- Create: `apps/swole/src/db/mutations/exercises.spec.ts`
- Create: `apps/swole/src/db/mutations/progressions.ts` (`commitProgressionDecision`)
- Create: `apps/swole/src/db/mutations/progressions.spec.ts`
- Modify: `apps/swole/src/db/mutations/routines.ts` (add `archiveRoutine`)
- Modify: `apps/swole/src/db/mutations/routines.spec.ts` (add archive tests)
- Modify: `apps/swole/src/db/mutations/setLogs.ts` (add `undoLastSetLog`)
- Modify: `apps/swole/src/db/mutations/setLogs.spec.ts` (add undo tests)

**Approach:**

Each mutation in this unit follows the same skeleton:
```ts
db.transaction(
  tx => {
    // ALL DB calls inside use `tx`, never `db`. The lint/review checklist enforces this.
    const existing = tx.select(...).from(...).where(...).get()
    if (/* guard fails */) throw new TaggedError(...)
    tx.insert(...).values(...).run()
    tx.update(...).set(...).where(...).run()
  },
  { behavior: 'immediate' },  // Acquire write lock at transaction start — see Key Decisions
)
```

- `archiveRoutine(id)` (moved from U6): inside `immediate` tx, check `hasActiveSessionForRoutine(routineId)`. If true, throw `ArchiveBlockedByActiveSession`. Else set `archived_at = new Date()`. Revalidates `/`.
- `createExercise(routineId, input)`: inside `immediate` tx — insert exercise; if `type === 'weighted'`, also insert `progressions` row with `reason: 'initial', starting_weight: input.startingWeight, effective_from: new Date(), session_id: null` (R20). Both writes use `tx`, not `db`. Revalidates `/routines/${routineId}`.
- `updateExercise(id, patch)`: inside `immediate` tx — read existing row with `tx.select(...).get()` (inside the transaction, not outside — reviewer-driven correctness fix); update fields; if `patch.startingWeight` differs from existing AND exercise is `weighted`, also insert `progressions` row with `reason: 'manual_edit'` (R26). Revalidates `/routines/${routineId}` and `/stats/${id}`.
- `archiveExercise(id)`: inside `immediate` tx, check `hasActiveSessionForRoutine(exercise.routineId)`. If true, throw `ArchiveBlockedByActiveSession`. Else set `archived_at = new Date()`. Revalidates `/routines/${routineId}`. (Reviewer-driven correctness fix — prevents hydration from losing data when an active session references this exercise.)
- `reorderExercises(routineId, orderedIds: number[])`: inside `immediate` tx, check `hasActiveSessionForRoutine(routineId)`. If true, throw `ReorderBlockedByActiveSession`. Else bulk-update each exercise's `order_in_routine` per its index in the array (using `tx.update(exercises).set({ orderInRoutine: i }).where(eq(exercises.id, orderedIds[i]))` for each `i`). Revalidates `/routines/${routineId}`.
- `undoLastSetLog(sessionId)`: inside `immediate` tx, call `hasCommittedSessionProgression(sessionId)`. If true, throw `UndoBlockedByCommittedProgression` (R32). Else delete the most recent set_log: `DELETE FROM set_logs WHERE id = (SELECT id FROM set_logs WHERE session_id = ? ORDER BY logged_at DESC, id DESC LIMIT 1)` — note the `id DESC` tiebreak handles the case where two logs share the same `logged_at` ms (reviewer-driven correctness fix). Revalidates `/session/${sessionId}`.
- `commitProgressionDecision({ sessionId, exerciseId, chosenStartingWeight })`: inside `immediate` tx — insert `progressions` row with `reason: 'session_progression', session_id: sessionId, exercise_id: exerciseId, starting_weight: chosenStartingWeight, effective_from: new Date()`; update `exercises.starting_weight = chosenStartingWeight` for the same exercise (R19 canonical-write contract). Both writes use `tx`. Revalidates `/stats/${exerciseId}` and `/session/${sessionId}`.

**Execution note:** This is the unit where the load-bearing invariants live. Every atomicity test must:
1. Force a failure mid-transaction (CHECK constraint violation on the second statement is the easiest reproducer).
2. Assert that BOTH a row-was-written check AND a row-was-NOT-written check pass — i.e., the first statement's effect did NOT persist.
3. Critically: include at least ONE atomicity test that catches the "tx vs db handle" footgun. Implementer writes the same test once using `tx` correctly (passes — first row rolls back) and once using `db` for the first statement (fails — first row persists despite rollback). The wrong version is then deleted; the failing version pins the contract by being kept commented out as the canonical anti-pattern reference. (Reviewer-driven addition.)

**Patterns to follow:**
- Drizzle `db.transaction(callback, { behavior: 'immediate' })` — verify support in 0.45; fall back to `sqlite.prepare('BEGIN IMMEDIATE').run()` at top of callback if needed.
- `tx.insert(...)`, `tx.update(...)`, `tx.select(...)` — never `db.*` inside the callback.

**Test scenarios:**

`archiveRoutine`:
- Happy path: routine with no sessions → `archived_at` set; appears in `listRoutines({ includeArchived: true })` but not default.
- Happy path: routine with only completed sessions → archive succeeds.
- Error path (reviewer-driven): routine with at least one active session (`completed_at IS NULL`) → throws `ArchiveBlockedByActiveSession`; `archived_at` remains null.
- Integration: a routine with sessions cannot be hard-deleted but CAN be archived (R10 RESTRICT applies only to DELETE, not UPDATE).

`createExercise`:
- Happy path (weighted): exercise row inserted; `progressions` table contains exactly one `initial` row with `starting_weight` matching input and `session_id IS NULL` (R20).
- Happy path (bodyweight): exercise row inserted; zero `progressions` rows for this exercise (R20).
- Happy path (time-based): no progression row.
- Happy path (cardio): no progression row.
- Integration / atomicity (tx-handle test, reviewer-driven): force a CHECK violation on the progression insert (e.g., pass a `starting_weight` that survives input validation but fails some constraint); assert NEITHER the exercise row NOR the progression row persists.
- Anti-pattern verification (reviewer-driven): if the implementer writes the exercise insert via the outer `db` (not `tx`) inside the callback, the exercise persists despite the progression failure. Deletes this anti-pattern after demonstrating; pins the discipline by review.

`updateExercise`:
- Happy path: patch with no `starting_weight` change → exercise updated, no new progression row.
- Happy path (weighted): patch with `starting_weight: 110` on an exercise currently at 100 → exercise's `starting_weight` updated to 110, new `progressions` row with `reason: 'manual_edit'` inserted, both in same transaction.
- Happy path (non-weighted): no progression row even if `starting_weight` is in patch (it's null on non-weighted, so the comparison is no-op).
- Error path: invalid patch field (e.g., changing `type` from weighted to bodyweight while non-null type-specific fields remain) → CHECK constraint throws; both updates roll back.
- Race-test (reviewer-driven, R3 KTD): two concurrent `updateExercise` calls — assert the final state is one consistent outcome (either both succeed serially or the second sees the first's writes). With `BEGIN IMMEDIATE`, the second waits.

`archiveExercise`:
- Happy path: exercise on routine with no active session → `archived_at` set.
- Error path (reviewer-driven): exercise on routine with active session → throws `ArchiveBlockedByActiveSession`; `archived_at` remains null.

`reorderExercises`:
- Happy path: routine with 3 exercises in order `[1, 2, 3]`; call with `[3, 1, 2]` → all three rows' `order_in_routine` updated to reflect new positions.
- Error path: routine has an active session (`completed_at IS NULL`) → throws `ReorderBlockedByActiveSession`; no `order_in_routine` updates persist.
- Integration: routine has a *completed* session → reorder succeeds.

`undoLastSetLog`:
- Happy path: insert 3 logs, undo, → 2 logs remain; the one removed is the most recent by `logged_at DESC, id DESC`.
- Happy path (tiebreak, reviewer-driven): insert 2 logs with the SAME `logged_at` ms (mock clock or force same Date); undo → the higher-id log is deleted.
- Edge case: no logs for session → no-op (returns silently, no error).
- Error path (R32): session has a `session_progression` row → throws `UndoBlockedByCommittedProgression`; set_log count unchanged.
- Race-test (reviewer-driven, KTD): start an `undoLastSetLog` transaction; before it commits, attempt to commit a `commitProgressionDecision` from another tab — the second waits on the IMMEDIATE lock; final state is consistent (either undo succeeds and progression is then rejected by the guard re-read, or progression commits first and undo throws).

`commitProgressionDecision`:
- Happy path (Case A roll up): start with exercise `starting_weight = 100, increment = 5`; call with `chosenStartingWeight = 105` → exercise's `starting_weight` is 105, new `progressions` row with `reason: 'session_progression', starting_weight: 105` exists.
- Happy path (Case A stay): call with `chosenStartingWeight = 100` (same as current) → exercise's `starting_weight` stays 100, new `progressions` row with `reason: 'session_progression', starting_weight: 100` exists (R26 says "every Case A 'Stay/Roll up' tap" creates a recorded decision).
- Happy path (Case B): call with `chosenStartingWeight = 95` on an exercise where lowest used was 95 → exercise's `starting_weight = 95`, new `progressions` row.
- Integration / atomicity (tx-handle test): simulate a failure (FK violation by passing a bad `exerciseId`) → neither the progression row nor the exercise update persists.
- Invariant test (reviewer-driven, KTD): after every `commitProgressionDecision`, the canonical-write invariant `progressions[latest where exercise_id = X].starting_weight === exercises[X].starting_weight` holds. Test asserts this explicitly at the end of each happy-path scenario.

**Verification:**
- `pnpm --filter @lilnas/swole test mutations/exercises mutations/progressions mutations/routines mutations/setLogs` passes.
- Every atomicity test asserts both halves (positive-NOT-persisted AND negative-NOT-persisted) of the transaction rollback.
- `pnpm --filter @lilnas/swole type-check` and `lint` pass.

---

- U8. **Hydration helper: DB → FSM SessionState reconstruction + round-trip tests**

**Goal:** Land `apps/swole/src/db/mappers.ts` (symmetric FSM↔DB translation: `toSetLog` and `toSetLogArgs`, plus a compile-time enum-drift assertion) and `apps/swole/src/db/hydration.ts` (`buildSessionState(sessionId)` composing the four queries from R30: session, set_logs, routine + exercises, progressions). Adjacent spec tests pin the FSM ↔ DB round trip: build a `SessionState` from `SetLog`s, persist via `appendSetLog` (using `toSetLogArgs` to translate), reload via `buildSessionState`, assert structural equality with the source.

**Requirements:** R28 (FSM same module both sides), R29 (translation lives outside FSM), R30 (hydration), R34 (round-trip tests)

**Dependencies:** U6, U10 (mutations needed for round-trip tests)

**Files:**
- Create: `apps/swole/src/db/mappers.ts` (`toSetLog` (DB→FSM), `toSetLogArgs` (FSM→DB args)) — the symmetric translation seam (reviewer-driven extraction)
- Create: `apps/swole/src/db/mappers.spec.ts`
- Create: `apps/swole/src/db/hydration.ts`
- Create: `apps/swole/src/db/hydration.spec.ts`

**Approach:**
- `mappers.ts` — symmetric translation, both directions. Imports FSM types (one-way: schema does NOT import FSM):
  ```ts
  import type { Action, Routine, SetLog } from 'src/core/session-machine'
  import type * as schema from './schema'

  type SetLogRow = typeof schema.setLogs.$inferSelect
  type SetLogInsertArgs = { sessionId: number; exerciseId: number; setNumber: number; weight?: number; targetReps?: number; actualReps?: number; durationSeconds?: number; actualDurationSeconds?: number; action: Exclude<Action['type'], 'JumpTo'>; actionPayload?: { actualReps?: number } }

  // DB row → FSM domain object.
  export function toSetLog(row: SetLogRow, routine: Routine & { exercises: { id: number }[] }): SetLog { ... }

  // FSM SetLog → primitive args ready for `appendSetLog`.
  export function toSetLogArgs(setLog: SetLog, routine: { exercises: { id: number }[] }): SetLogInsertArgs { ... }

  // Compile-time guard against schema-enum drift (reviewer-driven addition):
  // If FSM adds a new Action variant without a schema update, this fails at type-check.
  type _SchemaActionEnum = typeof schema.setLogs.action.enumValues[number]
  type _PersistableActions = Exclude<Action['type'], 'JumpTo'>
  type _AssertSubset = _PersistableActions extends _SchemaActionEnum ? true : never
  const _assertActionSubset: _AssertSubset = true  // compile error if FSM grows
  ```
  Both `toSetLog` and `toSetLogArgs` are pure functions. The schema-enum drift assertion is a one-line type-level guard the implementer keeps next to the mappers; it fails CI if anyone adds a new FSM action without updating the schema enum.
- `hydration.ts` composes mappers + queries:
  ```ts
  import 'server-only'
  import type { SessionState } from 'src/core/session-machine'
  import { getActiveSession } from './queries/sessions'
  import { getRoutineWithExercises } from './queries/routines'
  import { getSetLogsForSession } from './queries/setLogs'
  import { getProgressionsForSession } from './queries/progressions'
  import { toSetLog } from './mappers'

  export async function buildSessionState(sessionId: number): Promise<{
    sessionState: SessionState
    routine: ...with ids...
    progressions: ...
  } | null> {
    const session = await getActiveSession(sessionId)
    if (!session) return null
    // Reviewer-driven correctness fix: includeArchived: true so a session that
    // references an exercise archived mid-session can still hydrate.
    const result = await getRoutineWithExercises(session.routineId, { includeArchived: true })
    if (!result) return null  // routine was deleted (shouldn't happen with RESTRICT)
    const setLogRows = await getSetLogsForSession(sessionId)
    const progressionRows = await getProgressionsForSession(sessionId)
    const setLogs = setLogRows.map(row => toSetLog(row, result.routine))
    return {
      sessionState: { setLogs },  // no cursorOverride from DB — JumpTo is UI-transient
      routine: result.routine,
      progressions: progressionRows,
    }
  }
  ```
- The `Routine` shape the FSM wants is `{ exercises: Exercise[] }` (no ids). For hydration we need ids to do the `exerciseIdx` lookup. Cleanest: `getRoutineWithExercises` returns a wrapper carrying both FSM-shaped exercises and a parallel `{ id }[]` (or just the augmented `Exercise & { id }` shape — implementer's call). The `Exercise` ↔ row mapping is also a mappers.ts function (`toExercise`, `toRoutine`).
- The `parseAction(actionText, actualReps)` helper reconstructs the `Action` discriminated union from the persisted `action` text column. For `'Failed'`, it sets `actualReps` from the row; for the other seven, no payload. `'JumpTo'` is never persisted (compile-time-guaranteed by the schema enum + the assert above).

**Execution note:** This is the trickiest unit. The "FSM is the contract" claim from the institutional learning is enforced here — if hydration drifts, the SessionState used by the runner UI diverges from the persisted history, and "lost work" UX materializes. The round-trip test is the load-bearing assertion.

**Patterns to follow:**
- The Survivor 2 FSM types — import as types only, no value imports.
- Drizzle's `$inferSelect` for the row types.

**Test scenarios:**

For `mappers.ts` (`mappers.spec.ts`):
- Happy path (`toSetLog`, all four exercise types): build a row, call `toSetLog(row, routine)`, assert the resulting `SetLog` has correct `exerciseIdx`, `setIdx`, type-appropriate weight/reps/duration fields.
- Happy path (`toSetLogArgs`, all four exercise types): build a `SetLog`, call `toSetLogArgs(setLog, routine)`, assert the resulting args object has correct `sessionId`-free shape (caller adds sessionId).
- Symmetric round-trip: `toSetLog(toSetLogArgs(setLog, routine) + {sessionId, id, loggedAt}, routine)` ≈ `setLog` for all exercise types.
- Error path: `toSetLog` on a row whose `exerciseId` is not in the routine's exercise list throws a tagged error.
- Compile-time: the `_AssertSubset` type assertion compiles (no schema/FSM drift). This is implicit in `pnpm type-check` — no runtime test needed.

For `hydration.ts` (`hydration.spec.ts`):
- Happy path (round-trip, R34): for each exercise type (weighted, bodyweight, time-based, cardio), build a `SessionState` via `applyAction` chains, persist using `toSetLogArgs` + `appendSetLog`, hydrate via `buildSessionState`, assert structural equality with the source `SessionState`.
- Happy path: empty session hydrates to `setLogs: []`.
- Edge case: completed session returns `null`.
- Edge case: nonexistent session id returns `null`.
- Edge case: `cursorOverride` is never set by hydration (`JumpTo` is UI-only transient).
- Integration (Failed action): weighted Failed → `actualReps` round-trips; time-based Failed → `actualDuration` round-trips.
- Integration (multi-exercise ordering): set_logs across 3 exercises hydrate with correct `exerciseIdx` translation.
- **Archived-parent scenarios (reviewer-driven correctness coverage):**
  - Archive an exercise on a routine that has an active session referencing it (this can only happen via direct DB mutation since `archiveExercise` rejects, but the hydration should still survive corrupt state — see error path below).
  - Active session on a routine, archive the routine in another tab → `archiveRoutine` mutation rejects (covered in U10 tests). But if it somehow happened: hydration's `getRoutineWithExercises(routineId, { includeArchived: true })` still returns the routine; session hydrates correctly.
  - Set_logs reference an exercise that was archived BEFORE the session started but somehow re-used — `includeArchived: true` flag means the exercise still appears in the routine, so `toSetLog` resolves the exerciseIdx.
- Error path (defensive, corrupt data): set_log row whose `exercise_id` is not in the routine's exercise list at all → `toSetLog` throws a clear error. The FK + RESTRICT + archive-guards make this very unlikely, but pinning the error message is cheap.

**Verification:**
- `pnpm --filter @lilnas/swole test hydration` passes.
- The round-trip test for each exercise type passes (R34's load-bearing assertion).
- `pnpm --filter @lilnas/swole type-check` and `lint` pass.

---

- U9. **End-to-end PRD F2/F3 walkthrough at the query layer**

**Goal:** Land `apps/swole/src/db/__integration__/prd-walkthrough.spec.ts` — the cross-cutting integration test from R35. Walks through the PRD F2 scenario at the query/mutation layer (no UI): create routine, start session, append 9 set logs, commit Case A "Roll up" for Bench Press, complete session, assert end state matches the PRD.

**Requirements:** R31 (streaming `commitProgressionDecision` per prompt + `completeSession` tick at the end — walked through end-to-end), R35

**Dependencies:** U8

**Files:**
- Create: `apps/swole/src/db/__integration__/prd-walkthrough.spec.ts`

**Approach:**
- Single test file; one top-level `describe('PRD F2/F3 walkthrough', ...)` block.
- Test setup: `createTestDb()` per test (one test in this file, but pattern is consistent with adjacent specs).
- Test flow (matching PRD F2 verification step 3 verbatim where possible):
  1. `createRoutine({ name: 'Push Day', days: ['mon','wed','fri'] })` → routine.
  2. `createExercise(routine.id, { name: 'Bench Press', type: 'weighted', sets: 3, targetReps: 10, startingWeight: 100, increment: 5, orderInRoutine: 0 })` → benchPress; assert `initial` `progressions` row exists with `starting_weight: 100`.
  3. `createExercise(routine.id, { name: 'Pushups', type: 'bodyweight', sets: 3, targetReps: 15, orderInRoutine: 1 })` → pushups; assert no `progressions` row.
  4. `createExercise(routine.id, { name: 'Plank', type: 'time-based', sets: 3, durationSeconds: 30, orderInRoutine: 2 })` → plank; assert no `progressions` row.
  5. `startSession(routine.id)` → sessionId.
  6. Run the F2 action sequence through the FSM (`applyAction` chained), collecting the resulting 9 `SetLog`s.
  7. Persist each via `appendSetLog`, translating `exerciseIdx` → `exercise_id` via the routine.
  8. Hydrate via `buildSessionState(sessionId)` and assert the resulting `setLogs` array deep-equals the FSM's output (cross-check).
  9. Compute post-session prompts via `classifyPostSession(sessionState, routine)` — should return one Case A prompt for Bench Press.
  10. `commitProgressionDecision({ sessionId, exerciseId: benchPress.id, chosenStartingWeight: 105 })` — the "Roll up" tap.
  11. Assert: `exercises.starting_weight` for Bench Press is now 105; two `progressions` rows for Bench Press exist (`initial: 100`, `session_progression: 105`); `exercises.starting_weight` for Pushups/Plank unchanged.
  12. `completeSession(sessionId)`.
  13. Assert: session row's `completed_at IS NOT NULL`; session is excluded from `getActiveSession` but appears in `listSessionsForRoutine({ completedOnly: true })`.
  14. **Canonical-write invariant assertion (reviewer-driven addition):** for every weighted exercise in the routine, query the latest `progressions` row by `effective_from DESC` and assert its `starting_weight` value equals `exercises.starting_weight`. This pins R19's invariant cross-layer: the data layer never lets the canonical value diverge from the audit log's latest entry. If a future refactor of the mutation layer accidentally writes only one half of the pair, this assertion fails loudly.

**Patterns to follow:**
- Survivor 2's PRD F2 fixture test (`apps/swole/src/core/session-machine.spec.ts`) — same scenario, different layer. The FSM-layer F2 test pins the `SetLog[]` shape; this DB-layer F2 test pins the persistence round-trip.

**Test scenarios:**
- Happy path (the F2 walkthrough described above). Single test. Cover AE: this is the PRD F2 + F3 Case A acceptance example.
- (Optional extension — implementer's call) Happy path for F3 Case B: drop a weight below original SW; `classifyPostSession` returns Case B; `commitProgressionDecision` updates `starting_weight` to `lowest`; assertion analogous to F2.

**Verification:**
- `pnpm --filter @lilnas/swole test prd-walkthrough` passes. This single test failing is a load-bearing signal — it means the FSM ↔ DB contract drifted somewhere upstream.
- `pnpm --filter @lilnas/swole test` (all suites) passes.

---

## System-Wide Impact

- **Interaction graph:** This PR adds a new module graph under `apps/swole/src/db/`. The FSM module (`src/core/session-machine.ts`) is read-only consumed by `src/db/mappers.ts` (types + compile-time enum-drift assertion; no value imports). `src/instrumentation.ts` is a new Next.js entry-point file under `src/`. The Dockerfile gains a `RUN cp -r` line for migrations. The deploy.yml gets one new environment variable. No existing files are restructured.
- **Error propagation:** Schema constraint violations (FK, CHECK, UNIQUE) surface as `SqliteError` with specific `code` properties. Mutations translate these into named app errors:
  - `DuplicateSetLog` — from UNIQUE on `set_logs(session_id, exercise_id, set_number)`. Carries the existing row.
  - `RoutineAlreadyHasActiveSession` — from the partial unique index `one_active_session_per_routine`. Replaces the original "read-then-modify guard in `startSession`" with a DB invariant. (Reviewer-driven.)
  - `ReorderBlockedByActiveSession`, `ArchiveBlockedByActiveSession` — app-level guards inside `BEGIN IMMEDIATE` transactions (U10). Prevent hydration corruption.
  - `UndoBlockedByCommittedProgression` — app-level guard for R32.
  Migration failures at boot propagate up through `register()` and crash the Next.js server (intentional — partial-migration state is a worse failure mode than a crash). The boot log records before/after migration count for drift detection. `revalidatePath` failures inside a mutation log but do not throw (cache invalidation is best-effort).
- **State lifecycle risks:** (a) Per-action streaming writes mean a session can be abandoned mid-flow — addressed in scope: no janitor, history queries filter on `completed_at IS NOT NULL`. (b) The `exercises.starting_weight` canonical write + `progressions` audit log must always update together — addressed by the `BEGIN IMMEDIATE` transactions in `commitProgressionDecision` and the `updateExercise` `starting_weight`-changed branch (U10), tested explicitly via the canonical-write invariant assertion in U9. (c) `undoLastSetLog` between `commitProgressionDecision` calls would corrupt the FSM↔DB invariant — addressed by R32's guard plus the `BEGIN IMMEDIATE` lock. (d) Reorder/archive during active session would invalidate `exerciseIdx` translation — addressed by `ReorderBlockedByActiveSession` / `ArchiveBlockedByActiveSession` guards in U10. (e) Schema enum drift (FSM gains an action; schema doesn't) would silently fail at runtime — converted to a compile-time error by the `_AssertSubset` type assertion in `mappers.ts` (U8). (Reviewer-driven on c/d/e.)
- **API surface parity:** No external APIs added. Internal "surface" is the import surface of `src/db/queries/*`, `src/db/mutations/*`, `src/db/mappers.ts`, and `src/db/hydration.ts`, consumed by Survivor 4 from `src/app/**`. Per Scope Boundaries, Survivor 4 uses `mappers.ts` for any FSM-shaped reads — query functions return Drizzle row types directly and Survivor 4 converts via the named helpers. Stable per ADR-001's "data layer functions are the single mutation entry point" rule.
- **Integration coverage:** Four integration scenarios mocks alone won't prove: (a) FK + CHECK + UNIQUE enforcement under the singleton PRAGMA (covered in U4 schema spec). (b) Multi-tab serialization via `BEGIN IMMEDIATE` and the partial unique index (covered in U6/U10 race tests). (c) FSM ↔ DB round-trip including archived-parent scenarios (covered in U8 mappers + hydration specs). (d) The full F2 walkthrough including the canonical-write invariant (covered in U9 integration spec). All four use real `:memory:` SQLite with migrations applied — no mocking of the Drizzle layer.
- **Unchanged invariants:**
  - `apps/swole/src/core/session-machine.ts` is **not modified** by this PR. The FSM module stays pure; the data layer imports its types only, never the other way.
  - `apps/swole/src/core/session-machine.spec.ts` continues to pass unchanged.
  - `apps/swole/src/lib/logger.ts`, `src/env.ts` (other than the one `DATABASE_PATH` addition), `src/app/api/health/route.ts`, `src/app/metrics/route.ts`, `src/app/page.tsx`, `src/components/*` are all unchanged.
  - The existing `EnvKeys` keys (`LOG_FILE_PATH`, `NODE_ENV`) are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `better-sqlite3` v12 prebuilt binary missing for Node 25 on the `lilnas-nextjs-runtime` base image → install fails with `node-gyp` error during Docker build. | Pinning to v12.10.0 (latest stable). If install still fails, the fallback is to add `python3`, `make`, `g++` to `lilnas-monorepo-builder` so node-gyp can build from source. Build the dev image first as a smoke test before opening the PR. |
| `instrumentation.ts` doesn't fire in Next.js 16 standalone mode for an obscure reason (e.g., the `register()` hook regressed in 16.x). | Confirmed working in 15+ per docs and #49897 resolution; 16.x is a minor bump. If it fails, fall back to the brainstorm's documented escape hatch (R22 Outstanding Question): call `runMigrations(db)` at the top of `src/db/client.ts`, guarded against re-entry with a module-level `migrated` boolean. |
| `revalidatePath`/`revalidateTag` calls during tests crash because there's no Next.js request context. | All mutation spec files mock `next/cache` at file scope (jest.mock). Tested in U6 + U10. |
| Drizzle's `db.transaction(tx => ...)` on better-sqlite3 is synchronous (unlike PG's async) — easy to miss when copy-pasting yoink patterns. | Documented in Key Technical Decisions. U10's atomicity tests catch async-callback misuse — better-sqlite3 transactions ignore promises and commit prematurely if the callback returns a promise that hasn't resolved. |
| Inside `db.transaction(tx => ...)`, a stray `db.insert(...)` (outer handle) instead of `tx.insert(...)` commits unconditionally even when the surrounding tx rolls back. Easy to land via copy-paste from yoink's async PostgreSQL patterns. | Codified Key Technical Decision + reviewed-in-PR discipline. U10's atomicity tests explicitly probe this by forcing a CHECK violation on the second statement and asserting the first did NOT persist — written so the wrong (outer-`db`) version of the code visibly fails the assertion. (Reviewer-driven explicit defense.) |
| Read-then-modify mutations using default `BEGIN DEFERRED` mode race with concurrent writers in another tab. | `BEGIN IMMEDIATE` on every read-then-modify mutation in U10. Partial unique index `one_active_session_per_routine` on `sessions` DB-enforces the most consequential serialization. (Reviewer-driven.) |
| `set_logs.action` column persists `'JumpTo'` accidentally OR a future FSM addition (e.g., a hypothetical `Pause` action) silently fails because the schema enum doesn't know about it. | The action enum on the schema only lists the eight set-action labels, not `JumpTo`. Reviewer-driven addition: `mappers.ts` carries a compile-time type assertion `_PersistableActions extends _SchemaActionEnum` that fails type-check if a future FSM addition isn't reflected in the schema enum. Converts the silent-data-corruption hazard into a CI failure. |
| Future destructive migrations (column drops, FK changes, type changes) use SQLite's recreate-table pattern, which can silently lose CHECK constraints or FK enforcement if the implementer forgets to disable+reenable `foreign_keys`. | (Reviewer-driven, R6 PRAGMA-context risk.) Documented in `apps/swole/README.md`. The CHECK-constraint regression test in `schema.spec.ts` (U4) catches drops by regex-matching the four type branches in the latest migration `.sql`. For FK enforcement, the test-db helper and the `runMigrations` wrapper both re-assert `foreign_keys = ON` after migrate completes. |
| A committed migration file is edited instead of a new one generated → tests pass on `:memory:` but production schema diverges silently. | (Reviewer-driven.) Append-only migration policy documented in README and `## Documentation / Operational Notes`. CI check (added in a follow-up if not in this PR) diffs `apps/swole/src/db/migrations/*.sql` against `main` and fails on any modification. |
| Hydration loses set_logs when the runner's parent routine or exercise was archived mid-session. | (Reviewer-driven correctness fix.) Archive mutations (`archiveRoutine`, `archiveExercise`) reject when an active session exists (U10). Hydration calls `getRoutineWithExercises(routineId, { includeArchived: true })` so even if the guard fails (manual DB tampering, future bug), the hydration path survives. |
| Survivor 4 imports inferred row types into UI components and writes ad-hoc DB→FSM conversion inline in JSX, drifting from the canonical mapping. | (Reviewer-driven boundary discipline.) Scope Boundaries explicitly says query functions return Drizzle row types; the UI layer must use `mappers.ts` helpers (`toSetLog`, `toRoutine`, etc.) for any FSM-shaped conversion. Survivor 4 adds an ESLint rule (or PR-review checklist) enforcing that `app/**` files don't import row types from `db/schema` directly. |
| The mid-session-routine-edit "don't do that" contract has a hole — `updateExercise({ startingWeight })` on a weighted exercise mid-session writes a `manual_edit` `progressions` row AND mutates `exercises.starting_weight`, which the active session is reading live. The FSM's `deriveNextWeight` for the next un-logged set could then jump unexpectedly. | Out of scope per brainstorm Scope Boundaries ("no routine_snapshot"). Documented in Key Technical Decisions. Future hardening: guard `updateExercise` analogously to `reorderExercises`, but only if real UX confusion materializes. For now, the implicit "don't edit a routine mid-session" rule stands. |
| Drizzle 0.45 + `dialect: 'sqlite'` + the CHECK constraint syntax may not have been exercised by anyone else in the monorepo — first SQLite consumer means first cut. | The brainstorm and PRD pre-committed to this stack. U2's verification step explicitly inspects the generated SQL to confirm Drizzle emitted the constraint correctly. If Drizzle 0.45 turns out to have a bug in SQLite CHECK emission, document and pin to the latest patch that works. |
| Docker build caches `.next` from a prior build that didn't ship `src/db/migrations` → runtime fails on first request because `migrationsFolder` is empty. | Documented in CLAUDE.md ("Docker Cache and Source Code Updates" section). U7 verification step explicitly tests a fresh container boot. The first deploy after this PR lands should rebuild base images: `./infra/base-images/build-base-images.sh && docker-compose up -d --build swole`. |

---

## Documentation / Operational Notes

- After this PR lands and proves out, write a `docs/solutions/architecture-patterns/sqlite-in-monorepo-<date>.md` entry (reserved by the brainstorm) capturing the patterns: singleton client, `instrumentation.ts` migrate-at-boot with boot-log drift detection, PRAGMAs on open, FK-RESTRICT + archive convention with active-session guards, `BEGIN IMMEDIATE` for read-then-modify mutations, partial unique indexes for cross-table invariants, FSM-typed-domain ↔ DB-row mapping via `mappers.ts`, compile-time enum-drift assertion. This is a `ce-compound` follow-up, not part of this PR.
- Update `apps/swole/README.md`. Sections to add:
  - **Database** — one paragraph: SQLite file path (`/data/swole.db` in container, `./swole.db` in dev), migration application via `instrumentation.ts`, `pnpm db:generate` for schema changes.
  - **Migrations are append-only** — a callout saying "Editing a committed `.sql` file under `src/db/migrations/` is a code-review-blocking offense. To change the schema, edit `schema.ts` and run `pnpm db:generate`, which produces a new numbered migration. Never edit `0000_*.sql` after it lands."
  - **Destructive migration discipline** — a note that future migrations using SQLite's recreate-table pattern (column drops, FK changes) must disable+reenable `foreign_keys` outside the transaction; the `runMigrations` wrapper reasserts `foreign_keys = ON` after migrate completes.
  - The README currently calls swole a "skeleton scaffold" — update that framing after this PR.
- Add (or document for follow-up) a CI check that diffs `apps/swole/src/db/migrations/*.sql` against `main` and fails on any modification of an existing file. The pattern is portable to other apps; if the lift is small, include it in this PR. If not, file as a follow-up.
- No new monitoring/alerting required. Prometheus already scrapes `/metrics`; the existing `prom-client` default registry covers process metrics. SQLite-specific metrics (file size, WAL checkpoint frequency) are deferred until they matter. Boot-time migration count is logged via pino and visible in `docker-compose logs swole | grep "swole migrations applied"`.
- The brainstorm reserves a future janitor for abandoned-session cleanup. That's a follow-up issue, not this PR.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-27-swole-data-layer-requirements.md](../brainstorms/2026-05-27-swole-data-layer-requirements.md)
- **PRD:** [docs/prds/swole.md](../prds/swole.md)
- **ADR-001:** [apps/swole/docs/adr/001-data-flow.md](../../apps/swole/docs/adr/001-data-flow.md)
- **Prior plans:** [Survivor 1 (infra foundation)](2026-05-26-001-feat-swole-infra-foundation-plan.md), [Survivor 2 (session machine)](2026-05-26-002-feat-swole-session-machine-plan.md)
- **Institutional learning:** [docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md](../solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md)
- **External docs:**
  - [Drizzle ORM — SQLite Getting Started](https://orm.drizzle.team/docs/get-started/sqlite-new)
  - [Drizzle ORM — Migrations](https://orm.drizzle.team/docs/migrations)
  - [Next.js — instrumentation.ts file conventions](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
  - [vercel/next.js#49897 — instrumentation in standalone mode (resolved)](https://github.com/vercel/next.js/issues/49897)
  - [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3)
  - [WiseLibs/better-sqlite3#1384 — Node 24 prebuilt binary tracking](https://github.com/WiseLibs/better-sqlite3/issues/1384)
- **Code references:**
  - `apps/swole/src/core/session-machine.ts` — FSM types
  - `apps/yoink/src/db/schema.ts`, `apps/yoink/drizzle.config.ts` — closest existing Drizzle patterns (PostgreSQL; this PR diverges on dialect)
  - `apps/swole/Dockerfile`, `apps/swole/deploy.yml` — files this PR modifies
