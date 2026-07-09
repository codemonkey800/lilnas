import { type Instrumentation } from 'next'

import { LOG_EVENTS } from './logging/log-events'

// Next's official server-startup hook — register() runs once, before any
// request is handled, in both `next dev` and the standalone prod server
// (stable since Next 15, no experimental flag needed). This app authors no
// custom server.js of its own (output: 'standalone' generates one), so this
// is the only place to run code at "the frontend process started" time —
// see next.config.js.
//
// register() also fires once for the EDGE runtime (middleware.ts's
// environment), which has no filesystem access — guard on NEXT_RUNTIME so
// the file-backed logger (and its console.log below) only ever initializes
// in the real Node process. The dynamic imports (not top-level ones) mean
// the edge invocation never even evaluates log-paths.ts / frontend-server-
// logger.ts, belt-and-suspenders against those modules ever growing a
// Node-only dependency (frontend-server-logger already pulls in pino/file,
// which cannot run on the edge). LOG_EVENTS is safe to import at top level —
// it is deliberately plane-neutral (Node stdlib + dependency-free local
// imports only; see its own header comment), so the edge bundle can evaluate
// it without pulling in a Node-only dependency.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logFilePath } = await import('./logging/log-paths')
    console.log(
      `[tdr-code] frontend-server logs: ${logFilePath('frontend-server')}`,
    )
    // First real writer of frontendServerLogger (its own header comment
    // invites exactly this): a boot marker so an operator can pin "the Next
    // server (re)started at T" in the same frontend-server.<env>.log stream
    // and correlate a burst of client anomalies with a redeploy or crash.
    const { frontendServerLogger } = await import(
      './logging/frontend-server-logger'
    )
    frontendServerLogger.info(
      { event: LOG_EVENTS.frontendServerBooted, nodeVersion: process.version },
      'frontend server booted',
    )
  }
}

// The longest error message this hook will emit (as the pino `msg`), a
// proportionate coarsening for this plane: a server render/route/action error
// message is ordinary error text (unlike identity-resolution.ts's C1 case,
// where sshpk parse errors can embed decoded key bytes — that call site
// coarsens to err.name ONLY). Matches browser-logger.ts's own capMessage(300)
// precedent for the analogous browser-side unhandled-rejection message.
const MESSAGE_CAP = 300

// Next's server-side request-error hook (stable in Next 15) — the
// frontend-server mirror of the browser's ErrorReporter. Fires for SSR/RSC
// render, Route Handler, and Server Action errors in the Node server; never
// for client React errors (those stay with error-reporter.tsx / the error
// boundaries) and never for the edge middleware's cookie-gate redirect.
//
// Unlike register(), this export has no top-level runtime branch — Next
// compiles onRequestError into the EDGE bundle too (it's a general hook, not
// one this app scopes by env var), so the dynamic import below must repeat
// register()'s `NEXT_RUNTIME === 'nodejs'` guard. Without it, webpack still
// resolves and builds './logging/frontend-server-logger' (-> log-paths.ts ->
// `node:path`) for the edge compilation even though this app's own routing
// never actually calls onRequestError from edge — the guard is a build-time
// requirement, not just a runtime one. Confirmed by reproducing `next build`
// locally: removing this guard reintroduces "UnhandledSchemeError: Reading
// from node:path is not handled by plugins" during the edge-server pass.
//
// `err` is un-pathable free text (the structured-logging convention doc's C1
// rule): its .message can embed arbitrary internals, and this logger's
// REDACT_PATHS are root-anchored to the pino-http `req.*` shape (see
// src/logger.ts) — they would NOT match these flat fields. So this coarsens
// at the call site: err.name as a field, a length-capped message as the pino
// `msg`, NEVER a raw stack, and the request path stripped of its query string
// (it can carry an OAuth `code`/`state` on an /auth/* callback render — the
// same value redactAuthQueryString strips server-side for the HTTP logger).
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { frontendServerLogger } = await import(
      './logging/frontend-server-logger'
    )
    const rawMessage = err instanceof Error ? err.message : String(err)
    const cappedMessage =
      rawMessage.length > MESSAGE_CAP
        ? rawMessage.slice(0, MESSAGE_CAP)
        : rawMessage
    const queryStart = request.path.indexOf('?')
    const pathOnly =
      queryStart === -1 ? request.path : request.path.slice(0, queryStart)
    frontendServerLogger.error(
      {
        event: LOG_EVENTS.serverRequestError,
        errName: err instanceof Error ? err.name : typeof err,
        method: request.method,
        path: pathOnly,
        routePath: context.routePath,
        routeType: context.routeType,
      },
      cappedMessage,
    )
  }
}
