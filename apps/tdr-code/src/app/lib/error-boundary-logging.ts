import { LOG_EVENTS } from 'src/logging/log-events'

import { capStack, logToServer } from './browser-logger'

// Shared by error.tsx and global-error.tsx so the logging call is
// unit-testable on its own — global-error.tsx renders its own <html>/<body>,
// which fighting React Testing Library's document.body-mount assumption to
// exercise inline isn't worth it just to prove one logToServer call.
export function logBoundaryError(error: Error & { digest?: string }): void {
  logToServer('error', LOG_EVENTS.errorBoundaryCaught, error.message, {
    digest: error.digest,
    stack: capStack(error.stack),
  })
}
