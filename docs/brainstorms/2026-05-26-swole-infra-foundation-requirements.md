---
date: 2026-05-26
topic: swole-infra-foundation
---

# Swole — Infra Foundation PR

## Problem Frame

The `apps/swole/` scaffold (commit `fe16ff1`) shipped with four latent infra bugs and one architectural contradiction:

1. `apps/swole/deploy.yml` has no auth middleware, so `swole.lilnas.io` would deploy publicly.
2. `apps/swole/deploy.yml` has no volume mount, so any persistent state (the planned SQLite file from Survivor 3) would evaporate on every `docker-compose up -d --build`.
3. `@mui/material-nextjs` is pinned at `7.3.3` while `apps/swole/src/components/Provider.tsx` imports `v15-appRouter`; Next.js 16 needs the `v16-appRouter` export, first shipped in `7.3.7`.
4. `LoggerModule.forRoot()` is bare — no NODE_ENV-aware config and no production log level cap.
5. `docs/prds/swole.md` prescribes a Vite + Radix + jotai frontend the scaffold did not build. Every other hybrid app in the monorepo (`apps/yoink`, `apps/token`, `apps/tdr-bot`, `apps/download`) uses Next.js + MUI; only `apps/macros` is Vite, and macros has no backend. The PRD is stale, not the scaffold.

Zero domain code exists yet, so this is the cheapest moment to fix all of it, settle the data-flow direction in an ADR, and reconcile the PRD — before any feature PR has to re-litigate these decisions.

This brainstorm also resolves one downstream architecture call surfaced during the conversation: **the NestJS process is removed entirely** rather than kept as an observability shell. swole becomes the first Next.js-only service in the lilnas monorepo. The full rationale is in Key Decisions.

---

## Requirements

**Deploy and infrastructure**

- R1. `apps/swole/deploy.yml` adds `traefik.http.routers.swole.middlewares=forward-auth` so the production hostname is gated by the same auth middleware as `apps/token`, `apps/portal`, and `apps/tdr-bot`. (The middleware is named `forward-auth` — not `forward-auth@file` as the ideation doc suggests — and is defined via Docker labels in `infra/proxy.yml`.)
- R2. `apps/swole/deploy.yml` mounts `/storage/app-data/swole:/data` so future SQLite data (and any other persistent state) survives container rebuilds. Path follows the `apps/yoink` `/storage/app-data/yoink/...` convention.
- R3. `apps/swole/deploy.dev.yml` continues to use `swole.localhost` and the `/source` mount; no forward-auth middleware added (matches every other lilnas dev compose).

**Frontend dependencies**

- R4. `@mui/material-nextjs` is bumped to `^7.3.7` (first release with the `v16-appRouter` export, from `mui/material-ui#47134`, merged 2025-10-30). `apps/swole/src/components/Provider.tsx` imports `AppRouterCacheProvider` from `@mui/material-nextjs/v16-appRouter`.

**NestJS removal**

- R5. The NestJS process and all NestJS-specific files are deleted: `apps/swole/src/app.module.ts`, `apps/swole/src/bootstrap.ts`, `apps/swole/src/main.ts`, `apps/swole/src/health/` (both `health.module.ts` and `health.controller.ts`), and `apps/swole/nest-cli.json`.
- R6. NestJS-only dependencies are removed from `apps/swole/package.json`: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `nestjs-pino`, `nestjs-zod`, `@willsoto/nestjs-prometheus`, `pino-http`, `reflect-metadata`, `rxjs`, `source-map-support`. `zod` stays. `prom-client` stays (used directly by the new metrics route). `pino` is added as a direct dependency. `npm-run-all` is kept only if remaining scripts still need `run-p`.
- R7. `apps/swole/package.json` `scripts` collapse to single-process Next.js: `dev` (just `next dev -p 8080`, no parallel backend, no `lilnas dev` wrapper unless that wrapper is what `dev` should still call — planner decides), `build` (`next build`), `start` (`node server.js`). The `build:backend`, `dev:backend`, `start:backend`, and `dev:start` scripts are dropped.
- R8. `apps/swole/next.config.ts` drops the `/api/*` → backend rewrite. Next.js route handlers under `app/api/` (or top-level paths) now serve those URLs directly.
- R9. `apps/swole/Dockerfile` is replaced with a single-stage Next.js standalone build. Reference: `apps/portal/Dockerfile` or `apps/macros/Dockerfile` — whichever is closer to Next.js 16 + standalone-output (planner picks).

