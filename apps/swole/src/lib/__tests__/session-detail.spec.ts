import type { ProgressionRow, SessionRow } from 'src/db/types'
import { canDeleteSession, classifySessionView } from 'src/lib/session-detail'

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 1,
    routineId: 1,
    startedAt: new Date('2026-01-01T10:00:00Z'),
    completedAt: null,
    ...overrides,
  }
}

function makeProgression(
  reason: ProgressionRow['reason'],
  sessionId?: number,
): ProgressionRow {
  return {
    id: 1,
    exerciseId: 1,
    sessionId: sessionId ?? null,
    startingWeight: 100,
    reason,
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  }
}

// ---------------------------------------------------------------------------
// classifySessionView
// ---------------------------------------------------------------------------

describe('classifySessionView', () => {
  it('returns "unknown" for null', () => {
    expect(classifySessionView(null)).toBe('unknown')
  })

  it('returns "active" for a session with completedAt == null', () => {
    expect(classifySessionView(makeSession({ completedAt: null }))).toBe(
      'active',
    )
  })

  it('returns "completed" for a session with completedAt set', () => {
    expect(
      classifySessionView(
        makeSession({ completedAt: new Date('2026-01-01T11:00:00Z') }),
      ),
    ).toBe('completed')
  })
})

// ---------------------------------------------------------------------------
// canDeleteSession
// ---------------------------------------------------------------------------

describe('canDeleteSession', () => {
  it('returns false when a session_progression row exists', () => {
    expect(canDeleteSession([makeProgression('session_progression', 1)])).toBe(
      false,
    )
  })

  it('returns true for empty progressions', () => {
    expect(canDeleteSession([])).toBe(true)
  })

  it('returns true when only initial and manual_edit progressions exist', () => {
    expect(
      canDeleteSession([
        makeProgression('initial'),
        makeProgression('manual_edit'),
      ]),
    ).toBe(true)
  })
})
