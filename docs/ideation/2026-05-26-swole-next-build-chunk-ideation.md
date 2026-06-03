---
date: 2026-05-26
topic: swole-next-build-chunk
focus: What is the next thing we should focus on building in apps/swole/, given the scaffold and PRD?
mode: repo-grounded
---

# Ideation: Swole — Next Build Chunk

## Grounding Context

### Current state of `apps/swole/`

The scaffold exists (commit `fe16ff1`): NestJS 11 backend + Next.js 16 App Router frontend + MUI 7 + Tailwind v4 + Pino + Prometheus metrics interceptor + zod + nestjs-zod. There is a `/health` endpoint, a "Swole — coming soon" home page, a Dockerfile, `deploy.yml`, and `deploy.dev.yml`. The `next.config.ts` rewrites `/api/*` → backend (stripping the `/api` prefix). **Zero domain code exists.**

### Latent bugs in the scaffold (verified against repo)

1. **`apps/swole/deploy.yml` has NO `forward-auth@file` middleware** — the PRD states `swole.lilnas.io` should be behind forward-auth, but the labels are missing. The app would deploy publicly.
2. **`apps/swole/deploy.yml` has NO volume mount** — without `/storage/app-data/swole:/data`, the planned SQLite file would evaporate on every `docker-compose up -d --build`. The PRD's verification step #6 (restart preserves data) would fail on day one.
3. **`@mui/material-nextjs` is pinned to `7.3.3` and the scaffold imports `v15-appRouter`** — Next.js 16 needs the `v16-appRouter` export, which landed in MUI `7.3.7` (PR mui/material-ui#47134, merged 2025-10-30). Live hydration/styling risk on every page.

### PRD/scaffold divergence

- The PRD prescribes Vite + React 19 + Radix UI + jotai for the frontend (mirroring `apps/macros/`).
- The scaffold went Next.js 16 + MUI 7 (mirroring `apps/yoink`, `apps/token`, `apps/tdr-bot`, `apps/download`).
- **Every other hybrid app in the monorepo uses Next.js+MUI.** Only `apps/macros/` is Vite — and `apps/macros/` has no backend. The scaffold matches monorepo convention; the PRD references a stale template.

### Monorepo precedent

- **Drizzle is universal**, but every existing user runs Postgres (`apps/token`, `apps/yoink`, `apps/tdr-bot`). SQLite would be first-of-kind.
- The shared `DrizzleService` pattern is uniform: pool config from env, `OnModuleDestroy` for graceful shutdown, `db = drizzle(client, { schema })`.
- `apps/yoink` uses **server components importing Drizzle directly** + server actions for mutations.
- `apps/token` uses **NestJS REST + React Query** with a typed `api.ts` fetch wrapper.
- Both are valid; swole has not picked.
- `nestjs-zod` (5.0.1) and `zod` (4.1.12) are already in `apps/swole/package.json` but unused — the type-safety seam is open.
- `docs/solutions/` directory **does not exist anywhere in the monorepo**. This work is the obvious bootstrap material.

### External grounding (2026 best practice)

- **Drizzle + better-sqlite3 + NestJS**: schema-as-code in `src/db/schema.ts`, migrations generated via `drizzle-kit`, run via `migrate(db, { migrationsFolder })` synchronously in bootstrap. better-sqlite3 native bindings need Python+make+g++ in the Docker builder stage; Node 24 breaks compatibility — pin Node 20.
- **Next.js 16 + NestJS REST consensus**: keep mutations in NestJS, server components can fetch from NestJS endpoints (not directly from DB). Server Actions reasonable for form submissions but bypass NestJS guards/pipes for anything with side-effects.
- **Tracker UX (Hevy/Strong) canonical pattern**: per-set row with **previous session's numbers visible next to current inputs** (passive reference, not placeholder text). Fuse set-complete + rest-timer-start into one gesture. Inline numeric steppers, not full-screen modals.

## Ranked Ideas

### 1. Foundation-Fix PR — close latent infra gaps + write ADR-001 before any domain code

**Description:** One small PR that does the boring pre-work right:
- Add `traefik.http.routers.swole.middlewares=forward-auth@file` to `apps/swole/deploy.yml`
- Add `volumes: - /storage/app-data/swole:/data` to `deploy.yml` (and the dev equivalent)
- Bump `@mui/material-nextjs` to `^7.3.7` and switch `apps/swole/src/components/Provider.tsx` import from `v15-appRouter` → `v16-appRouter`
- Write `apps/swole/docs/adr/001-data-flow.md` picking yoink-style (Drizzle in server components + server actions for routine CRUD) vs token-style (NestJS REST + React Query for the live `/session/[id]` runner), with documented boundary
- Tighten `LoggerModule.forRoot(...)` per `apps/token/src/app.module.ts` (NODE_ENV-aware: pino-pretty in dev, `level: 'info'` in prod)

**Rationale:** Every later PR depends on these. Each gap is a known foot-gun: missing volume mount → silent data loss on next redeploy; missing forward-auth → personal log exposed at a public DNS name; wrong MUI import → flickering hydration on the highest-fidelity screen the app will have. The ADR resolves the data-flow question once, so no future PR has to re-litigate "where does this go?". Two hours of work.

**Downsides:** Feels like no progress; tempting to skip and dive straight into features.

**Confidence:** 95%
**Complexity:** Low (~2h)
**Status:** Unexplored

---

### 2. Pure-TS set-action state machine in `src/core/session-machine.ts`

**Description:** Build `applyAction(state, action) → state` as a pure typed module covering all 5 actions (Increment/Stay/Decrement/Complete/Failed) across all 4 exercise types (weighted/bodyweight/time-based/cardio). Include the post-session prompt classifier — case A (all sets ≥ original SW → ask Stay vs Roll-up) vs case B (any set < original SW → auto-set SW to lowest used). Exhaustive Jest tests (~60 cases) covering every (action × type × set-position) cell, with PRD F2/F3 examples encoded by name. No NestJS, no React, no SQLite — pure function.

**Rationale:** Four of six ideation frames independently surfaced this. The FSM is the only genuinely complex logic in v1; everything else is CRUD. Locking it down as a shared kernel means UI optimistic updates and backend session-completion services import the same module — they cannot drift. Bugs in this layer corrupt data permanently; bugs in UI are visible and reversible. Pay the typing/testing tax exactly once, in one file, before it's threaded through controllers and components. The data model then emerges from FSM needs instead of being designed in the abstract.

**Downsides:** One file the user has to context-switch into. Argues for vertical extraction before there's obvious need; tempting to inline into a controller later.

**Confidence:** 90%
**Complexity:** Low-Medium (~3-4h including tests)
**Status:** Unexplored

---

### 3. Data foundation — Drizzle + better-sqlite3 + manual migrations + zod-derived DTOs + first `docs/solutions/` entry

**Description:** Land the data layer in one focused chunk:
- `apps/swole/src/db/{client.ts, schema.ts, migrate.ts}` mirroring `apps/token/src/db/` shape but swapping `drizzle-orm/node-postgres` → `drizzle-orm/better-sqlite3`. WAL pragma, `foreign_keys=ON`. `OnModuleDestroy` calls `db.$client.close()` to flush WAL.
- 5 tables per PRD §"Data model" (routines, exercises, sessions, set_logs, progressions) — defer the event-log reframe to a v2 brainstorm.
- Drizzle migrations in `drizzle/`, run via `pnpm db:migrate` CLI (NOT on boot — better-sqlite3's native bindings need verified Python+make+g++ in `lilnas-monorepo-builder`; pin Node 20 not 24).
- `pnpm db:reset && pnpm db:seed` with one realistic routine (PUSH day: Bench 3×10@100+5, Pushups 3×15, Plank 3×30s — matches PRD Verification §3).
- Co-locate zod schemas per entity (`<feature>.dto.ts`), use `nestjs-zod` for controller pipes, `z.infer<typeof X>` from FE.
- Write `docs/solutions/sqlite-in-monorepo.md` — first `docs/solutions/` entry in the entire monorepo; captures driver choice, WAL pragma, volume mount, migration-on-CLI rationale, Node-version pin.

**Rationale:** Every future PR touches the DB. Without this, every PR drags as it re-derives the pattern. With this landed, the next entity is copy-paste-rename. The shared zod-schema seam eliminates BE-FE type drift before there's any drift to clean up. The `docs/solutions/` entry pays back across every future small app in the monorepo.

**Downsides:** Picks better-sqlite3 over libsql without an explicit ADR (libsql has zero precedent here either — `apps/tdr-bot` lists it unused). Native bindings = a Docker-build risk that may surface on first CI run. 5 tables before one screen exists is YAGNI-adjacent; the event-log alternative is tempting.

**Confidence:** 80%
**Complexity:** Medium (~half-day)
**Status:** Unexplored

---

### 4. First vertical slice — active-session runner E2E against ONE hardcoded routine

**Description:** Build the single highest-value screen end-to-end:
- Hardcode Jeremy's actual current routine in `apps/swole/src/routines/push-day.ts` as a typed TS module; `db:seed` upserts it. **No routine-builder UI in this slice.**
- `/session/[id]` page drives the set-action state machine from Survivor 2.
- "Prior performance" query: given exercise X + current routine, return the matching set from the most recent prior completed session. This is the top-down query that forces the schema to answer the hardest read cheaply.
- Three primitive components built ONLY as needed:
  - `<SetRow>` — with the prior-performance reference rendered to the left of current inputs (the killer Hevy/Strong UX pattern)
  - `<ActionBar>` — renders the action button set per exercise type
  - `<WeightStepper>` — inline numeric, no modal
- Post-session weight-progression prompt per PRD F3 (uses the same shared FSM module from Survivor 2 to classify case A vs B).
- Token-style REST + React Query (per ADR-001) for the live screen — the only place optimistic updates actually pay off.

**Rationale:** Maximum value per slice. The active-session runner IS the app — the rest is supporting cast. Building it first against a hardcoded routine defers the lowest-value PRD pieces (F1 routine creation, F5 routine editing) until the highest-value flow is proven. Forces the schema, the FSM, the API contract, and the component primitives to be exercised end-to-end on real data.

**Downsides:** Deferring routine CRUD means Jeremy can't customize his routine without editing TS — but for an N=1 dev-user with a stable routine, that's plausibly a feature, not a bug. Three primitives is YAGNI-on-its-face but they all definitely appear here and on every subsequent screen.

**Confidence:** 85%
**Complexity:** Medium-High (~2-3d)
**Status:** Unexplored

---

### 5. PRD revision — bring the PRD into agreement with reality

**Description:** Edit `docs/prds/swole.md` lines 143-209 to:
- Replace "Vite + React 19 + TypeScript + Tailwind + Radix UI" with "Next.js 16 App Router + React 19 + Tailwind + MUI 7"
- Replace "`jotai` atoms" + "React Query" with the data-flow boundary from ADR-001 (server components for CRUD; React Query for the active-session screen)
- Update the "File structure" diagram to drop the `backend/`+`frontend/` split (the scaffold uses one flat `src/` per the `apps/download/` pattern) and the separate `shared/` directory (use `src/core/` instead)
- Update the "Key files to reuse" list to add `@lilnas/utils`'s `metrics-interceptor`, and note that `apps/yoink` / `apps/token` are the actual NestJS+Next.js references (not the Vite-only `apps/macros`)

**Rationale:** A PRD that contradicts its own scaffold gets ignored, then drifts further, then gets quietly forgotten. The scaffold's choices are defensible (matches every other hybrid app); the PRD's choices are stale (mirrored `apps/macros` before yoink/token existed). Better to make the PRD match reality than to leave a permanent contradiction. 20-minute edit that prevents weeks of "is this right?" hesitation on every later PR.

**Downsides:** Pushes back on the documented intent — if Jeremy actually wanted Vite+Radix and the scaffold went rogue, this PR cements the rogue choice. Worth confirming the direction explicitly before merging.

**Confidence:** 75% (the divergence resolution is high-confidence; *which direction* needs Jeremy's call)
**Complexity:** Low (~30m once the direction is picked)
**Status:** Unexplored

---

## Recommended sequence

Given the question was "what is the **next** thing" (singular):

1. **Survivor 1 (Foundation-Fix PR)** — first, alone. ~2 hours. Unblocks everything.
2. **Survivor 5 (PRD revision)** — folds into Survivor 1's PR or follows as a quick second PR.
3. **Survivor 2 (Pure FSM)** — the brain of the app, locked down before any data layer can mess with it.
4. **Survivor 3 (Data foundation)** — the persistence story.
5. **Survivor 4 (First vertical slice)** — when the app becomes useful.

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| F1-3 | "PriorPerformance DTO drives schema top-down" | Insight folded into Survivor 4 (prior-performance query is the schema-driving read in the first slice). |
| F1-6 | "First-use loadable seed (30 exercises)" | Scope inflation — Survivor 3's smaller seed (one realistic routine matching PRD Verification §3) suffices. |
| F1-7 | "Backup-on-write + restore CLI" | Premature for next-chunk; revisit after first real session is logged. |
| F2-2 | "Stats-first build order" | Requires historical data Jeremy doesn't have without an import path; secondary value vs. session runner. |
| F2-3 | "Auto-apply progressions with undo" | UX direction, not a build chunk. Surface during Survivor 4 brainstorm. |
| F2-4 | "One-page app, no dialogs/routes" | UX direction, not a build chunk. |
| F2-5 | "LLM-scaffolded routine authoring" | Too speculative for v1; v2 brainstorm material at best. |
| F2-6 | "Hand-written SQL migrations, no Drizzle" | Loses type-safety benefits; Drizzle is the conventional choice in this monorepo for good reason. |
| F2-7 | "Default-completed sets" | UX inversion that belongs in brainstorm, not next-chunk choice. |
| F2-8 | "Auto-detect sessions" | Speculative + adds infra (Health API or heuristic). v2. |
| F3-1 | "Pure FSM first" | Duplicate of Survivor 2. |
| F3-2 | "Single JSON file, no SQLite" | Tempting for N=1, but Drizzle's type-safety + query ergonomics + monorepo precedent outweigh the simplicity win. |
| F3-3 | "IndexedDB + URL state offline-first" | Significant client-side complexity for one user with reliable home WiFi. v2. |
| F3-4 | "Hardcode Jeremy's routines" | Subsumed into Survivor 4. |
| F3-5 | "One Next.js app, no NestJS" | Loses metrics interceptor + Pino prod config; surface as brainstorm question only if ADR-001 comes back conflicted. |
| F3-6 | "v1 as CLI + stats page" | Too radical for next chunk; reframes the entire product. |
| F3-7 | "Rip out MUI, use Tailwind+Radix" | Folded into Survivor 5 as the "other direction" the PRD revision could go. |
| F3-8 | "Three-table event log" | Schema-design move worth a brainstorm question during Survivor 3, but YAGNI says start with PRD's 5. |
| F4-1 | "packages/sqlite-drizzle/" | Premature abstraction; Rule of Three not met (zero current SQLite users in monorepo). |
| F4-3 | "ADR-001 data-flow topology" | Folded into Survivor 1. |
| F4-4 | "First docs/solutions/ entries" | Folded into Survivor 3. |
| F4-6 | "nestjs-zod + generated TS client" | Folded into Survivor 3. |
| F4-7 | "Realistic fixture library (800 set logs)" | Scope inflation; small seed in Survivor 3 suffices until stats screen exists. |
| F4-8 | "Primitive components (SetRow/ActionBar/WeightStepper)" | Folded into Survivor 4; build only when first screen needs them. |
| F4-9 | "Property-based state-machine contract tests" | Folded into Survivor 2; fast-check optional. |
| F5-1..8 | All cross-domain UX analogies (rebase, Anki 4-button, pilot checklist, Bloomberg, Ableton, Smitten Kitchen, EMR macros, RPG level-up) | UX direction for the active-session screen, not next-chunk choices. Strong brainstorm-stage inputs when Survivor 4 starts — Anki mapping (Again/Hard/Good/Easy → Failed/Decrement/Stay/Increment) is particularly striking. |
| F6-1 | "Single text input parser ('Bench 3x10@100+5')" | Radical reframe of routine input; brainstorm material. |
| F6-3 | "500-line single HTML file" | Constraint flip useful for what it reveals about dependency bloat, but not actionable. |
| F6-4 | "Disney-grade set completion animation" | UX polish, not next chunk. |
| F6-5 | "30-day rolling window only" | Forcing function for simpler stats, not a build chunk. |
| F6-6 | "iOS Shortcut tracker" | Stack flip outside committed direction. |
| F6-7 | "1-button lifter" | UX direction. |
| F6-8 | "TUI lifter" | Stack flip outside committed direction. |