**Observability replacement**

- R10. A health route handler responds 200 with a small JSON body (`{ status: 'ok' }` or similar). Path is `/api/health` if following the Next.js `/api/*` convention, or `/health` if matching the lilnas backend convention; planner decides. The production Dockerfile `HEALTHCHECK` (if any) hits this path.
- R11. A metrics route handler exposes Prometheus default metrics via `prom-client` (the existing dep). Default Node.js metrics are collected once at module load (singleton registry). Path should be `/metrics` for consistency with every other lilnas service's scrape config; can fall back to `/api/metrics` if `/metrics` conflicts with App Router conventions the planner discovers.
- R12. `infra/monitoring/prometheus.yml` adds a `swole` scrape job: `metrics_path` matching R11's chosen path, `targets: ['swole:8080']` (Next.js port, since there is no longer a separate backend port). This file currently has zero swole config — failing to add this would silently produce no swole metrics in Grafana.
- R13. Logging uses `pino` directly with NODE_ENV-aware config equivalent to `apps/token/src/app.module.ts`'s LoggerModule: `level: 'info'` in production (plus `redact: ['req.headers.authorization', 'req.headers.cookie']` from the yoink pattern), `pino-pretty` transport in development, optional file destination when `LOG_FILE_PATH` is set. Module lives in `apps/swole/src/lib/logger.ts` (or equivalent — see Outstanding Questions).

**Data flow ADR**

- R14. `apps/swole/docs/adr/001-data-flow.md` exists and documents the data-flow direction for all future swole work: Drizzle is imported directly in Next.js server components for reads and in server actions for mutations; `useOptimistic` (React 19) handles optimistic UI on the active-session runner; **no NestJS REST layer; no React Query / TanStack Query**.
- R15. The ADR explicitly notes that this differs from `apps/yoink`'s actual pattern (which keeps Drizzle in NestJS and calls it from Next.js via internal HTTP via `apps/yoink/src/media/api.server.ts`). The ADR records why swole picked simpler-than-yoink: N=1 user, no third-party API integrations to host, no scheduled jobs, no WebSocket needs, no auth surface to own (forward-auth handles auth at Traefik).
- R16. The ADR records rejected alternatives with one-line reasons: (a) token-style REST + React Query throughout, (b) hybrid with documented boundary (yoink-style for routine CRUD, token-style for the session runner), (c) punt the decision until the active-session runner forces it.

**PRD alignment**

