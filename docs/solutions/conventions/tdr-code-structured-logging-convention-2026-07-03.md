---
title: "tdr-code structured logging: typed event slugs, per-process logger, and the redaction control hierarchy"
date: 2026-07-03
category: conventions
module: tdr-code/logging
problem_type: convention
component: logging
severity: medium
related_components:
  - auth
  - crypto
  - frontend
tags:
  - pino
  - nestjs-pino
  - structured-logging
  - redaction
  - event-registry
  - typescript
  - kebab-case
  - secret-hygiene
applies_when:
  - Adding a new info/warn/error/fatal log call anywhere in apps/tdr-code
  - Deciding which logger a new file or module should use
  - An error's .message or .stack might embed secret material (keys, tokens, commands)
  - Adding or changing a browser telemetry call site (logEvent/logToServer)
  - Reviewing a PR that adds a log line and checking whether it follows convention
---

# tdr-code structured logging: typed event slugs, per-process logger, and the redaction control hierarchy

## Context

tdr-code's logging **plumbing** — three streams (`backend`, `frontend-server`,
`frontend-browser`) resolved through `src/logging/log-paths.ts`, shared
redaction (`REDACT_PATHS`/`redactionCensor` in `src/logger.ts`), and the
browser-telemetry ingestion pipeline (`POST /api/logs/browser` →
`BrowserLogsService`) — was built in commit `5c04950`. What that commit didn't
standardize was the **call-site convention**: message text was a free-for-all
(capitalized sentences, lowercase fragments, `namespace:`-prefixed strings,
ad-hoc event constants), frontend event slugs were snake_case while errors
logged raw `error.message` into the human slot, and the backend ran two
incompatible logger styles — DI `PinoLogger` (object-first, can emit
structured fields) and a handful of non-DI `@nestjs/common` `Logger` files
(interpolated strings only, no structured fields possible at all).

The result: logs couldn't be reliably queried. There was no stable field to
filter or alert on, so every new log line was a fresh judgment call — worst of
all in the auth/crypto/SSH-key files, which log exactly the events an
operator would want to alert on. One of those files, `identity-resolution.ts`,
was actually interpolating `err.message` into a log line on a code path where
the underlying error can embed **decoded private-key bytes** (see the C1
example below) — a real, live secret-leak risk hiding behind "just log the
error" boilerplate.

This document is the convention that closes both gaps: a typed event
registry every logger surface imports, and a redaction control hierarchy that
treats call-site hygiene — not redact-path config — as the primary defense.

## Guidance

### 1. Every `info`+ log carries a structured `event` slug, plus a human `msg`

```ts
// DI PinoLogger (object-first already)
this.logger.warn(
  { event: "auth-denied", path: request.originalUrl },
  "Request denied: no valid session",
);

// getBackendLogger() — same shape
getBackendLogger().warn(
  { event: "guild-denied", providerId },
  "Non-member sign-in rejected before account provisioning",
);

// Browser
logToServer("warn", "query-error", capMessage(message), { queryKey });
```

The `event` field goes in the **first** (object) argument; the human message
is the **second** argument. `event` is what an operator filters/alerts on;
`msg` is what a developer reads off the pino-pretty console in dev. Never
put the event slug in the message position and call it done — that was the
exact anti-pattern this convention replaces (see `auth.guard.ts`'s old
`AUTH_DENIED_EVENT`/`AUTH_CHECK_ERROR_EVENT` constants, which used to be
passed as the _message_ argument).

**`debug` is exempt.** It's dev-only tracing, dropped at the prod `info`
threshold, and carries no `event` — don't invent one. Every other level
(`info`, `warn`, `error`, `fatal`) requires a registered `event`.

### 2. The registry: `src/logging/log-events.ts`

One typed, **plane-neutral** module every event-emitting logger surface
imports:

```ts
const AUTH_EVENTS = {
  authDenied: "auth-denied",
  authCheckError: "auth-check-error",
} as const;

// … one as-const object per domain …

export const LOG_EVENTS = {
  ...AUTH_EVENTS,
  ...SESSION_EVENTS /* … */,
} as const;
export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS];
export const LOG_EVENT_VALUES: readonly LogEvent[] = Object.values(LOG_EVENTS);
```

