---
date: 2026-07-03
topic: tdr-code-structured-logging
---

# tdr-code Structured Logging Standardization

## Problem Frame

tdr-code's logging **plumbing** is already standardized (commit `5c04950`): three
streams (`backend`, `frontend-server`, `frontend-browser`) resolved through
`apps/tdr-code/src/logging/log-paths.ts`, shared redaction
(`REDACT_PATHS`/`redactionCensor` in `apps/tdr-code/src/logger.ts`), and a
browser-telemetry ingestion pipeline. What is **not** standardized is the
*call-site convention*: message text is a free-for-all (capitalized sentences,
lowercase fragments, `namespace:`-prefixed strings, ad-hoc event constants),
frontend event slugs are snake_case while errors log raw `error.message`, and
the backend runs two logger styles (`PinoLogger` object-first vs a handful of
non-DI `@nestjs/common` `Logger` files that can only emit interpolated strings).

The result: logs cannot be reliably queried. There is no stable field to filter
or alert on, so every new log line is a fresh judgment call and Loki/grep
queries are unreliable — worst of all in the auth/crypto files, which emit
exactly the events an operator would want to alert on. This work defines one
convention, encodes it as a typed registry, and fixes the deviations.

---

## Actors

The convention serves three distinct log *consumers*, and the event+msg duality
exists precisely because they want different things:

- A1. Developer (dev mode): tails the pino-pretty console + `backend.dev.log`
  while building; reads the prose `msg`.
- A2. Operator (prod): queries `backend.prod.log` / `frontend-browser.prod.log`
  (and Loki, if ingested) filtering by `event`; needs stable, low-cardinality
  slugs, not free-text.
- A3. Browser telemetry pipeline: client code emits events →
  `POST /api/logs/browser` → `frontend-browser` log; must remain fire-and-forget
  and never affect the page.

---

## Requirements

**Record shape & levels**
- R1. Every log record carries a structured `event` field drawn from the typed
  registry **plus** a free-text human `msg`. `event` is the low-cardinality,
  machine-queryable slug; `msg` is prose for a human reading the stream.
- R2. Event slugs are kebab-case (`session-teardown-failed`, `auth-denied`,
  `page-view`).
- R3. `event` is **required** on `info`/`warn`/`error`/`fatal` lines (the lines
  operators query and alert on) and **optional** on `debug` (dev-only tracing,
  dropped at the prod `info` threshold), which may remain interpolated free-text.
  *(Proposed — see Outstanding Questions.)*
- R4. The error object is always logged under the key `err` (never `error`/`e`).
  Backend already complies (34/34 uses); this ratifies it as the rule and
  extends it to the frontend, where errors currently land in the `msg` slot.
- R5. Level semantics are documented so the choice is not per-author guesswork:

  | Level | When | Example event |
  |---|---|---|
  | `debug` | Dev-only tracing; dropped in prod | `permission-auto-resolved` |
  | `info` | Lifecycle milestones + audit of state-changing successes | `prompt-received`, `mutation-success` |
  | `warn` | Recoverable / degraded; handled but notable | `auth-denied`, `reconcile-mismatch` |
  | `error` | An operation failed and needs attention | `session-insert-failed`, `writer-fault` |
  | `fatal` | Process-ending only | `bot-spawn-fatal` |

