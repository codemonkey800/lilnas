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
// in the real Node process. The dynamic import (not a top-level one) means
// the edge invocation never even evaluates log-paths.ts, belt-and-suspenders
// against that module ever growing a Node-only dependency later.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { logFilePath } = await import('./logging/log-paths')
    console.log(
      `[tdr-code] frontend-server logs: ${logFilePath('frontend-server')}`,
    )
  }
}
