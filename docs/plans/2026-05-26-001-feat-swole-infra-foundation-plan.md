---
title: 'feat: Swole infra foundation — strip NestJS, gate auth, write ADR-001'
type: feat
status: completed
date: 2026-05-26
origin: docs/brainstorms/2026-05-26-swole-infra-foundation-requirements.md
---

# feat: Swole infra foundation — strip NestJS, gate auth, write ADR-001

## Overview

The `apps/swole/` scaffold (commit `fe16ff1`) shipped with four latent infra bugs and one architectural contradiction (Vite+Radix+jotai PRD vs. Next.js+MUI scaffold). Zero domain code exists yet, so this PR fixes all of them in one atomic change: gate the production hostname behind `forward-auth`, add the persistent storage mount, bump `@mui/material-nextjs` for the Next.js 16 `v16-appRouter` export, strip NestJS entirely (swole becomes the first Next.js-only lilnas service), replace NestJS observability with a direct `pino` logger plus Next.js App Router route handlers for `/api/health` and `/metrics`, add swole to the Prometheus scrape config, write ADR-001 documenting the data-flow direction (Drizzle in server components and actions, `useOptimistic` for optimistic UI, no React Query, no NestJS REST), and reconcile the stale PRD.

---

## Problem Frame

The scaffold has five distinct problems, all cheap to fix while no feature code depends on them:

