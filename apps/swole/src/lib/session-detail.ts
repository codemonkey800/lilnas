// Pure, side-effect-free predicates for the session detail page.
// No 'server-only', no DB imports — safe to call from server or client.

import type { ProgressionRow, SessionRow } from 'src/db/types'

/**
 * Classifies a session row into one of three view states:
 * - 'unknown': null row (not found)
 * - 'active': completedAt == null
 * - 'completed': completedAt is set
 */
export function classifySessionView(
  session: SessionRow | null,
): 'unknown' | 'active' | 'completed' {
  if (session === null) return 'unknown'
  if (session.completedAt === null) return 'active'
  return 'completed'
}

/**
 * Returns true when no session_progression row exists for this session,
 * meaning the session can be safely deleted.
 */
export function canDeleteSession(progressions: ProgressionRow[]): boolean {
  return !progressions.some(p => p.reason === 'session_progression')
}