**Event registry**
- R6. A single, plane-neutral registry module (zero Nest/React imports,
  following `log-paths.ts`'s discipline) exports the full set of event slugs and
  a `LogEvent` union type. All three streams import it. Call sites reference
  registry values, so a typo or unregistered slug fails type-check; adding a log
  means adding its slug.
- R7. The registry is organized into domain-prefixed sections (`auth-`,
  `session-`, `reconcile-`, `git-identity-`, `mutation-`, `page-`, …) so related
  events group by prefix.
- R8. Existing ad-hoc event strings are folded into the registry as kebab-case:
  `auth_denied` (`auth.guard.ts`) → `auth-denied`; the seven frontend snake_case
  slugs (`page_view`, `button_click`, `mutation_success`, `mutation_error`,
  `query_error`, `reconcile_result`, `reconcile_mismatch`) → kebab equivalents.

**Backend logger unification**
- R9. The ~5 non-DI files using `@nestjs/common` `Logger` (`agent/acp-client.ts`,
  `crypto/identity-resolution.ts`, `discord/image-attachments.ts`,
  `auth/guild-gate.ts`, `auth/auth.ts` — 17 call sites) migrate to a shared
  module-level pino logger that writes the same `backend.<env>.log` sink and
  reuses `REDACT_PATHS`/`redactionCensor`, mirroring the existing
  `logging/frontend-server-logger.ts`. They gain the object-first API and emit
  structured `event` fields; the "interpolated strings on purpose" header
  comments are replaced with the new rationale.
- R10. DI `PinoLogger` `info`+ call sites (~90) are updated to carry an `event`
  field. Where a message is already a de-facto event (e.g. `AUTH_DENIED_EVENT`
  passed as the msg), it becomes the structured `event` with a human `msg`.
- R11. The migration must not weaken secret hygiene: every migrated/updated
  call-site shape stays covered by the redact paths, or the paths are extended
  for any new shape (per `frontend-server-logger.ts`'s existing root-anchoring
  caveat). This is load-bearing — the migrated files include the SSH-key and
  auth paths.

**Frontend telemetry**
- R12. `logEvent` / `logToServer` carry a typed `event: LogEvent` and a human
  `msg`, while preserving browser-logger.ts's fire-and-forget + `keepalive` +
  self-error-swallowing contract (never redirect on 401, never throw).
- R13. The browser ingestion DTO (`logging/browser-logs.dto.ts`) gains a
  validated `event` field; `BrowserLogsService` writes it as a structured field.
  The React Query cache chokepoint (query/mutation error+success routing with
  per-key dedup) keeps working, now emitting typed events.

**Context vocabulary & documentation**
- R14. A documented set of common context keys (camelCase): `err`, `channelId`,
  `userId`, `discordUserId`, `sessionId`, `path`, plus the pino base `process`.
  Only `event` is type-enforced; context keys are conventional, not typed.
- R15. A `docs/solutions/` pattern doc captures the whole convention (record
  shape, levels table, registry usage, context-key vocabulary, which logger to
  use where) so it guides new code beyond this change. The typed registry is the
  compile-time enforcement floor; an ESLint rule that flags `info`+ log calls
  missing an `event` is desirable but deferred (cost assessed in planning).

---

## Acceptance Examples

- AE1. **Covers R1, R4, R10.** Given a session-row insert fails, when logged, the
  line is `logger.error({ event: 'session-insert-failed', err, channelId },
  'Session-row insert failed')` and an operator can filter the stream on
  `event = session-insert-failed`.
- AE2. **Covers R9, R11.** Given `guild-gate.ts` rejects a user, when logged via
  the new module-level pino logger, the line carries `{ event: 'guild-denied', …
  }` as structured fields *and* the cookie/auth/SSH-key redact paths still apply.
- AE3. **Covers R3.** Given `acp-client.ts`'s per-permission-request trace at
  `debug`, it may remain an interpolated string with no registry event and is
  dropped at the prod `info` threshold — no registry entry required.
- AE4. **Covers R8, R12, R13.** Given a tracked element is clicked,
  `logEvent('button-click', { id })` delivers `{ event: 'button-click', … }` to
  the `frontend-browser` log; if the click coincides with a page unload, the
  `keepalive` request still delivers.

---

## Success Criteria

- **Human outcome:** an operator can filter any of the three streams by a stable
  `event` and get every occurrence of that event; a developer tailing dev logs
  still reads prose `msg`. Auth/SSH-key redaction is provably unchanged after the
  non-DI migration (existing redaction specs still pass).
- **Handoff quality:** a planner has exact call-site counts (17 non-DI, ~90 DI
  `info`+, ~13 frontend), the seed list of slugs to migrate, the registry
  location pattern, and the level/context-key vocabulary — nothing about the
  convention itself needs to be invented during planning.

---

## Scope Boundaries

- tdr-code only — not standardizing logging across other lilnas apps.
- Not redesigning the log transport/sinks/redaction built in `5c04950` (files
  under `/tmp/tdr-code`, dual dev/prod pino targets) — only the call-site
  convention and the non-DI logger unification.
- Not building metrics/alerting off events. Events *could* later feed
  Prometheus/Loki alerts, but that pipeline is out of scope here.
- Not adding or verifying Loki ingestion of tdr-code's `/tmp` log files (see
  Assumptions) — files are treated as the query surface for this work.
