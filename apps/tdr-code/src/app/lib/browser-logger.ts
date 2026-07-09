import type { LogEvent } from 'src/logging/log-events'

type BrowserLogLevel = 'error' | 'warn' | 'info'

// Applied to any JS stack trace (Error#stack, an ErrorEvent's nested
// error.stack, etc.) before it leaves the browser. A stack is un-pathable
// free text — same risk class as the backend's identity-resolution.ts C1
// case (arbitrary error internals can end up embedded in it via a rethrow
// or a library that stuffs extra context into the message line a stack
// starts with), just lower severity here: a JS stack frame list rather than
// decoded SSH key bytes. The DTO already caps the sibling `message` field at
// 2000 chars (browser-logs.dto.ts); 2000 is used here too so one stack can
// never alone blow past what a human is going to read out of
// frontend-browser.<env>.log anyway, while still comfortably fitting a
// multi-frame trace (a typical browser stack frame is ~60-100 chars; 2000
// chars covers ~20-30 frames, more than enough for triage). Exported so the
// 3 error-reporting call sites (error-reporter.tsx x2,
// error-boundary-logging.ts x1) share one implementation instead of
// duplicating the truncation.
const STACK_CHAR_CAP = 2000

export function capStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined
  return stack.length > STACK_CHAR_CAP ? stack.slice(0, STACK_CHAR_CAP) : stack
}

// Applied to a raw `Error#message` (or its String(error) fallback) before it
// becomes the `msg` argument to logToServer, at providers.tsx's React Query
// error chokepoints. Same hygiene concern as capStack above but a smaller
// cap: this text is meant to be a one-line human-readable summary (e.g.
// "fetch failed: 500"), not a multi-frame trace, and it can originate from a
// failed config-save or git-identity-upsert mutation — arbitrary,
// un-pathable free text from whatever threw, same risk class as capStack's
// case just via a different field. 300 chars comfortably fits any realistic
// one-line error summary while staying well under the DTO's 2000-char total
// `message` cap (browser-logs.dto.ts) — no need to spend anywhere near that
// whole budget on an error string nobody reads past the first sentence of.
// No content-based scrubbing beyond length: providers.tsx's two call sites
// only ever see `Error#message`/`String(error)` from this app's own
// queryFn/mutationFn rejections (config fetch/save, git-identity upsert),
// never a raw exception thrown by unrelated third-party code the way
// identity-resolution.ts's sshpk parse-error path can (that backend C1 case
// coarsens to err.name only, unconditionally, because THAT specific
// exception source is known to embed decoded key bytes in .message) — a
// length cap is a proportionate, general-purpose bound for this call site,
// not a substitute for that stricter backend guard.
const MESSAGE_CHAR_CAP = 300

export function capMessage(message: string): string {
  return message.length > MESSAGE_CHAR_CAP
    ? message.slice(0, MESSAGE_CHAR_CAP)
    : message
}

// Deliberately NOT built on this file's own request() helper (api.ts) — that
// helper redirects to /login on any 401 (see its own header comment), which
// must never fire from a background telemetry call. A bare fetch that
// swallows its own errors is the right shape for "best-effort, never affects
// the page" logging.
//
// `event` is a typed slug (checked against src/logging/log-events.ts's
// LogEvent registry at compile time) identifying WHAT happened; `msg` is the
// separate human-readable text describing it — previously these were the
// same free-text `message` parameter, which meant nothing about it was
// queryable or type-checked.
export function logToServer(
  level: BrowserLogLevel,
  event: LogEvent,
  msg: string,
  context?: Record<string, unknown>,
): void {
  fetch('/api/logs/browser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Path + query only, never window.location.origin — see
    // browser-logs.dto.ts's url field comment for why the backend's
    // redaction depends on this file never sending the full href.
    body: JSON.stringify({
      level,
      event,
      message: msg,
      context,
      url: window.location.pathname + window.location.search,
      userAgent: navigator.userAgent,
    }),
    // Keeps the request alive across a page unload/navigation — relevant
    // specifically for the window.onerror/unhandledrejection auto-capture
    // case in error-reporter.tsx, where the triggering error can coincide
    // with the user already navigating away.
    keepalive: true,
  }).catch(() => {})
}

// "This happened" telemetry (page views, clicks, successful outcomes) vs.
// logToServer's "something went wrong" (errors/warnings) — always level
// 'info', same fire-and-forget contract as logToServer itself. `msg`
// defaults to the slug itself since these call sites rarely need
// human-readable prose beyond "a button-click happened" — the context
// object carries the specifics (which button, which path, etc.).
export function logEvent(
  event: LogEvent,
  context?: Record<string, unknown>,
): void {
  logToServer('info', event, event, context)
}
