# ADR-001 — Data Flow Direction

## Status

Accepted — 2026-05-26.

## Context

`swole` is a personal-use workout tracker: single user (N=1), no third-party
API integrations to host, no scheduled jobs, no WebSocket pressure, no auth
surface to own (forward-auth handles auth at Traefik before requests reach
the container). The initial scaffold included a NestJS backend that mirrored
`apps/yoink`'s shape, but no domain concern in the brainstorm motivates that
complexity, and the cost of carrying a second process — its build pipeline,
its scrape target, its logger config, its REST contract — is real.

The other Next.js+NestJS apps in the monorepo justify the hybrid layout with
something concrete:

- `apps/yoink` hosts Radarr/Sonarr integrations and an auth-token surface
  passed between Next.js and NestJS via `apps/yoink/src/media/api.server.ts`.
- `apps/token` hosts a public `/public/*` validation API and CRUD endpoints
  consumed by external services.
- `apps/tdr-bot` runs a Discord client and AI workflow graph that need to
  stay alive between HTTP requests.
- `apps/download` runs `yt-dlp` and `ffmpeg` jobs that outlast any single
  request.

`swole` has none of those. Its writes come exclusively from the user's own
browser session, and its reads come from the same place. There is no second
network actor.

This is also the moment the data-flow direction is cheapest to fix: zero
domain code exists yet, so the choice is between two greenfield shapes, not
between rewriting working code.

## Decision

`swole` uses Next.js for the entire stack:

- **Reads.** Drizzle is imported directly in Next.js server components. The
  database client lives at `apps/swole/src/db/client.ts` (Survivor 3); pages
  call `db.query.*` synchronously inside their server component.
- **Writes.** Drizzle is imported in Next.js server actions
  (`'use server'`). Action functions are the single mutation entry point and
  return discriminated-union results that the client renders.
- **Optimistic UI.** React 19's `useOptimistic` hook drives the active-session
  runner — the user taps "Increment" / "Stay" / "Decrement" and the UI moves
  before the server action settles.
- **No NestJS REST layer.** No internal HTTP boundary between Next.js and the
  database.
- **No React Query / TanStack Query.** Server components handle cache
  invalidation via `revalidatePath` / `revalidateTag` after server actions
  mutate state.

The database is SQLite via `better-sqlite3` on a single volume
(`/storage/app-data/swole:/data`); concurrency is the browser tab, not a
fleet of workers.

## Consequences

- **Shorter path.** Data flows browser → server component → Drizzle → SQLite
  with no Next.js → NestJS → Drizzle hop. One process, one log stream, one
  scrape target.
- **Server actions as the transactional boundary.** All mutations originate
  in `'use server'` functions, so transaction scope and error handling live
  in one layer instead of being split between an HTTP controller and a
  service class.
- **No internal HTTP authentication concern.** `yoink` passes the
  `auth-token` cookie via `apps/yoink/src/media/api.server.ts` because the
  NestJS layer has its own auth surface. `swole` has no internal HTTP, so
  there is nothing to authenticate beyond what forward-auth at Traefik
  already does.
- **Reintroducing NestJS becomes a non-trivial migration if requirements
  change.** If `swole` ever grows scheduled jobs (e.g., a weekly
  progression-rollup task), third-party API integrations (e.g., importing
  data from another app), or real-time features (e.g., live spotter
  notifications), splitting the database access into a separate NestJS
  process is real work — extracting the Drizzle layer, moving server actions
  to REST controllers, threading auth between the two. The ADR accepts that
  risk because the product scope in the brainstorm is bounded and the cost
  of premature backend infrastructure is also real.
- **Divergence from `apps/yoink`'s actual pattern.** `yoink` runs Drizzle
  inside NestJS and consumes it from Next.js through
  `apps/yoink/src/media/api.server.ts`. `swole` deliberately collapses that
  layer because `yoink`'s motivation — hosting Radarr/Sonarr API
  integrations and an auth-token surface — does not apply here. Future
  contributors who pattern-match on `yoink` will find the layout
  inconsistent and should read this ADR first.
- **First Next.js-only lilnas service.** If a second appears, a
  `@lilnas/utils` shared module for the metrics+logger pattern and a shared
  Drizzle-in-server-components helper become worth extracting (Rule of
  Three).

## Alternatives Considered

- **(a) Token-style REST + React Query throughout.** Consistent with the rest
  of the monorepo, but unnecessary indirection for N=1 user with no
  real-time pressure and no second network actor.
- **(b) Hybrid: yoink-style for routine CRUD, token-style for the session
  runner.** Two patterns to maintain for no concrete win, and doubles the
  surface area future contributors must learn.
- **(c) Punt the decision until the active-session runner exists.** "TBD"
  architecture decisions rot — by the time the session runner lands,
  scaffolding will have ossified around whichever default was chosen by
  accident. The ADR is the right place to commit now; reversing later is
  small if reality forces it.
