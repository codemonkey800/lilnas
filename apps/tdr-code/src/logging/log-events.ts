// Plane-neutral event registry: Node stdlib + dependency-free local imports
// ONLY. No @nestjs/*, no react/next, no pino. This file is imported from the
// main backend process, the bot child process, Next.js server code, and the
// browser bundle alike, so it must never pull in a framework — mirrors the
// import discipline in src/logging/log-paths.ts.
//
// Shape mirrors src/env.ts's EnvKeys: an `as const` object literal per domain,
// spread-merged into one catalog, with the union type derived by indexed
// access rather than hand-written. Adding a new event means adding one line
// to the right domain group (or a new group) — the derived LogEvent type and
// LOG_EVENT_VALUES catalog update themselves.
//
// Every info/warn/error/fatal log call must carry one of these slugs as its
// `event` field. `debug` calls are exempt (see the structured-logging
// convention doc for the full level-semantics table).

const AUTH_EVENTS = {
  // auth.guard.ts's AUTH_DENIED_EVENT / AUTH_CHECK_ERROR_EVENT constants,
  // folded from snake_case (R8).
  authDenied: 'auth-denied',
  authCheckError: 'auth-check-error',
} as const

const GUILD_EVENTS = {
  // auth.ts's guild-gate outcomes (guild_gate_rejected / _check_error /
  // _sweep), folded from snake_case (R8). These live in auth.ts, not
  // guild-gate.ts — see guildLookupComplete below for the one guild-gate.ts
  // site.
  guildDenied: 'guild-denied',
  guildCheckError: 'guild-check-error',
  guildSweep: 'guild-sweep',
  // guild-gate.ts's only info+ line: a lookup-outcome line, not a rejection.
  guildLookupComplete: 'guild-lookup-complete',
} as const

const SESSION_EVENTS = {
  // session-manager.service.ts's insertSession catch blocks. Both already
  // log { err, channelId }; this is the AE1 acceptance-example site.
  sessionInsertFailed: 'session-insert-failed',
  reactivationInsertFailed: 'reactivation-insert-failed',
} as const

const DISCORD_EVENTS = {
  // composite-acp-handler.ts's handleWriterError.
  writerFault: 'writer-fault',
} as const

const PAGE_EVENTS = {
  // page-view-tracker.tsx: page_view -> page-view.
  pageView: 'page-view',
} as const

const INTERACTION_EVENTS = {
  // click-tracker.tsx: button_click -> button-click.
  buttonClick: 'button-click',
} as const

const QUERY_EVENTS = {
  // providers.tsx's React Query cache chokepoint: query_error -> query-error.
  queryError: 'query-error',
} as const

const MUTATION_EVENTS = {
  // providers.tsx's React Query cache chokepoint.
  mutationError: 'mutation-error',
  mutationSuccess: 'mutation-success',
} as const

const RECONCILE_EVENTS = {
  // reconcile-logging.ts.
  reconcileResult: 'reconcile-result',
  reconcileMismatch: 'reconcile-mismatch',
} as const

const ERROR_BOUNDARY_EVENTS = {
  // error-reporter.tsx mounts a window-level 'error' listener and an
  // 'unhandledrejection' listener; each is a distinct raw-message site that
  // U7 wires to one of these two slugs instead of logging error.message
  // itself as the event.
  unhandledError: 'unhandled-error',
  unhandledRejection: 'unhandled-rejection',
  // error-boundary-logging.ts's logBoundaryError, shared by error.tsx and
  // global-error.tsx.
  errorBoundaryCaught: 'error-boundary-caught',
} as const

export const LOG_EVENTS = {
  ...AUTH_EVENTS,
  ...GUILD_EVENTS,
  ...SESSION_EVENTS,
  ...DISCORD_EVENTS,
  ...PAGE_EVENTS,
  ...INTERACTION_EVENTS,
  ...QUERY_EVENTS,
  ...MUTATION_EVENTS,
  ...RECONCILE_EVENTS,
  ...ERROR_BOUNDARY_EVENTS,
} as const

export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS]

// Runtime catalog of every registered slug, for tests and any future
// membership validation. Order follows LOG_EVENTS's own key order (i.e. the
// domain-group spread order above).
export const LOG_EVENT_VALUES: readonly LogEvent[] = Object.values(LOG_EVENTS)
