type BrowserLogLevel = 'error' | 'warn' | 'info'

// Deliberately NOT built on this file's own request() helper (api.ts) — that
// helper redirects to /login on any 401 (see its own header comment), which
// must never fire from a background telemetry call. A bare fetch that
// swallows its own errors is the right shape for "best-effort, never affects
// the page" logging.
export function logToServer(
  level: BrowserLogLevel,
  message: string,
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
      message,
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
// 'info', same fire-and-forget contract as logToServer itself.
export function logEvent(
  name: string,
  context?: Record<string, unknown>,
): void {
  logToServer('info', name, context)
}