This mirrors `src/env.ts`'s `EnvKeys` convention exactly: an `as const`
object-literal per domain, a union type derived by indexed access rather
than hand-written, and a runtime catalog (`LOG_EVENT_VALUES`) for tests. An
unregistered slug fails `tsc`, not at runtime.

**To add a new event:** pick (or create) a domain-grouped object, add a
`camelCaseKey: 'kebab-case-value'` entry, spread the group into `LOG_EVENTS`
if it's a new group, and add the value to `log-events.spec.ts`'s seeded-slug
list. Slugs are always kebab-case (`session-teardown-failed`, not
`SessionTeardownFailed` or `session_teardown_failed`).

**Plane-neutrality is load-bearing.** This file is imported from the main
backend process, the bot child process, Next.js server code, and the browser
bundle. Its import surface must stay Node-stdlib-and-dependency-free-local
modules only — no `@nestjs/*`, no `react`/`next`, no `pino`. Adding a
framework import here would break whichever plane doesn't have that
dependency available.

### 3. Level semantics

| Level   | When                                                     | Example event                           |
| ------- | -------------------------------------------------------- | --------------------------------------- |
| `debug` | Dev-only tracing; dropped in prod; **no event required** | _(eventless)_                           |
| `info`  | Lifecycle milestones + audit of state-changing successes | `prompt-dispatched`, `session-created`  |
| `warn`  | Recoverable / degraded; handled but notable              | `auth-denied`, `reconcile-mismatch`     |
| `error` | An operation failed and needs attention                  | `writer-fault`, `session-insert-failed` |
| `fatal` | Process-ending only                                      | _(reserved — no current call sites)_    |

### 4. Context-key vocabulary (conventional, not type-enforced)

Prefer these camelCase field names when the concept applies: `err`,
`channelId`, `userId`, `discordUserId`, `sessionId`, `path` — plus pino's own
`base.process` (stamped automatically by whichever logger you're using, see
below). Only `event` is type-checked against the registry; these are
conventions for cross-file greppability, not a closed set — a field like
`durationMs`, `providerId`, or `queryKey` is fine when that's genuinely what
the call site has.

### 5. Which logger to use where