- Not rewriting historical log data; the snake_case → kebab-case rename creates a
  cutover point in existing browser-log history, which is acceptable this early.
- `debug` lines are not required to carry registry events (per R3).

---

## Key Decisions

- D1. **`event` (typed) + `msg` (free text) shape.** Query on `event`, read
  `msg`. Directly serves the two log consumers (A2 wants slugs, A1 wants prose).
- D2. **kebab-case slugs.**
- D3. **Single plane-neutral typed registry** over per-plane registries: one
  place to see every event the system can emit, trivial cross-plane correlation,
  negligible browser-bundle cost (string literals), and the plane-neutral import
  precedent already exists in `log-paths.ts`.
- D4. **Migrate non-DI files to a module-level pino logger** over
  prefix-embedding the event or exempting them: it is the only option that puts
  a real, filterable `event` field on the security-critical auth/crypto logs,
  and it has a working precedent in `frontend-server-logger.ts`.
- D5. *(Proposed)* **`event` required on `info`+, optional on `debug`.** Keeps
  every queryable line covered while dropping ~25 low-value debug sites from the
  churn and the registry.

---

## Dependencies / Assumptions

- The module-level pino logger writing the shared `backend.<env>.log`
  concurrently with pino-http's DI logger is safe under the same O_APPEND
  atomic-append argument already relied on for `main` + `bot` sharing that file
  (`logger.ts` header). *(Established, not new.)*
- Migrating the non-DI files off `@nestjs/common` `Logger` means they no longer
  honor a future `app.useLogger(...)` reconfiguration — acceptable, since they
  write the same sink directly.
- Assumes `/tmp/tdr-code/*.log` is the consumption surface. Whether promtail/Loki
  ingests these paths for tdr-code is **unverified**; if events are meant to be
  queried in Grafana rather than by tailing files, ingestion must be confirmed.

---

## Outstanding Questions

### Resolve Before Planning

- [Affects R3, R10, D5][User decision] Confirm the `debug` exemption — `event`
  required only on `info`+. If you want literally *every* line (including debug
  tracing) to carry a registry event, that adds ~25 backend sites and more
  registry churn for lines that are dropped in prod anyway.

### Deferred to Planning

- [Affects R12][Technical] Exact frontend helper signatures (`logEvent(event,
  context?)` vs `logEvent(event, msg, context?)`, and how `msg` defaults for pure
  telemetry where the slug is self-describing).
- [Affects R6][Technical] Registry file name/location (e.g.
  `src/logging/log-events.ts`) and whether the union is one flat `as const` array
  or grouped consts merged into `LogEvent`.
- [Affects R10][Technical] Whether the ~90 DI `info`+ sites are updated in one
  sweep or incrementally by domain.
- [Affects R13, R15][Needs research] Whether to verify/enable Loki ingestion of
  the tdr-code log files, or formally treat files as the only query surface.

---

## Next Steps

-> Resume /ce-brainstorm to resolve the one blocking question (debug exemption),
then -> /ce-plan for structured implementation planning.