- R17. `docs/prds/swole.md` tech-stack section is rewritten to describe what actually exists: Next.js 16 App Router + React 19 + MUI 7 + Tailwind v4. The Vite + Radix + jotai prescription is removed. The "Key files to reuse" section points to `apps/yoink` and `apps/token` as the closest references (not `apps/macros`).
- R18. `docs/prds/swole.md` file-structure section drops the `backend/` + `frontend/` split and the separate `shared/` directory, replacing them with the flat `src/` layout matching the actual scaffold. Shared module paths reference `src/core/` (or equivalent — planner aligns with R13's logger location).
- R19. `docs/prds/swole.md` data-flow description aligns with ADR-001: server components for reads, server actions for mutations, `useOptimistic` for the active-session runner. References to React Query, jotai, and a NestJS REST surface are removed.

---

## Success Criteria

- A reviewer reading `apps/swole/deploy.yml` and `docs/prds/swole.md` after this PR can answer "is this behind auth?", "where does persistent data live?", and "what's the data-flow pattern?" without consulting other files.
- A fresh `docker-compose -f apps/swole/deploy.yml up -d` produces a service that (a) is behind `forward-auth` at `swole.lilnas.io`, (b) has `/storage/app-data/swole` mounted at `/data`, (c) responds 200 on the health route, (d) exposes Prometheus default metrics on the metrics route, (e) appears in Prometheus targets via the new scrape job.
- `docker-compose -f apps/swole/deploy.dev.yml up -d` produces a working dev container at `swole.localhost` with no auth and hot-reload from `/source`.
- `pnpm --filter @lilnas/swole build`, `pnpm --filter @lilnas/swole lint`, and `pnpm --filter @lilnas/swole type-check` all pass.
- The next swole PR (data foundation per Survivor 3, or pure FSM per Survivor 2) starts work without re-litigating any decision captured here — no "wait, are we on NestJS?" or "do we need React Query?" questions during planning.

---

## Scope Boundaries

- No Drizzle setup, no `apps/swole/src/db/`, no schema, no migrations. The volume mount is added so SQLite can land later; the actual SQLite + `better-sqlite3` + migrations work is Survivor 3.
- No session-state machine code (`apps/swole/src/core/session-machine.ts`). That is Survivor 2.
- No routine-builder UI, no `/session/[id]` runner, no exercise primitives. Survivor 4.
- No additional ADRs beyond ADR-001. Subsequent ADRs land with the work that motivates them.
- No `docs/solutions/` entry for "SQLite-in-monorepo" — that pairs with the actual SQLite landing (Survivor 3), not with this scaffold cleanup.
- No metrics or logger helper extracted into `@lilnas/utils` for Next.js-only services. swole is the first such service; if a second appears, that's the moment to extract a shared module. Rule of Three.
- No production rollout. This PR's verification is build + dev compose + visual inspection of `deploy.yml`. Production deploy is a separate, manual step after merge.
- No env-file population. `infra/.env.swole` is referenced by both compose files; whether it exists or what it contains is outside this PR's scope.
- No changes to other lilnas apps' Prometheus scrape configs, Logger setups, or Dockerfiles, even if cleaning them up would feel consistent. Each app stays at its current pattern until a real reason to migrate appears.

---

## Key Decisions

- **Strip NestJS entirely rather than keep it as an observability-only shell.** Reasoning: swole has no domain motivator for NestJS — no third-party API host, no scheduled jobs, no WebSockets, no event emitter, no auth middleware to own. Keeping NestJS just to serve two endpoints adds a second process, a Dockerfile stage, and a port for zero payoff. swole becomes the first Next.js-only lilnas service. If observability divergence ever creates real friction (e.g., a missing dashboard pattern), reverting to a NestJS shell is a small migration; doing the reverse later would require redesigning the data layer.
- **Data flow is all-Next.js: Drizzle in server components and actions, `useOptimistic` for optimistic UI.** Rejected: token-style REST + React Query everywhere (consistent with monorepo but unnecessary indirection for N=1 user with no real-time pressure), hybrid with documented boundary (two patterns to maintain for no concrete win), punt until session runner exists (the ADR is the right place to commit; "TBD" architecture decisions rot and accumulate decision-cost).
- **Cement Next.js 16 + MUI 7 in the PRD rather than revert the scaffold to Vite + Radix + jotai.** Every other lilnas hybrid app uses Next.js + MUI. The PRD's Vite prescription pre-dated `apps/yoink` and `apps/token`. Cementing convention is cheaper than reverting against precedent.
- **Auth middleware name is `forward-auth`, not `forward-auth@file`.** Verified against `apps/token/deploy.yml`, `apps/portal/deploy.yml`, `apps/tdr-bot/deploy.yml`, `infra/proxy.yml`. The ideation doc's `@file` suffix would silently fail to attach the middleware.
- **Volume mount path is `/storage/app-data/swole:/data`.** Matches `apps/yoink`'s `/storage/app-data/yoink/...` host-side convention; container-side `:/data` matches the PRD's expectation that the SQLite file will live at `/data/swole.db` (locked in by Survivor 3, not this PR).
- **No forward-auth middleware in `deploy.dev.yml`.** Matches `apps/token/deploy.dev.yml` and every other lilnas dev compose; localhost is unauthenticated by convention.
- **Prometheus scrape config is updated as part of this PR, not deferred.** Adding swole's first scrape job here costs one minute and prevents a silent "no swole metrics ever appear in Grafana" failure mode after the first production deploy.

---

## Dependencies / Assumptions

- `@mui/material-nextjs@7.3.7` (or newer) is available on npm. The PR landed in `mui/material-ui` on 2025-10-30; the package has been released for roughly seven months as of 2026-05-26. Verify the highest patch version when bumping.
- `prom-client@15.x` (already in `apps/swole/package.json`) works as a direct import in a Next.js App Router route handler, with `register.metrics()` returning the metrics body and `collectDefaultMetrics()` callable once at module load. Verified at the conceptual level; confirm the singleton-registry behavior holds under App Router's request handling at planning time.
- `infra/proxy.yml`'s `forward-auth` middleware accepts any Traefik router that opts in via labels; no per-domain allowlist needs editing. Verified: `infra/proxy.yml:59-62` defines the middleware globally.
- `pnpm --filter @lilnas/swole dev` (after R7) runs only Next.js, not a parallel NestJS process. The `lilnas dev` CLI command (currently `pnpm run dev`'s implementation in `apps/swole/package.json`) is assumed to be a thin wrapper that delegates to the per-app `dev:start` script; planner verifies whether `dev` should keep using `lilnas dev` or call `next dev -p 8080` directly.
- `infra/.env.swole` is assumed to exist (or will be created independently of this PR). Both `deploy.yml` and `deploy.dev.yml` reference it; this PR does not populate it.
- No work-in-progress branch off `fe16ff1` has uncommitted domain code that would be wiped by R5's deletions. Verified: zero domain code exists in the scaffold.
- Whether this PR ships as one atomic commit or splits into two (narrow infra fixes vs. NestJS strip + PRD revision) is a planning-time call. The doc treats all 19 requirements as one logical unit; splitting is permitted if it simplifies review.

---

## Outstanding Questions

### Resolve Before Planning

_None. All product and architecture decisions are settled._

### Deferred to Planning

- [Affects R9][Technical] Should `apps/swole/Dockerfile` mirror `apps/portal/Dockerfile` (which extends `lilnas-nextjs-runtime`) or `apps/macros/Dockerfile`? Both are Next.js-only; pick the one whose pattern works cleanly with Next.js 16 standalone output.
- [Affects R7][Technical] Should `pnpm --filter @lilnas/swole dev` still call `lilnas dev` (the existing scaffold script), or should it invoke `next dev -p 8080` directly now that there is no parallel backend? Depends on what `lilnas dev` does for single-process apps.
- [Affects R10, R11][Technical] Final paths for the health and metrics endpoints — `/api/health` vs `/health`, `/api/metrics` vs `/metrics`. The Prometheus convention is `/metrics`; the Next.js convention is `/api/*`. Pick during planning after confirming whether App Router route handlers at top-level paths interact cleanly with MUI page routes.
- [Affects R11][Needs research] Confirm `prom-client@15`'s `register.metrics()` is safe to call from a Next.js App Router route handler invoked per request without re-registering default metrics. Likely fine via module-level `collectDefaultMetrics()` call, but verify with a quick repro.
- [Affects R10, R11][Technical] Does `forward-auth` need an exclusion path for `/metrics` and `/health` so Prometheus and any external healthcheck can hit them without an auth cookie? Check whether the existing forward-auth config bypasses these paths by default (e.g., via the `apps/token` "public router" pattern) or whether swole needs its own exception.
- [Affects R13][Technical] Logger module location: `apps/swole/src/lib/logger.ts`, `apps/swole/src/logger.ts`, or `apps/swole/src/observability/logger.ts`? Decide alongside the PRD's file-structure update (R18) so the doc and code agree.
- [Affects R17, R18, R19][Editorial] The PRD has sections beyond tech-stack and file-structure (data model, verification, out-of-scope ideas). Are those left untouched in this PR, or are inconsistencies anywhere else in the PRD also reconciled here? Default assumption: only sections that contradict the scaffold or ADR-001 are touched; everything else is left for the work that materializes it.

---

## Next Steps

`-> /ce-plan` for structured implementation planning.