| Context                                                                                                                                                                                                                              | Logger                                                           | Call shape                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nest service/controller with DI                                                                                                                                                                                                      | injected `PinoLogger` (`nestjs-pino`)                            | `this.logger.info({ event, ...ctx }, msg)`                                                                                                                                                                                             |
| Module-level backend code with no DI (currently 8 files: `acp-client.ts`, `identity-resolution.ts`, `image-attachments.ts`, `guild-gate.ts`, `auth.ts`'s nest-Logger calls, `git-turn-context.ts`, `git-write-lock.ts`, `reaper.ts`) | `getBackendLogger()` from `src/logging/backend-logger.ts`        | `getBackendLogger().info({ event, ...ctx }, msg)`                                                                                                                                                                                      |
| Next.js server code                                                                                                                                                                                                                  | `frontendServerLogger` (`src/logging/frontend-server-logger.ts`) | _(no call sites yet — when server code first needs to log, wire it to the `LogEvent` registry the same way `getBackendLogger()` callers do; don't reuse its current zero-call-site redaction stance once it has real callers, see §6)_ |
| Browser                                                                                                                                                                                                                              | `logEvent`/`logToServer` (`src/app/lib/browser-logger.ts`)       | `logEvent(event, ctx)` or `logToServer(level, event, msg, ctx)`                                                                                                                                                                        |

**Why `getBackendLogger()` is a per-process accessor, not a module-level
singleton.** A fixed `export const logger = pino(...)` built once at import
time can never know which process (the main HTTP server vs. the bot Discord
child process) imported it, so it could never stamp pino's `base.process`
field correctly — and `identity-resolution.ts` is genuinely dual-plane
(imported by both). Instead, each process entrypoint calls
`initBackendLogger('main' | 'bot')` exactly once, as early as possible in its
own bootstrap (`bootstrap.ts` → `'main'`, `bot-bootstrap.ts` → `'bot'`, and
the shared backend Jest setup → `'bot'`, so specs reaching a migrated log
line don't crash). Module-level code then calls `getBackendLogger()` **at log
time, inside a function body — never at import/module-eval time.** This is
what makes a dual-plane file correct automatically in both processes without
needing to know which one it's running in, and it's why `getBackendLogger()`
throws fail-fast if called before `initBackendLogger()` has run: a missing
bootstrap call should be a loud crash, not a silently dropped log line. The
one invariant this relies on — verified true across all 8 non-DI files today
— is that none of them log at module-eval time.

### 6. The redaction control hierarchy (the load-bearing section)

**Call-site hygiene first. Shape-anchored redact paths second, as
defense-in-depth — never the primary guarantee.**

`src/logger.ts`'s `REDACT_PATHS`/`redactionCensor` (the DI logger's
machinery) and each non-DI/browser logger's own path list
(`BACKEND_MODULE_REDACT_PATHS` in `backend-logger.ts`,
`BROWSER_LOG_REDACT_PATHS` in `browser-logs.service.ts`) all reuse the same
`redactionCensor` mask function, but redact-path config can only catch
secrets that live at a **known key name and nesting depth**. Several real
secret shapes are structurally un-pathable:

- **An error's `.message`/`.stack`.** Pino's default `err` serializer emits
  both verbatim. If the underlying error can embed secret bytes in its
  message — which is exactly what happens on `identity-resolution.ts`'s
  sshpk key-parse-failure path — no redact path can catch it, because the
  secret isn't a keyed field, it's free text inside a string.
- **Stringified commands** (e.g. a spawned git command line that embeds a
  token or key path as an argument).
- **Dynamic-key maps**, e.g. `{ ...process.env }` — the secret could be
  under any key name, so there's no fixed path to redact.
- **Array elements** — `REDACT_PATHS`-style config addresses object keys,
  not array positions.
- **A browser stack trace or arbitrary `Error#message`.** Same shape as the
  backend case, lower severity (a JS stack frame vs. decoded key bytes), but
  the same class of un-pathable free text — this applies on the frontend
  telemetry stream too, not just the backend.

**The rule this implies: when a call site's error can plausibly carry secret
material, don't log the error's free-text content at all — coarsen it at
the call site, before it ever reaches a logger.** Redact paths remain in
place as a second line of defense for the _shapes you didn't anticipate_,
never as license to skip call-site judgment on the shapes you did.

**Canonical example — `identity-resolution.ts`'s C1 fix:**

```ts
// Before (leak): err.message can embed decoded private-key bytes on a
// malformed-key sshpk parse failure — un-pathable, since it's free text.
logger.warn(
  `Identity decrypt/parse failed discordUserId=${row.discordUserId} fingerprint=${row.keyFingerprint}: ${err instanceof Error ? err.message : String(err)}`,
);

// After: never err.message, never err.stack, never the raw err object
// (pino's default err serializer would emit both anyway). Coarsen
// unconditionally to err.name — the call site can't distinguish the
// dangerous parse-failure mode from the benign GCM-decrypt-failure mode
// without fragile string-matching, so both are treated identically safely.
getBackendLogger().warn(
  {
    event: LOG_EVENTS.identityDecryptFailed,
    discordUserId: row.discordUserId,
    keyFingerprint: row.keyFingerprint,
    errName:
      err instanceof Error ? err.name : (err as object)?.constructor?.name,
  },
  "Identity decrypt/parse failed",
);
```

**Frontend precedent — `browser-logger.ts`'s `capStack`/`capMessage`:** the
browser telemetry stream extends the same hierarchy. A raw stack trace or
`Error#message` reaching `frontend-browser.<env>.log` is the same
un-pathable-free-text risk, just lower severity than decoded key bytes.
Rather than coarsening to nothing (a stack trace has real triage value,
unlike a corrupted key), the browser call sites **size-cap** it instead:
`capStack` (2000 chars) on every raw stack (`error-reporter.tsx`'s two
listeners, `error-boundary-logging.ts`), `capMessage` (300 chars) on
`providers.tsx`'s React Query error chokepoint, since that message can
originate from a failed config-save or git-identity-upsert mutation and
carry secret-adjacent text. Neither cap is a substitute for the backend's
stricter call-site guard where the risk is categorically higher (decoded key
material, not an arbitrary JS error) — pick the level of caution the actual
risk at that call site warrants, don't copy-paste one call site's treatment
onto a different one without checking whether the risk is the same class.

**Test model: real-serialized-output, not config-shape assertions.** A test
that only checks `redact.paths` contains the right strings would pass even
if the paths were anchored wrong for the shape actually being logged (the
mistake `frontend-server-logger.ts` avoids only by having zero real call
sites). Prove redaction against real bytes instead:

```ts
const { logger, outputPath } = buildIsolatedLogger("bot");
logger.warn({ event: "x", privateKey: "SENTINEL_PRIVATE_KEY_VALUE" }, "msg");

const line = await readLastLineFrom(outputPath);
expect(line.privateKey).toBe("[Redacted]");
expect(JSON.stringify(line)).not.toContain("SENTINEL_PRIVATE_KEY_VALUE");
```

Both assertions matter: `[Redacted]` proves the mask fired; `not.toContain`
proves the _raw secret_ never survived serialization anywhere in the line —
catching, for example, a censor that redacts the field you checked but
leaves a duplicate copy of the value in a sibling field. See
`backend-logger.spec.ts`, `identity-resolution.spec.ts` (the C1 proof, which
plants a sentinel inside a mocked parse failure), and
`browser-logs.service.spec.ts` for worked examples. When you add a redact
path, write the test that would fail if you deleted it again — a config-only
assertion doesn't prove that.

## Why This Matters

A log line with no stable `event` field is a line an operator can't reliably
find again — every future "find all the auth denials" or "alert when SSH-key
decryption starts failing" query degenerates into a fragile message-text
grep that breaks the next time someone rewords the message. The typed
registry makes the query surface a compile-time contract instead of a prose
convention nobody enforces.

The redaction hierarchy matters more sharply: `identity-resolution.ts`'s
C1 case was a real path where a single `${err.message}` interpolation would
have written decoded private-key bytes to a log file in plaintext, and no
amount of redact-path tuning could have caught it after the fact, because
the secret never had a keyed home to redact. Call-site judgment is the only
layer capable of stopping that class of leak before it happens; redact paths
catch what call-site judgment misses, not the other way around.

## When to Apply

- Writing any new `info`/`warn`/`error`/`fatal` log call — it needs a
  registered `event`; `debug` doesn't.
- Adding a new module-level backend file that needs to log but has no DI
  container available — use `getBackendLogger()`, not a fresh
  `@nestjs/common Logger` or a new ad-hoc pino instance.
- Handling a caught error whose `.message` or `.stack` might contain secret
  material (key bytes, tokens, credentials, raw commands) — coarsen at the
  call site before it's a keyed log field, don't rely on a redact path to
  save you.
- Adding or changing a browser telemetry call site — use the typed
  `logEvent`/`logToServer` signatures, and apply `capStack`/`capMessage` (or
  a call-site-appropriate equivalent) to anything derived from an
  uncontrolled `Error`.
- Reviewing a PR that adds a log line: does it have an `event` (if `info`+)?
  Does it ever ship `err.message`/`err.stack`/a raw `err` object from a call
  site where the underlying error could carry secret content?

## Examples

Full before/after pairs for the two acceptance-example sites this
convention introduced, both realized as plain field-adds with no new
branches:

```ts
// session-manager.service.ts — AE1, before:
this.logger.error({ err, channelId }, "Session-row insert failed");

// after:
this.logger.error(
  { event: LOG_EVENTS.sessionInsertFailed, err, channelId },
  "Session-row insert failed",
);
```

```ts
// auth.ts — AE2, before (nest-Logger call only; Better Auth's own
// context.logger call on the line above is untouched, both then and now):
logger.warn(
  `guild_gate_rejected: non-member sign-in rejected before account provisioning providerId=${account.providerId}`,
);

// after:
getBackendLogger().warn(
  { event: LOG_EVENTS.guildDenied, providerId: account.providerId },
  "Non-member sign-in rejected before account provisioning",
);
```

## Related

- Origin requirements:
  [docs/brainstorms/2026-07-03-tdr-code-structured-logging-requirements.md](../../brainstorms/2026-07-03-tdr-code-structured-logging-requirements.md)
- Implementation plan:
  [docs/plans/2026-07-03-001-feat-tdr-code-structured-logging-plan.md](../../plans/2026-07-03-001-feat-tdr-code-structured-logging-plan.md)
- `architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`
  — the same "framework-free shared module consumed by every plane" instinct
  this registry follows.
- `conventions/type-guards-over-nonnull-assertions-on-db-rows-2026-05-30.md`
  — compiler-enforced narrowing over casts; the same philosophy underlies a
  strict `LogEvent` union making an off-registry slug a compile error rather
  than a runtime surprise.
