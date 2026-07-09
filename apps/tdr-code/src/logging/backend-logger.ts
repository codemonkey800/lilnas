import { env } from '@lilnas/utils/env'
// pino ships `export =` merged with a same-named namespace — the
// import/no-named-as-default warning is a known false positive for this
// pattern (see auth-mount.spec.ts's identical precedent).
// eslint-disable-next-line import/no-named-as-default
import pino from 'pino'

import { EnvKeys } from 'src/env'
import { redactionCensor } from 'src/logger'

import { logFilePath } from './log-paths'

// For the 8 non-DI backend files (agent/git-turn-context.ts,
// crypto/identity-resolution.ts, auth/auth.ts's nest-Logger calls, etc.) that
// use plain @nestjs/common Logger today and cannot emit structured fields.
// This gives them a real pino instance with the same secret hygiene as the
// DI PinoLogger sink, writing to the SAME backend.<env>.log file
// (log-paths.ts's 'backend' stream — see src/logger.ts's buildLoggerOptions
// header comment for why one shared O_APPEND file is safe across processes).
//
// Per-process ROOT, not a module-level singleton: a fixed `export const
// logger = pino(...)` built once at import time can never know which process
// (main HTTP server vs bot Discord-gateway child) imported it, so it could
// never stamp `base.process` correctly — and crypto/identity-resolution.ts
// is dual-plane (imported by both). Instead, each process entrypoint calls
// initBackendLogger(processName) exactly once (bootstrap.ts -> 'main',
// bot-bootstrap.ts -> 'bot'); module-level code calls getBackendLogger() AT
// LOG TIME (never at import time) to fetch whichever root that process
// initialized. This means a dual-plane file is correct automatically in
// both processes without needing to know which one it's running in.
//
// Invariant this relies on (verified true today across all 8 non-DI files):
// none of them log at module-eval time — every getBackendLogger() call
// happens inside a function body, after the process's bootstrap has already
// run initBackendLogger(). If that ever stopped being true, the fail-fast
// throw below would crash bootstrap import itself.
let backendLoggerRoot: pino.Logger | undefined

// This logger is called with FLAT object shapes at the root, e.g.
// `getBackendLogger().warn({ event, privateKey }, 'msg')` — unlike
// src/logger.ts's REDACT_PATHS, which is shaped for pino-http's req/res
// wrapper objects and is root-anchored one level deep (confirmed against the
// installed @pinojs/redact: '*.privateKey' matches only nested paths like
// `req.body.privateKey`, never a flat root-level `privateKey`). Reusing
// REDACT_PATHS here would be a silent no-op for exactly the shapes this
// logger actually receives — see frontend-server-logger.ts's header comment
// for why THAT file gets away with reusing REDACT_PATHS as-is (zero call
// sites today); this logger has real call sites (U3), so it authors its own
// list instead, following browser-logs.service.ts's precedent
// (BROWSER_LOG_REDACT_PATHS + the same shared redactionCensor).
//
// Each secret-shaped key is covered flat (root-level) AND one level nested,
// since some call sites log a nested context object
// (e.g. `{ event, git: { accessToken } }`) rather than a flat one.
//
// Poison-pills: fields that should never legitimately appear in a log
// object at all (unlike privateKey et al., which are real DTO/config field
// names this app has). Listed defense-in-depth against a future call site
// that accidentally logs one of these wholesale — e.g. `sshCommand` today
// carries only a tmpfs key *path*, never key bytes, but redacting it now
// means a later edit that starts including key content doesn't silently
// bypass redaction just because nobody remembered to add a path for it.
export const BACKEND_MODULE_REDACT_PATHS = [
  // Real secret-bearing field names call sites use.
  'privateKey',
  '*.privateKey',
  'keyPlaintext',
  '*.keyPlaintext',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'cookie',
  '*.cookie',
  'authorization',
  '*.authorization',
  'token',
  '*.token',
  'secret',
  '*.secret',
  // Poison-pills: should never appear as a logged field at all.
  'env',
  '*.env',
  'signingKey',
  '*.signingKey',
  'signing_key',
  '*.signing_key',
  'sshCommand',
  '*.sshCommand',
  'keyPath',
  '*.keyPath',
  'GIT_CONFIG_VALUE_0',
  '*.GIT_CONFIG_VALUE_0',
  'GIT_CONFIG_VALUE_1',
  '*.GIT_CONFIG_VALUE_1',
  'GIT_CONFIG_VALUE_2',
  '*.GIT_CONFIG_VALUE_2',
  'GIT_CONFIG_VALUE_3',
  '*.GIT_CONFIG_VALUE_3',
  'GIT_CONFIG_VALUE_4',
  '*.GIT_CONFIG_VALUE_4',
]

