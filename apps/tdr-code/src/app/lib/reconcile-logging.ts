import type { ReconcileResponseDto } from 'src/console/reconcile.dto'
import { LOG_EVENTS } from 'src/logging/log-events'

import { logEvent, logToServer } from './browser-logger'

// Never forwards the raw missingInDb/extraInDb/mismatched arrays — those
// carry real transcript/tool-call text (see reconcile.dto.ts's
// ReconcileBlockRefSchema and the mismatched entries' jsonlText/dbText).
// Only their .length ever leaves the browser, matching ReconcilePanel's own
// restraint (it only ever renders .length for these today too).
export function logReconcileResult(
  sessionId: number,
  data: ReconcileResponseDto,
): void {
  if (data.verdict === 'cannot-reconcile') {
    logEvent(LOG_EVENTS.reconcileResult, {
      sessionId,
      verdict: data.verdict,
      reason: data.reason,
    })
    return
  }

  const hasDrift =
    data.missingInDb.length > 0 ||
    data.extraInDb.length > 0 ||
    data.mismatched.length > 0

  const counts = {
    sessionId,
    verdict: data.verdict,
    matched: data.matched,
    missingInDb: data.missingInDb.length,
    extraInDb: data.extraInDb.length,
    mismatched: data.mismatched.length,
    skippedJsonlLines: data.skippedJsonlLines,
  }

  if (hasDrift) {
    logToServer(
      'warn',
      LOG_EVENTS.reconcileMismatch,
      'Reconcile mismatch detected',
      counts,
    )
  } else {
    logEvent(LOG_EVENTS.reconcileResult, counts)
  }
}