1. **Production hostname is public.** `apps/swole/deploy.yml` has no `traefik.http.routers.swole.middlewares=forward-auth` label, so `swole.lilnas.io` would deploy without auth gating (every other lilnas app behind that hostname is gated).
2. **No persistent volume.** `apps/swole/deploy.yml` has no `volumes:` clause, so future SQLite state (planned for Survivor 3) would evaporate on every `docker-compose up -d --build`.
3. **MUI Next.js adapter import will fail at runtime.** `@mui/material-nextjs@7.3.3` has no `v16-appRouter` export; the Next.js 16 export was added in `7.3.7` (mui/material-ui#47134, merged 2025-10-30).
4. **Logger is unconfigured.** `LoggerModule.forRoot()` is bare — no NODE_ENV-aware log levels, no redact for auth headers.
5. **PRD prescribes a stack the scaffold did not build.** `docs/prds/swole.md` describes a Vite + Radix + jotai frontend with a NestJS REST backend. Every other lilnas hybrid app (`apps/yoink`, `apps/token`, `apps/tdr-bot`, `apps/download`) uses Next.js + MUI. The PRD is stale, not the scaffold.

The brainstorm also resolves one downstream architecture call: **the NestJS process is removed entirely** rather than kept as an observability shell. swole has no domain motivator for NestJS — no third-party API host, no scheduled jobs, no WebSockets, no auth surface to own (forward-auth handles that at Traefik). Keeping NestJS to serve two endpoints buys nothing. swole becomes the first Next.js-only lilnas service. (Origin: rationale in Key Decisions block of the requirements doc.)

---

## Requirements Trace

- R1. Add `forward-auth` middleware label to `apps/swole/deploy.yml` so `swole.lilnas.io` is auth-gated like `apps/token`, `apps/portal`, `apps/tdr-bot` (origin R1).
- R2. Add `/storage/app-data/swole:/data` volume mount to `apps/swole/deploy.yml` for future SQLite persistence (origin R2).
- R3. `apps/swole/deploy.dev.yml` stays unchanged — `swole.localhost` with `/source` mount, no forward-auth (origin R3).
- R4. Bump `@mui/material-nextjs` to `^7.3.7` and update the `Provider.tsx` import to `v16-appRouter` (origin R4).
- R5. Delete the NestJS process and all NestJS-only files (origin R5).
- R6. Drop NestJS-only dependencies from `apps/swole/package.json`; add direct `pino` (origin R6).
- R7. Collapse `package.json` scripts to single-process Next.js (origin R7). Note: `dev:start` is retained as `next dev -p 8080` to serve as the `lilnas dev` CLI delegate (the CLI calls `pnpm run dev:start`). R7's literal "drop `dev:start`" is superseded by the resolution of R7's own planner-decides clause; see Key Technical Decisions.
- R8. Remove the `/api/*` rewrite from `next.config.ts` (origin R8).
- R9. Replace `apps/swole/Dockerfile` with a single-process Next.js standalone build mirroring `apps/portal/Dockerfile` (origin R9).
- R10. Add a Next.js route handler that responds 200 on the health path (origin R10).
- R11. Add a Next.js route handler that exposes Prometheus default metrics via `prom-client` (origin R11).
- R12. Add a `swole` scrape job to `infra/monitoring/prometheus.yml` (origin R12).
- R13. Configure `pino` directly with NODE_ENV-aware behavior plus `redact` for auth headers (origin R13).
- R14. Create `apps/swole/docs/adr/001-data-flow.md` documenting the all-Next.js data flow (origin R14).
- R15. ADR explicitly notes the divergence from `apps/yoink`'s actual pattern, with reasons (origin R15).
- R16. ADR records the three rejected alternatives with one-line reasons (origin R16).
- R17. Rewrite the `docs/prds/swole.md` tech-stack section to describe the actual scaffold; repoint "Key files to reuse" from `apps/macros` to `apps/yoink` and `apps/token` (origin R17).
- R18. Rewrite the `docs/prds/swole.md` file-structure section to match the flat `src/` layout (origin R18).
- R19. Align the `docs/prds/swole.md` data-flow section with ADR-001 (origin R19).
- R20. Update `apps/swole/README.md` to remove the stale "NestJS 11 (SWC builder)" stack reference (in-scope housekeeping added during planning; not in origin requirements — see SG-003 in the 2026-05-26 review).

---

## Scope Boundaries

- No Drizzle setup, no `apps/swole/src/db/`, no schema, no migrations. The volume mount lands so SQLite can land later; the actual SQLite + `better-sqlite3` + migrations work is Survivor 3.
- No session-state machine code. That is Survivor 2.
- No routine-builder UI, no `/session/[id]` runner, no exercise primitives. Survivor 4.
- No additional ADRs beyond ADR-001. Subsequent ADRs land with the work that motivates them.
- No `docs/solutions/` entry for "SQLite-in-monorepo" — that pairs with the actual SQLite landing (Survivor 3), not with this scaffold cleanup.
- No metrics or logger helper extracted into `@lilnas/utils` for Next.js-only services. swole is the first such service; if a second appears, that's the moment to extract a shared module. Rule of Three.
- No production rollout. This PR's verification is build + dev compose + visual inspection of `deploy.yml`. Production deploy is a separate, manual step after merge.
- No env-file population. `infra/.env.swole` is referenced by both compose files; whether it exists or what it contains is outside this PR's scope.
- No changes to other lilnas apps' Prometheus scrape configs, Logger setups, or Dockerfiles, even if cleaning them up would feel consistent. Each app stays at its current pattern until a real reason to migrate appears.
- No automated tests added in this PR. The brainstorm's success criteria require `build`, `lint`, and `type-check` to pass; verification is via dev/prod compose smoke tests. Tests land with the feature PRs that introduce behavior worth testing.
- No HEALTHCHECK directive in the new Dockerfile and no `healthcheck:` clause in `deploy.yml`. Token has a deploy-level healthcheck; portal does not. swole follows portal's lighter pattern; add later if real-world deploys surface a need.

---

## Context & Research

### Relevant Code and Patterns

- **`apps/portal/Dockerfile`** — canonical Next.js-only standalone build pattern (3-stage: deps → builder → runtime, extends `lilnas-nextjs-runtime`, copies standalone `server.js` to `/app/server.js`). Direct template for U6.
- **`apps/portal/package.json`** — scripts pattern for a single-process Next.js app: `dev: "lilnas dev"`, `dev:start: "next dev --turbopack -p 3000"`, `start: "NODE_ENV=production node server.js"`. Template for U3's script collapse (swole keeps port 8080 and skips `--turbopack` per brainstorm wording).
- **`apps/portal/src/app/api/health/route.ts`** — the only existing Next.js route handler in the monorepo. Uses `NextResponse.json(...)` with status, timestamp, service fields. Direct template for the `/api/health` route in U5.
- **`apps/token/src/app.module.ts:17-53`** — `LoggerModule.forRoot()` pattern with NODE_ENV branching, optional `LOG_FILE_PATH` dual-target. Template for U4's bare-pino translation (config moves from `pinoHttp:` wrapper to pino root options).
- **`apps/yoink/src/app.module.ts:24-32`** — adds `redact: ['req.headers.authorization', 'req.headers.cookie']` which R13 explicitly wants.
- **`apps/token/deploy.yml`** — `forward-auth` middleware label format plus the `token-public` "second router" idiom for path-prefix bypass. swole does not need the second router (see Key Decisions).
- **`apps/yoink/deploy.yml`** — `/storage/app-data/<app>/<subdir>:/data` volume convention.
- **`infra/proxy.yml:47-62`** — `forward-auth` middleware definition. Name is `forward-auth` (no `@file` suffix).
- **`infra/monitoring/prometheus.yml`** — existing scrape jobs use `metrics_path: /metrics` and `targets: ['<app>:<port>']`. Apps with both Next.js + NestJS scrape `<app>:8081`; apps without a separate frontend (`equations:8080`, `me-token-tracker:8080`) scrape port 8080. swole follows the port-8080 precedent now that NestJS is gone.
- **`packages/cli/src/commands/dev.ts:24-160`** — `lilnas dev` auto-detects `apps/<app>/drizzle.config.ts`; when absent, it simply runs `pnpm run dev:start`. No-ops cleanly for swole.
- **`apps/swole/src/components/Provider.tsx`** — current MUI integration to update (single import path change from `v15-appRouter` to `v16-appRouter`).

### Institutional Learnings

- None. `docs/solutions/` does not exist in the monorepo (confirmed by the learnings researcher). This PR is bootstrap material; the brainstorm explicitly defers the first `docs/solutions/` entry to Survivor 3 alongside SQLite.

### External References

- **mui/material-ui#47134** — the PR adding `@mui/material-nextjs/v16-appRouter`, merged 2025-10-30. Cited in the origin doc.
- No external research beyond the brainstorm's references is needed; all open technical questions resolve from in-tree precedent (portal Dockerfile, token logger, yoink redact, prometheus.yml scrape config, lilnas-dev CLI behavior).

---

## Key Technical Decisions

- **Health path is `/api/health`; metrics path is `/metrics`.** Health follows portal's only-existing Next.js route handler precedent; placing API endpoints under `/api/` clearly distinguishes them from page routes and keeps the page-route namespace free for product UI. Metrics follows the universal Prometheus scrape convention (every entry in `prometheus.yml` uses `/metrics`); App Router supports a top-level `app/metrics/route.ts` cleanly. Slight cross-convention inconsistency is intentional — each path matches its primary consumer's expectation.
- **Scrape target is `swole:8080`, not `swole:8081`.** Every other Next.js+NestJS app scrapes port 8081 (the internal NestJS port). swole has no NestJS process; the only port is 8080 (Next.js). Precedent for port-8080 scraping is `equations:8080` and `me-token-tracker:8080`.
- **No forward-auth bypass needed for `/metrics` or `/health`.** Prometheus scrapes from inside the Docker network at `swole:8080`, never traversing Traefik. There is no external HTTP healthcheck — Docker's `healthcheck:` clauses (when used elsewhere) hit `localhost` inside the container. Both endpoints can live behind `forward-auth` at the public hostname without breaking observability.
- **`dev` keeps the `lilnas dev` wrapper; `dev:start` becomes a single `next dev -p 8080` command.** Mirrors `apps/portal` exactly. `lilnas dev` no-ops cleanly when `drizzle.config.ts` is absent and remains the right entry point once Survivor 3 introduces SQLite.
- **Dockerfile mirrors `apps/portal/Dockerfile` verbatim**, swapping `portal` for `swole`. Macros is Vite + nginx (fundamentally different) and is not the model. Portal is the only existing Next.js-only standalone reference.
- **Logger module lives at `apps/swole/src/lib/logger.ts`.** Matches the brainstorm proposal and leaves room for `src/lib/*` companions later. Reduces churn vs. `src/observability/logger.ts`, which would create a single-file directory.
- **`prom-client` registry is a singleton; `collectDefaultMetrics({ register })` runs once at module load.** Next.js App Router does not re-execute module top-level per request, so the default `register` accumulates metrics across requests without re-registration errors. Dev-mode hot-reload may re-evaluate the module — guard with `register.clear()` before `collectDefaultMetrics({ register })`, or skip the guard and accept that dev hot-reload may need a manual restart if it crashes.
- **ADR-001 uses the Michael Nygard format** (Title, Status, Context, Decision, Consequences, Alternatives Considered). No prior ADR exists in the monorepo, so swole sets the convention. Nygard is the simpler, more widely-known shape; future ADRs in any lilnas app can adopt the same structure.
- **`npm-run-all` stays as a dependency.** The brainstorm flags it as optional ("kept only if remaining scripts still need `run-p`"). `lint` (`run-p -l 'lint:!(fix)'`) and `lint:fix` (`run-p -l lint:*:fix`) still use it.
- **One atomic PR rather than a split.** All 19 requirements interlock — NestJS removal forces script changes which force Dockerfile changes which force scrape-target changes. Splitting risks landing the repo in an intermediate broken state, and reviewer surface is large but each change is small and mechanical.
- **PRD edits stay narrow.** Only sections that contradict the scaffold or ADR-001 are rewritten (line 9 context phrase, tech-stack section lines 143-200, "Key files to reuse" lines 202-208). Sections covering user flows, data model, glossary, verification, and out-of-scope ideas are left untouched.

---

## Open Questions

### Resolved During Planning

- **Dockerfile template — portal vs. macros?** Resolved: **portal**. Macros is Vite + nginx and not Next.js standalone.
- **`pnpm --filter @lilnas/swole dev` — keep `lilnas dev` or call `next dev -p 8080` directly?** Resolved: **keep `lilnas dev`** with `dev:start: "next dev -p 8080"`. Mirrors portal; no-ops without Drizzle config.
- **Final health/metrics paths?** Resolved: **`/api/health` and `/metrics`** (rationale in Key Technical Decisions).
- **`prom-client` singleton safety under App Router?** Resolved: safe via module-level `collectDefaultMetrics({ register })`. Hot-reload concern mitigated with a `register.clear()` guard.
- **`forward-auth` exclusion for scrape and health paths?** Resolved: **not needed**. Prometheus scrapes via Docker network; no external HTTP healthcheck exists.
- **Logger module location?** Resolved: **`apps/swole/src/lib/logger.ts`** (matches brainstorm proposal; aligned with PRD R18 file-structure rewrite).
- **Editorial scope of PRD changes?** Resolved: only sections that contradict the scaffold or ADR-001. Lines 9, 143-208 are the only rewrites; the rest of the PRD is untouched.
- **One PR or split?** Resolved: **one PR**. Interlocking changes make a split fragile; review surface is manageable.

### Deferred to Implementation

- Exact patch version of `@mui/material-nextjs` to pin. Brainstorm specifies `^7.3.7` minimum; the implementer should pin the latest stable patch at install time (e.g., `7.3.9` if released by then) following the monorepo's exact-version convention.
- `apps/swole/tsconfig.json` and `apps/swole/jest.config.js` decorator-flag cleanup (`experimentalDecorators`, `emitDecoratorMetadata`) is intentionally out of scope for this PR — they become dead config after NestJS removal but are harmless if left. Implementer files a separate housekeeping commit when convenient.
- Whether to run `pnpm clean` locally to remove the stale `apps/swole/dist/` directory. Out of scope for the PR diff — the Dockerfile ignores it either way. Implementer's housekeeping call.

---

## Output Structure

After this PR, `apps/swole/` will look like:

    apps/swole/
    ├── deploy.yml                        # modified (forward-auth + volume)
    ├── deploy.dev.yml                    # unchanged
    ├── Dockerfile                        # replaced (portal pattern)
    ├── docs/
    │   └── adr/
    │       └── 001-data-flow.md          # new
    ├── eslint.config.cjs
    ├── jest.config.js
    ├── next.config.ts                    # rewrites() removed
    ├── package.json                      # NestJS deps dropped, pino added, scripts collapsed
    ├── postcss.config.cjs
    ├── README.md                         # NestJS reference removed (U9, R20)
    ├── src/
    │   ├── app/
    │   │   ├── api/
    │   │   │   └── health/
    │   │   │       └── route.ts          # new (R10)
    │   │   ├── layout.tsx
    │   │   ├── metrics/
    │   │   │   └── route.ts              # new (R11)
    │   │   └── page.tsx
    │   ├── components/
    │   │   ├── Home.tsx
    │   │   ├── Layout.tsx
    │   │   └── Provider.tsx              # v15-appRouter -> v16-appRouter
    │   ├── env.ts                        # BACKEND_PORT removed, LOG_FILE_PATH added
    │   ├── lib/
    │   │   └── logger.ts                 # new (R13)
    │   ├── tailwind.css
    │   └── theme.ts
    ├── tailwind.config.ts
    └── tsconfig.json

Files deleted: `apps/swole/src/main.ts`, `apps/swole/src/bootstrap.ts`, `apps/swole/src/app.module.ts`, `apps/swole/src/health/` (entire directory), `apps/swole/nest-cli.json`.

Files modified outside `apps/swole/`: `infra/monitoring/prometheus.yml` (append scrape job), `docs/prds/swole.md` (sections noted in U9).

> *This tree is a scope declaration showing the expected output shape; the implementer may adjust internal layout if implementation surfaces a better arrangement.*

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

The novel piece is the metrics route handler — every other change is mechanical config or file deletion. Sketch of the singleton pattern:

```ts
// apps/swole/src/app/metrics/route.ts -- DIRECTIONAL, not literal
import { collectDefaultMetrics, register } from 'prom-client'

// Guard against dev-mode hot reload re-executing the module
register.clear()
collectDefaultMetrics({ register })

export const dynamic = 'force-dynamic'

export async function GET() {
  const body = await register.metrics()
  return new Response(body, {
    headers: { 'Content-Type': register.contentType },
  })
}
```

Key shape decisions communicated:
- `register` is the module singleton imported from `prom-client`; no app-level wrapper.
- `collectDefaultMetrics({ register })` runs at module load, not per request.
- `register.clear()` first lets the module survive dev-mode hot reload without "metric already exists" errors. In production this clears an empty registry on the single module-load cycle — harmless.
- `dynamic = 'force-dynamic'` opts out of static caching so the metrics body reflects current process state.

---

## Implementation Units

- U1. **Deploy config — auth gate and storage mount**

**Goal:** Make `apps/swole/deploy.yml` production-safe: gate the hostname behind `forward-auth` and mount `/storage/app-data/swole:/data` so future SQLite state survives container rebuilds. Verify `deploy.dev.yml` needs no change.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `apps/swole/deploy.yml`
- Inspect (no change expected): `apps/swole/deploy.dev.yml`

**Approach:**
- Append `traefik.http.routers.swole.middlewares=forward-auth` to the existing labels block in `deploy.yml`. Middleware name is exactly `forward-auth`, no `@file` suffix (verified at `apps/token/deploy.yml:52` and `infra/proxy.yml:47-62`).
- Add a top-level `volumes:` clause: `- /storage/app-data/swole:/data`. Host path follows `apps/yoink`'s convention; container path matches the PRD's expectation that SQLite will live at `/data/swole.db`.
- **(Recommended, see SEC-001)** Block external access to `/metrics` at the Traefik layer. Add a higher-priority router that matches `Host(swole.lilnas.io) && PathPrefix(/metrics)`, attached to a `swole-metrics-deny` middleware via `traefik.http.middlewares.swole-metrics-deny.ipallowlist.sourcerange=127.0.0.1/32`. External requests to the public hostname's `/metrics` then 403; Prometheus continues to scrape `swole:8080` via the Docker network, bypassing Traefik entirely. Without this addition, any authenticated `lilnas.io` session holder can read swole's metrics at `swole.lilnas.io/metrics` — currently low-impact (only Node default metrics) but becomes a real exposure when custom business metrics land in Survivor 2/3.
- Verify `deploy.dev.yml` already has `swole.localhost` rule, no auth label, and `/source` mount — leave it unchanged.

**Patterns to follow:**
- `apps/token/deploy.yml:52` for the `forward-auth` middleware label format.
- `apps/yoink/deploy.yml` for the `/storage/app-data/<app>/<subdir>:<container-path>` volume pattern.

**Test scenarios:**
- Test expectation: none — pure compose-file edits with no runtime behavior outside of deployment. Verification is via `docker compose -f apps/swole/deploy.yml config` (validates label syntax) and manual deploy smoke-test post-merge.

**Verification:**
- `apps/swole/deploy.yml` contains the `forward-auth` middleware label and the `/storage/app-data/swole:/data` volume.
- `apps/swole/deploy.dev.yml` is byte-identical to the pre-PR state.
- `docker compose -f apps/swole/deploy.yml config` exits 0.

---

- U2. **MUI Next.js adapter bump for Next.js 16**

**Goal:** Resolve the runtime import failure in `Provider.tsx` by bumping `@mui/material-nextjs` to a release that ships the `v16-appRouter` export and switching the import path.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `apps/swole/package.json`
- Modify: `apps/swole/src/components/Provider.tsx`

**Approach:**
- Bump `@mui/material-nextjs` from `7.3.3` to `^7.3.7` (or latest stable patch at install time, pinned exactly per monorepo convention).
- Change `Provider.tsx:4` import from `@mui/material-nextjs/v15-appRouter` to `@mui/material-nextjs/v16-appRouter`.
- Run `pnpm install` at the repo root to update `pnpm-lock.yaml`.

**Patterns to follow:**
- Monorepo convention is exact-version pins (no `^` ranges) once locked. Use the highest stable `7.3.x` available on npm at install time.
- Other lilnas apps (`apps/yoink`, `apps/download`) intentionally remain on `7.3.3` with `v15-appRouter` per the brainstorm scope boundary — do not touch them.

**Test scenarios:**
- Test expectation: none — version bump verified by build success in U7 verification (Dockerfile production build must not throw a missing-export error from MUI).

**Verification:**
- `pnpm --filter @lilnas/swole type-check` passes after the import path change.
- `pnpm --filter @lilnas/swole build` (Next.js portion) does not error on `v16-appRouter` resolution.
- The dev compose at `swole.localhost` renders the page without an MUI provider hydration error in browser console.

---

- U3. **Strip NestJS process, dependencies, scripts, and Next.js rewrite**

**Goal:** Remove every artifact of the NestJS process so swole is a pure Next.js app. Delete NestJS-only source files, drop NestJS-only dependencies from `package.json`, collapse the `scripts` block to single-process commands, remove the `/api/*` rewrite from `next.config.ts`, and update `env.ts` to drop `BACKEND_PORT` and add `LOG_FILE_PATH`.

**Requirements:** R5, R6, R7, R8

**Dependencies:** None (but logically precedes U4, U5, U6 — those fill the void this unit creates)

**Files:**
- Delete: `apps/swole/src/main.ts`
- Delete: `apps/swole/src/bootstrap.ts`
- Delete: `apps/swole/src/app.module.ts`
- Delete: `apps/swole/src/health/health.module.ts`
- Delete: `apps/swole/src/health/health.controller.ts`
- Delete: `apps/swole/src/health/` (empty directory)
- Delete: `apps/swole/nest-cli.json`
- Modify: `apps/swole/package.json` (drop deps, collapse scripts)
- Modify: `apps/swole/next.config.ts` (remove `rewrites()`)
- Modify: `apps/swole/src/env.ts` (drop `BACKEND_PORT`, add `LOG_FILE_PATH`)

**Approach:**
- Drop these dependencies from `apps/swole/package.json`: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `nestjs-pino`, `nestjs-zod`, `@willsoto/nestjs-prometheus`, `pino-http`, `reflect-metadata`, `rxjs`, `source-map-support`.
- Keep: `zod` (still used for env parsing), `prom-client` (used directly by U5's metrics route), `npm-run-all` (still used by `lint` and `lint:fix`).
- Add: `pino` as a direct dependency (currently transitive via `nestjs-pino`). Pin to the same major as the root devDep (`pino@^10.0.0`); use exact-version pin matching the resolved version.
- Add: `pino-pretty` as a `devDependencies` entry (used by dev-mode transport in U4's logger; not needed in production Docker image).
- Collapse `scripts` to mirror `apps/portal/package.json`:
  - `build`: `"next build"` (drop the `run-p build:*` wrapper and `build:backend`/`build:frontend`)
  - `dev`: `"lilnas dev"` (unchanged)
  - `dev:start`: `"next dev -p 8080"` (was `run-p dev:backend dev:frontend`)
  - `start`: `"NODE_ENV=production node server.js"` (was `run-p start:*`)
  - Drop entirely: `build:backend`, `build:frontend`, `dev:backend`, `dev:frontend`, `start:backend`, `start:frontend`
  - Keep: `clean`, `lint`, `lint:eslint`, `lint:prettier`, `lint:fix`, `lint:eslint:fix`, `lint:prettier:fix`, `test`, `test:watch`, `test:cov`, `type-check`
- In `next.config.ts`, remove the entire `async rewrites()` block; keep `output: 'standalone'`.
- In `src/env.ts`, remove `BACKEND_PORT` from `EnvKeys` and add `LOG_FILE_PATH: 'LOG_FILE_PATH'`. `NODE_ENV` stays.
- The `apps/swole/README.md` stack-description update is handled in U9 (R20) so all documentation reconciliation lands in one unit.
- The `apps/swole/tsconfig.json` and `apps/swole/jest.config.js` decorator-flag cleanup (`experimentalDecorators`, `emitDecoratorMetadata`) is deferred to a separate housekeeping commit; harmless if left after this PR.

**Patterns to follow:**
- `apps/portal/package.json` scripts block as the template (lines 7-21).
- `apps/portal/next.config.ts` as the post-rewrite reference (`output: 'standalone'` only, no `rewrites()`).
- `apps/portal/src/` directory layout — no `app.module.ts`, no `bootstrap.ts`, no NestJS artifacts.

**Test scenarios:**
- Test expectation: none — destructive cleanup verified by U7's `pnpm build` succeeding (no missing-import errors), `pnpm type-check` succeeding (env.ts changes resolved), and post-removal grep finding zero `@nestjs/*` imports in `apps/swole/src/`.

**Verification:**
- `find apps/swole -name 'main.ts' -o -name 'bootstrap.ts' -o -name 'app.module.ts' -o -name 'nest-cli.json' -o -name 'dist' -type d -o -path '*src/health*'` returns empty.
- `grep -r '@nestjs/' apps/swole/src/ apps/swole/package.json` returns zero matches.
- `apps/swole/package.json` contains `pino` in `dependencies` and `pino-pretty` in `devDependencies`.
- `pnpm --filter @lilnas/swole type-check` passes (catches stale imports from deleted files).
- `pnpm install` at repo root completes without resolution errors after the dependency edits.

---

- U4. **Pino logger module with NODE_ENV branching and redact**

**Goal:** Create a direct `pino` logger that replaces `nestjs-pino`'s `LoggerModule.forRoot()`. NODE_ENV-aware (info level + JSON in production, debug level + `pino-pretty` in development), optional file destination via `LOG_FILE_PATH`, redact for auth headers.

**Requirements:** R13

**Dependencies:** U3 (NestJS removed; `pino` added as direct dep; `LOG_FILE_PATH` added to env.ts)

**Files:**
- Create: `apps/swole/src/lib/logger.ts`

**Approach:**
- Module-level logger singleton exported as `logger`.
- Use `env(EnvKeys.NODE_ENV, 'development') === 'production'` to branch.
- Production config: `{ level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie', 'authorization', 'cookie'] }` and JSON-to-stdout (pino's default — no transport). The expanded redact list covers both `pino-http`-shaped records (the `req.headers.*` paths, kept for forward-compatibility if Next.js middleware ever binds `req`) and bare-logger shapes (`headers.*` and top-level `authorization`/`cookie`). Since swole has no per-request HTTP middleware to inject `req`, the `req.headers.*` paths alone would never match a real log record — see SEC-002 / ADV-002 in the 2026-05-26 review.
- Development config: `{ level: 'debug', redact: [...] }` (same expanded redact array) plus a transport. If `LOG_FILE_PATH` is set, use the dual-target transport (one to stdout, one to file with `mkdir: true`) mirroring `apps/token/src/app.module.ts:32-39`. If unset, single `pino-pretty` transport to stdout.
- Translate token's `pinoHttp:` wrapper config to bare-pino root config — pino's `transport`, `level`, and `redact` keys sit at the root of the pino options object (not under `pinoHttp`).
- Export the configured `logger` instance directly. Callers import `{ logger } from 'src/lib/logger'` and use `logger.info(...)`, etc. No request-scoped child-logger pattern needed — there's no per-request HTTP middleware to attach one.

**Patterns to follow:**
- `apps/token/src/app.module.ts:17-53` for NODE_ENV branching shape (translate `pinoHttp.transport` → pino root `transport`).
- `apps/yoink/src/app.module.ts:24-32` for `redact: ['req.headers.authorization', 'req.headers.cookie']` content.
- Import `env` from `@lilnas/utils/env` and `EnvKeys` from `src/env` — matches the existing scaffold pattern.

**Test scenarios:**
- Test expectation: none — verification is observational. Future tests could mock `process.env.NODE_ENV` and snapshot the resolved pino options, but that's deferred to when behavior actually depends on the logger.

**Verification:**
- `apps/swole/src/lib/logger.ts` exists and exports a `pino.Logger` instance.
- Module imports resolve (`pino` direct dep, `@lilnas/utils/env`, `src/env`).
- In dev compose, running `pnpm --filter @lilnas/swole dev` produces colorized `pino-pretty` output to stdout.
- A quick `import { logger } from 'src/lib/logger'; logger.info('test')` in `app/page.tsx` (removed before commit) emits the expected shape.
- `pnpm --filter @lilnas/swole type-check` passes.

---

- U5. **Health and metrics route handlers**

**Goal:** Add Next.js App Router route handlers that replace the deleted NestJS health controller and Prometheus module. `/api/health` returns 200 with a small JSON body. `/metrics` exposes Prometheus default metrics via `prom-client` with the singleton-registry pattern.

**Requirements:** R10, R11

**Dependencies:** U3 (NestJS health/prometheus modules gone)

**Files:**
- Create: `apps/swole/src/app/api/health/route.ts`
- Create: `apps/swole/src/app/metrics/route.ts`

**Approach:**

*Health route:* mirror `apps/portal/src/app/api/health/route.ts` — a single `GET` exported async function returning `NextResponse.json({ status, timestamp, service })`. Field set can include `status: 'ok'`, `timestamp: new Date().toISOString()`, `service: 'swole'`.

*Metrics route:* see the technical design sketch above. Key points:
- Import `{ collectDefaultMetrics, register }` from `prom-client` (already a dependency).
- At module top level: `register.clear()` then `collectDefaultMetrics({ register })`. The `clear()` guard handles dev-mode hot-reload without throwing "metric already exists"; in production it clears an empty registry once.
- Export `const dynamic = 'force-dynamic'` to opt out of static caching — metrics body must reflect live process state.
- `GET` handler: `await register.metrics()` for the body, return a `Response` (not `NextResponse.json` — body is the OpenMetrics text format, not JSON) with `Content-Type: register.contentType`.
- Body length is small (Node default metrics) and changes per request; no caching headers needed beyond `dynamic = 'force-dynamic'`.

**Technical design (per-unit, directional):**

```ts
// apps/swole/src/app/api/health/route.ts -- mirrors portal pattern
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'swole',
  })
}
```

```ts
// apps/swole/src/app/metrics/route.ts -- DIRECTIONAL
import { collectDefaultMetrics, register } from 'prom-client'

register.clear()
collectDefaultMetrics({ register })

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(await register.metrics(), {
    headers: { 'Content-Type': register.contentType },
  })
}
```

**Patterns to follow:**
- `apps/portal/src/app/api/health/route.ts` for the health route shape (literally copy the structure, rename service).
- No prior `prom-client` direct-route handler exists in the monorepo — this is the first. Future Next.js-only services can reuse this exact pattern.

**Test scenarios:**
- Test expectation: none for this PR. The success criteria require manual verification via compose-up + curl. Future tests deferred until a `@lilnas/utils` helper extracts the pattern (Rule of Three).
- Recommended manual verification (during PR review): `curl http://swole.localhost/api/health` returns `200` with `{"status":"ok","timestamp":"...","service":"swole"}`; `curl http://swole.localhost/metrics` returns `200` with a `text/plain; version=0.0.4` body containing `process_cpu_user_seconds_total`, `nodejs_eventloop_lag_seconds`, and other Node default metric series.

**Verification:**
- Both files compile (`pnpm --filter @lilnas/swole type-check` passes).
- In dev compose, `curl http://swole.localhost/api/health` returns JSON with `status: 'ok'`.
- In dev compose, `curl http://swole.localhost/metrics` returns Prometheus text format with default Node metrics.
- Module-top-level `collectDefaultMetrics` does not throw on repeat module loads under `next dev` hot reload (the `register.clear()` guard).
- Hitting `/metrics` twice in succession returns updated counters (verifies the `force-dynamic` opt-out worked).

---

- U6. **Production Dockerfile — Next.js standalone**

**Goal:** Replace the multi-stage NestJS+Next.js Dockerfile with a single-process Next.js standalone build mirroring `apps/portal/Dockerfile`.

**Requirements:** R9

**Dependencies:** U3 (NestJS deletion complete), U4 (logger in place), U5 (route handlers in place)

**Files:**
- Replace: `apps/swole/Dockerfile`

**Approach:**
- Copy `apps/portal/Dockerfile` literally and swap every occurrence of `portal` for `swole`.
- The three stages stay the same: `lilnas-monorepo-builder` (deps) → `deps` (builder) → `lilnas-nextjs-runtime` (runtime).
- The `COPY apps/portal/package.json apps/portal/` line becomes `COPY apps/swole/package.json apps/swole/`.
- The `RUN pnpm build --filter=@lilnas/portal` becomes `RUN pnpm build --filter=@lilnas/swole`.
- The `RUN pnpm --filter=portal --prod deploy /app` becomes `RUN pnpm --filter=swole --prod deploy /app`.
- The standalone-server copy line becomes `RUN cp /source/apps/swole/.next/standalone/apps/swole/server.js /app/server.js`.
- The public-dir conditional becomes `if [ -d /source/apps/swole/public ]; then cp -r /source/apps/swole/public /app/.next/standalone/; fi`.
- The `ENTRYPOINT ["pnpm", "start"]` is unchanged (and now invokes `start: "NODE_ENV=production node server.js"` per U3).
- **(See SEC-003)** Add a `USER node` directive to the runtime stage after the `COPY --from=builder /app /app` line (or use `COPY --chown=node:node /app /app` and then `USER node`). The `node:slim` base image (via `lilnas-nextjs-runtime` → `lilnas-node-runtime` → `lilnas-node-base`) ships a non-root `node` user at UID 1000. Portal and the lilnas base images currently run as root; swole improves on that pattern at the app layer rather than amending shared base images. If `node` cannot write to `/app` after the chown, the implementer adjusts the COPY ownership before the USER switch.
- Do not add a `HEALTHCHECK` directive (portal does not have one; this PR follows portal's pattern; add later if production observability surfaces a need).

**Patterns to follow:**
- `apps/portal/Dockerfile` lines 1-59 — the entire file, swapping `portal` → `swole`.

**Test scenarios:**
- Test expectation: none — Docker build success is the integration check. Future tests could be a CI-level `docker compose -f apps/swole/deploy.yml build` step, but the existing CI already builds images per app.

**Verification:**
- `docker compose -f apps/swole/deploy.yml build` exits 0.
- The resulting image has `/app/server.js` and no NestJS artifacts (`docker run --rm <image> ls /app` shows no `dist/main.js`).
- `docker compose -f apps/swole/deploy.yml up -d` produces a healthy container responding on port 8080.
- Container responds 200 on `/api/health` and emits Prometheus default metrics on `/metrics`.
- `docker compose -f apps/swole/deploy.yml exec swole id` reports `uid=1000(node)` — confirms the process is not running as root.

---

- U7. **Prometheus scrape config for swole**

**Goal:** Add a `swole` scrape job to `infra/monitoring/prometheus.yml` so Grafana sees swole metrics after the first production deploy.

**Requirements:** R12

**Dependencies:** U5 (metrics endpoint exists at `/metrics`)

**Files:**
- Modify: `infra/monitoring/prometheus.yml`

**Approach:**
- Append a new scrape job at the end of `scrape_configs:`:

      - job_name: swole
        metrics_path: /metrics
        static_configs:
          - targets: ['swole:8080']

- `swole:8080` is correct (not `:8081`) — swole is now Next.js-only and the only port is 8080. Precedent: `equations:8080`, `me-token-tracker:8080`.
- Preserve existing global config (`scrape_interval: 15s`, `evaluation_interval: 15s`) and all other jobs.

**Patterns to follow:**
- Adjacent entries in `infra/monitoring/prometheus.yml:42-55` (`me-token-tracker`, `yoink`, `token`) for the YAML shape.

**Test scenarios:**
- Test expectation: none — verification is via Prometheus targets page post-deploy.

**Verification:**
- The new `swole` job appears in the rendered config (`yq '.scrape_configs[] | select(.job_name == "swole")' infra/monitoring/prometheus.yml` returns one entry).
- After production deploy, `https://prometheus.lilnas.io/targets` shows the `swole` target as `UP`.
- A test PromQL query like `up{job="swole"}` returns `1` in Grafana Explore.

---

- U8. **ADR-001 — Data Flow Direction**

**Goal:** Write `apps/swole/docs/adr/001-data-flow.md` documenting the all-Next.js data-flow decision so future swole PRs do not re-litigate it. Records the chosen pattern, the divergence from `apps/yoink`'s actual pattern with reasons, and the rejected alternatives with one-line reasons.

**Requirements:** R14, R15, R16

**Dependencies:** None

**Files:**
- Create: `apps/swole/docs/adr/` (directory)
- Create: `apps/swole/docs/adr/001-data-flow.md`

**Approach:**
- Use the Michael Nygard ADR template: Title, Status, Context, Decision, Consequences, Alternatives Considered. Sets the lilnas convention for future ADRs.
- **Status:** `Accepted` (date 2026-05-26).
- **Context:** swole is a small workout tracker app — N=1 user, no third-party API integrations to host, no scheduled jobs, no WebSocket pressure, no auth surface (forward-auth handles auth at Traefik). The scaffold initially included a NestJS backend matching `apps/yoink`'s shape, but no domain concern motivates that complexity.
- **Decision:** Drizzle is imported directly in Next.js server components for reads and in server actions for mutations. React 19's `useOptimistic` handles optimistic UI on the active-session runner. No NestJS REST layer. No React Query / TanStack Query.
- **Consequences:**
  - swole's data-flow path is shorter than yoink's (no Next.js → NestJS → DB hop).
  - Server actions become the single mutation entry point — easier to reason about transactions.
  - No internal HTTP authentication concern (yoink passes the `auth-token` cookie via `api.server.ts`; swole doesn't need that layer).
  - If swole ever grows scheduled jobs, third-party API integrations, or real-time features, reintroducing a NestJS backend is a non-trivial migration. The ADR accepts that risk because the brainstorm's product scope is bounded and the cost of premature backend infrastructure is real.
  - swole is the first Next.js-only lilnas service; if a second appears, a `@lilnas/utils` shared module for the metrics+logger pattern becomes worth extracting (Rule of Three).
- **Alternatives Considered:**
  - **(a) Token-style REST + React Query throughout** — consistent with the rest of the monorepo but unnecessary indirection for N=1 user with no real-time pressure.
  - **(b) Hybrid: yoink-style for routine CRUD, token-style for the session runner** — two patterns to maintain for no concrete win; doubles the surface area future contributors must learn.
  - **(c) Punt the decision until the active-session runner exists** — "TBD" architecture decisions rot. The ADR is the right place to commit now; reversing later is small if reality forces it.
- Note the divergence from `apps/yoink`'s actual pattern (Drizzle in NestJS, called from Next.js via `apps/yoink/src/media/api.server.ts`) and the reasons: yoink hosts third-party API integrations (Radarr, Sonarr) and an auth surface; swole has neither.

**Patterns to follow:**
- No existing ADRs in the monorepo — this PR sets the convention. Use Michael Nygard's shape (the most widely-recognized format), so future ADRs in any lilnas app can adopt it.
- ADR file naming: `NNN-<kebab-title>.md` with zero-padded sequence (matches the brainstorm-specified `001-data-flow.md`).

**Test scenarios:**
- Test expectation: none — pure documentation.

**Verification:**
- `apps/swole/docs/adr/001-data-flow.md` exists.
- The file contains all three rejected alternatives with one-line reasons.
- The file explicitly mentions the divergence from `apps/yoink/src/media/api.server.ts` and the reason (no third-party API integrations, no auth surface).
- A reviewer who knows nothing about swole can read this ADR and explain the data-flow pattern in one sentence.

---

- U9. **PRD and README reconciliation — tech stack, file structure, data flow**

**Goal:** Update `docs/prds/swole.md` to describe the actual scaffold and align with ADR-001. Update `apps/swole/README.md` to remove the stale NestJS stack reference. Only sections that contradict the scaffold or ADR-001 are touched; the rest of the PRD is left untouched.

**Requirements:** R17, R18, R19, R20

**Dependencies:** U8 (ADR-001 exists and is the source of truth for data-flow language)

**Files:**
- Modify: `docs/prds/swole.md` (specific line ranges enumerated below)
- Modify: `apps/swole/README.md` (replace "NestJS 11 (SWC builder)" stack reference with "Next.js 16 + React 19 + MUI 7 + Tailwind v4")

**Approach:**
- **Line 9 (Context section):** Remove the phrase "small NestJS backend" or rewrite to reflect Next.js-only architecture. Keep the rest of the Context paragraph intact.
- **Lines 143-200 (Tech Stack & Architecture section, full rewrite per R17 + R18):**
  - Replace the frontend bullet with: Next.js 16 App Router + React 19 + MUI 7 + Tailwind v4.
  - Remove the backend bullet entirely OR rewrite it as "Data layer: SQLite via Drizzle, imported directly in server components (reads) and server actions (mutations). See [ADR-001](apps/swole/docs/adr/001-data-flow.md)."
  - Fix the deploy bullet's middleware name: `forward-auth@file` → `forward-auth`.
  - Replace the ASCII file tree with the flat `src/` layout matching the actual scaffold (drop the `backend/` + `frontend/` + `shared/` split). Reference the Output Structure block of this plan for the canonical shape.
- **Lines 202-208 (Key files to reuse, full rewrite per R17):** Repoint from `apps/macros` to `apps/yoink` (for the Provider.tsx pattern, MUI integration, Drizzle conventions) and `apps/token` (for the NODE_ENV-aware logger pattern at `apps/token/src/app.module.ts:17-53`).
- **Data flow language anywhere in the PRD that mentions React Query, jotai, or NestJS REST (per R19):** Remove or rewrite to reference ADR-001's Drizzle-in-server-components + `useOptimistic` pattern.
- **Sections left untouched:** Goals, Non-goals, Glossary, User Flows F1-F5, Exercise types, Data model, Out of scope / future ideas, Verification, Resolved decisions.
- **`apps/swole/README.md` (R20):** Replace the stack-description line that currently reads "NestJS 11 (SWC builder)" with "Next.js 16 + React 19 + MUI 7 + Tailwind v4". Keep every other line of the README intact.

**Patterns to follow:**
- Preserve the PRD's existing heading depth, bullet style, and section order. The goal is targeted edits, not a wholesale rewrite.

**Test scenarios:**
- Test expectation: none — pure documentation.

**Verification:**
- `grep -i 'Vite\|Radix\|jotai\|React Query\|TanStack' docs/prds/swole.md` returns zero hits (or only inside the "Resolved decisions" section explaining why they were rejected).
- `grep 'forward-auth@file' docs/prds/swole.md` returns zero hits.
- `grep -i 'NestJS' docs/prds/swole.md` returns zero hits (or only in a historical note).
- `grep -i 'NestJS' apps/swole/README.md` returns zero hits.
- The "Key files to reuse" section names `apps/yoink` and `apps/token` and does not name `apps/macros`.
- The file structure description in the PRD matches the Output Structure block of this plan.
- A reviewer reading the updated PRD can answer "what stack is swole built on?" without consulting other files.

---

## System-Wide Impact

- **Interaction graph:**
  - `infra/monitoring/prometheus.yml` is consumed by the production Prometheus container; the new `swole` scrape job activates the moment Prometheus reloads its config (typically on next compose-up of the monitoring stack).
  - `infra/proxy.yml`'s `forward-auth` middleware is referenced by swole's new label; no edits to `infra/proxy.yml` itself.
  - `lilnas-nextjs-runtime` base image is consumed by the new Dockerfile; no edits to base images.
  - `packages/cli/src/commands/dev.ts` (`lilnas dev`) detects swole's absence of `drizzle.config.ts` and runs `pnpm run dev:start` directly — pre-existing no-op behavior, no edits needed.
- **Error propagation:**
  - Prometheus scrape failures (port unreachable, `/metrics` returns non-200) appear as `up{job="swole"}=0` and alert per the global Prometheus rules.
  - forward-auth failures (auth service down) propagate as 502/503 from Traefik; swole itself is uninvolved.
  - `/api/health` failures (logger import error, missing module) would be visible via `curl` during deploy smoke-test.
- **State lifecycle risks:**
  - The new `/storage/app-data/swole:/data` mount is created empty on first deploy; SQLite files added in Survivor 3 will accumulate there. No risk in this PR (volume is empty).
  - Prometheus's `prom-client` default registry persists across requests in a single Node process; restarting the swole container resets all metric counters (expected behavior).
- **API surface parity:**
  - `swole.lilnas.io/api/health` and `swole.lilnas.io/metrics` are new public surfaces (gated by `forward-auth`).
  - No internal callers exist yet (no other lilnas app consumes swole's API). Future internal traffic should use the Docker network address `swole:8080`.
- **Integration coverage:**
  - The full integration path (Traefik → forward-auth → swole container → Next.js standalone → route handler) is exercised only by manual `curl` during the brainstorm's success-criteria verification. No automated integration test in this PR.
  - The Prometheus → swole scrape path is exercised after the first production deploy by observing the Prometheus targets page.
- **Unchanged invariants:**
  - Other lilnas apps' `deploy.yml`, `Dockerfile`, `package.json`, and Prometheus scrape configs are not modified. Specifically, `apps/yoink` and `apps/download` remain on `@mui/material-nextjs@7.3.3` with `v15-appRouter` per the brainstorm scope boundary — do not "consistency-clean" them.
  - `infra/proxy.yml`'s `forward-auth` middleware definition is unchanged.
  - The `lilnas-monorepo-builder` and `lilnas-nextjs-runtime` base images are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `prom-client`'s default registry throws on re-registration during `next dev` hot reload, killing the dev server. | U5's `register.clear()` guard before `collectDefaultMetrics({ register })`. In production (single module load), this clears an empty registry — harmless. |
| `@mui/material-nextjs/v16-appRouter` is not yet published as `^7.3.7` when the PR is opened. | Brainstorm cites the merge date 2025-10-30 — package has been available for ~7 months as of 2026-05-26. Implementer verifies on `npm view @mui/material-nextjs versions` before committing the bump; if `7.3.7+` is somehow not published, the PR pauses and the brainstorm is updated. |
| The new scrape job points to `swole:8080`, but the existing Docker network does not include the production Prometheus container in the same network as swole. | Verify during production deploy that the `monitoring` and main networks share the `swole` service. If not, add the `monitoring` network to `apps/swole/deploy.yml`'s service block. (Out of scope here — surfaces during the deploy step.) |
| Stale `apps/swole/dist/` contents from the pre-PR NestJS build might confuse future debugging. | U6's Dockerfile mirrors `apps/portal/Dockerfile`, which copies only `.next/` (not `dist/`) — the directory is ignored by the Docker build regardless of whether it exists locally. Implementer may run `pnpm clean` as a local housekeeping step (out of scope for the PR diff). |
| Removing `BACKEND_PORT` from `env.ts` breaks any code that references it. | The brainstorm verified zero domain code exists. `pnpm --filter @lilnas/swole type-check` will surface any orphaned reference (deleted `bootstrap.ts` is the only known consumer). |
| `forward-auth` blocks Prometheus from scraping `/metrics` at the public URL, silently producing no metrics in Grafana. | Verified mitigation: Prometheus scrapes via the internal Docker network at `swole:8080`, bypassing Traefik entirely. No bypass route needed. (See Key Technical Decisions.) |
| The PRD rewrite scope creeps and accidentally touches sections the brainstorm intended to leave alone (Goals, User flows, Verification). | U9 enumerates the exact line ranges and sections in scope. Implementer is instructed not to "consistency-clean" untouched sections. |
| The new health/metrics endpoints land behind `forward-auth`, so external `curl` from a developer machine returns 302 to the auth flow. | Expected behavior — external testing requires an authenticated session cookie. For dev verification, hit `http://swole.localhost/api/health` and `http://swole.localhost/metrics` (no auth on `deploy.dev.yml`). For production verification, exec into a peer container and `curl swole:8080/api/health`. |

---

## Documentation / Operational Notes

- **ADR convention seeded.** This PR introduces the lilnas monorepo's first ADR (`apps/swole/docs/adr/001-data-flow.md`). Future ADRs in any lilnas app should mirror the Michael Nygard shape used here.
- **Prometheus scrape config requires Prometheus to reload its config.** After this PR is deployed in production, `docker compose exec prometheus kill -HUP 1` (or a full Prometheus restart) is needed for the new `swole` job to activate. Document this in the deploy notes (out of scope for this PR's files, but worth flagging to the deployer).
- **Compounds for follow-up after this PR lands** (not blocking, just worth capturing):
  - First-of-kind prom-client direct usage in Next.js App Router — candidate for `docs/solutions/` once a second Next.js-only service appears.
  - First-of-kind direct `pino` config (no `nestjs-pino`) — same candidate.
  - The Dockerfile + scripts pattern for a Next.js-only lilnas service is now established; extract to `@lilnas/utils` if a third such service appears (Rule of Three).
- **The `lilnas dev` CLI may need a SQLite detection path when Survivor 3 lands.** Currently auto-detects `apps/<app>/drizzle.config.ts` and spins up a Docker postgres. swole will use SQLite, so the CLI either needs SQLite branching or swole should bypass the wrapper. Out of scope for this PR but noted for Survivor 3 planning.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-26-swole-infra-foundation-requirements.md](../brainstorms/2026-05-26-swole-infra-foundation-requirements.md)
- **Related ideation:** `docs/ideation/2026-05-26-swole-next-build-chunk-ideation.md`
- **Related scaffold commit:** `fe16ff1` (`feat(swole): scaffold workout app skeleton`)
- **Related PR (upstream MUI):** [mui/material-ui#47134](https://github.com/mui/material-ui/pull/47134) — adds `v16-appRouter` export
- **In-tree references (read-only):**
  - `apps/portal/Dockerfile` — Dockerfile template
  - `apps/portal/package.json` — scripts template
  - `apps/portal/src/app/api/health/route.ts` — health route precedent
  - `apps/token/src/app.module.ts:17-53` — logger NODE_ENV branching
  - `apps/yoink/src/app.module.ts:24-32` — logger redact paths
  - `apps/yoink/deploy.yml` — volume convention
  - `apps/token/deploy.yml` — forward-auth label format and public-router pattern (reference only; swole does not need the public router)
  - `infra/proxy.yml:47-62` — forward-auth middleware definition
  - `infra/monitoring/prometheus.yml` — scrape config shape
  - `packages/cli/src/commands/dev.ts:24-160` — `lilnas dev` behavior

---

## Deferred / Open Questions

### From 2026-05-26 review

- **Plan's stated runtime-failure premise for MUI bump is unsupported by precedent** — Problem Frame (P2, adversarial, confidence 75)

  The plan frames R4 as fixing a runtime crash, when in fact the existing scaffold's `v15-appRouter` import would run fine on Next.js 16.2.2 (proven by `apps/yoink` at 16.1.6 using identical import + MUI 7.3.3). The actual motivation to bump to ^7.3.7 is forward-compatibility / API hardening, not preventing a crash. Misleading framing biases reviewers toward urgency and shields the change from a legitimate scope challenge: "stay on 7.3.3 + `v15-appRouter` like `yoink` and `download`, so all three MUI consumers stay aligned on a single version, deferring the bump until something concrete breaks." Worth deciding before merging whether R4 stays in this PR or moves to a separate MUI 16-appRouter migration alongside yoink and download.

  <!-- dedup-key: section="problem frame" title="plans stated runtimefailure premise for mui bump is unsupported by precedent" evidence="Plan line 23 Problem Frame 3 MUI Next.js adapter import will fail at runtime mui/material-nextjs@7.3.3 has no v16-appRouter export" -->

- **`register.clear()` in the metrics route handler is a future booby-trap for custom counters** — Implementation Unit 5 (P2, adversarial, confidence 75)

  When swole's data layer lands (Survivor 3) or any domain metric is added later (e.g., `swole_sessions_completed_total` following the `apps/yoink/src/yoink-metrics.service.ts` pattern), those custom counters will register against the shared `prom-client` default register at module load via separate imports. In Next.js standalone production, the `/metrics` route handler module evaluates lazily on first request. If a custom-metric module has loaded at server boot (likely — anything that imports a metrics service triggers it) and the first `/metrics` scrape happens after that custom registration (very likely, since Prometheus scrapes every 15s from boot), `register.clear()` inside the route handler will wipe those custom registrations on that first scrape, then re-register only defaults. Subsequent scrapes return only defaults; custom counters silently disappear. The plan's "harmless" framing depends on the assumption that no other module ever registers against the default register — an assumption ADR-001's own Consequences anticipates being violated (Rule of Three extraction). Options the user weighs: (a) gate `register.clear()` behind `if (process.env.NODE_ENV !== 'production')`, (b) move metrics initialization to `instrumentation.ts` (Next.js's standard for module-load-once), (c) add an inline warning comment for future maintainers, or (d) accept the trap and address when the second metric source lands.

  <!-- dedup-key: section="implementation unit 5" title="registerclear in the metrics route handler is a future boobytrap for custom counters" evidence="Plan line 192193 technical sketch registerclear collectDefaultMetrics register at module top level of metrics route" -->

- **Plan contradicts itself on Prometheus network membership** — Key Technical Decisions / Risks (P3, adversarial, confidence 75)

  The plan presents the scrape-network claim as `Resolved` in two sections (Key Technical Decisions and the Open Questions entry for `forward-auth` exclusion) AND as `unverified pending deploy` in the Risks table ("Verify during production deploy that the monitoring and main networks share the swole service. If not, add the monitoring network to `apps/swole/deploy.yml`'s service block. (Out of scope here — surfaces during the deploy step.)"). The codebase actually proves the `Resolved` side (no service declares `networks:` anywhere, so docker-compose creates a single default project network shared by every `include:`d service). But a reviewer reading only Key Decisions misses the Risks hedge, and a reviewer reading only Risks misses the codebase evidence. Future debuggers see two opposing statements and waste cycles re-investigating an already-provable question. Pick one: (a) downgrade Key Decisions to match Risks and add a pre-merge verification command (`docker compose config | grep network` + manual `curl` from a peer container), OR (b) delete the Risks-row hedge and cite the codebase evidence inline.

  <!-- dedup-key: section="key technical decisions" title="prometheus scrapes via docker network is asserted resolved and flagged outofscopeverified" evidence="Plan line 102 Key Decisions Prometheus scrapes from inside the Docker network at swole8080 never traversing Traefik" -->