// Deliberately NOT registering a global `err` serializer here. Pino's
// default serializer for an `{ err }` field emits err.message + the full
// err.stack verbatim — appropriate for most call sites, but wrong for
// crypto/identity-resolution.ts's decrypt/parse-failure path, where
// err.message can embed decoded private-key bytes (sshpk parse errors do
// this). A global serializer has no way to know which call site is
// currently logging, so it can't distinguish "safe to emit err.message" from
// "coarsen to err.name only" — that's a per-call-site decision (U3), not
// something this logger's construction can centralize. Left as a deliberate
// choice, not an oversight.
function buildTransport(isProduction: boolean, level: 'info' | 'debug') {
  const fileTarget = {
    target: 'pino/file',
    options: { destination: logFilePath('backend'), mkdir: true },
    level,
  }
  if (isProduction) {
    return { targets: [fileTarget] }
  }
  return { targets: [{ target: 'pino-pretty', level }, fileTarget] }
}

// Exported (mirroring src/logger.ts's own buildLoggerOptions shape) so
// backend-logger.spec.ts can construct a real pino instance from the exact
// same level/base/redact config initBackendLogger() uses, while overriding
// ONLY `transport` to redirect at an isolated per-test temp path — the same
// technique auth-mount.spec.ts uses for buildLoggerOptions(). This matters
// because `transport`'s real destination is logFilePath('backend'), the
// SAME file main/bot processes write to in a real run; a real dev/bot
// process may be concurrently appending to that exact file while tests run
// (confirmed empirically — see this function's test file for the story), so
// tests must never read/truncate the real shared sink directly.
export function buildBackendLoggerOptions(processName: 'main' | 'bot') {
  const isProduction = env(EnvKeys.NODE_ENV, 'development') === 'production'
  const level = isProduction ? 'info' : 'debug'
  return {
    level,
    base: { process: processName },
    redact: { paths: BACKEND_MODULE_REDACT_PATHS, censor: redactionCensor },
    transport: buildTransport(isProduction, level),
  }
}

// Called exactly once per process, as early as possible in that process's
// bootstrap sequence (before any code path that might log) — bootstrap.ts
// calls initBackendLogger('main'), bot-bootstrap.ts calls
// initBackendLogger('bot'), and the shared backend Jest setup
// (__tests__/setup.ts) calls initBackendLogger('bot') so specs that reach a
// migrated non-DI log line don't hit the fail-fast throw below.
export function initBackendLogger(processName: 'main' | 'bot'): void {
  backendLoggerRoot = pino(buildBackendLoggerOptions(processName))
}

// Fetched AT LOG TIME by non-DI module code, never cached at import time —
// see this file's header comment for why that's load-bearing for
// crypto/identity-resolution.ts's dual-plane correctness. Throws if called
// before initBackendLogger() has run in this process: a missing bootstrap
// call should be a loud, immediate crash, not a silently-dropped log line.
export function getBackendLogger(): pino.Logger {
  if (!backendLoggerRoot) {
    throw new Error(
      'getBackendLogger() called before initBackendLogger() — call ' +
        "initBackendLogger('main'|'bot') early in this process's bootstrap " +
        'sequence before any code path that logs.',
    )
  }
  return backendLoggerRoot
}
