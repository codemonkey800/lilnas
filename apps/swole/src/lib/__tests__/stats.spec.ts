import type {
  ProgressionRow,
  RoutineRow,
  SessionRow,
  SetLogRow,
} from 'src/db/types'
import {
  ARCHIVED_RECENT_CAP,
  buildScopeChips,
  buildWeightTrendPoints,
  classifyConsistency,
  classifyTrend,
  consistencyPct,
  countExercisesWithRecentPR,
  doneSkippedCount,
  estimatedOneRepMax,
  expectedSessions,
  groupSetLogsBySession,
  hasLoggedSession,
  heaviestLogged,
  lastResult,
  maxScheduledGap,
  orderArchivedByRecency,
  overdueScore,
  resolveStatsScope,
  selectNeedsAttention,
  selectVisibleArchived,
  sessionsPerformed,
  sessionsThisWeek,
  shouldRenderScopeSelector,
  shouldRenderWeightChart,
  successRate,
  topSetPlanned,
  weightTrendDomain,
} from 'src/lib/stats'

// ---------------------------------------------------------------------------
// Minimal factory helpers — only the fields each test cares about.
// ---------------------------------------------------------------------------

function makeSession(id: number, completedAt?: Date | null): SessionRow {
  return {
    id,
    routineId: 1,
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: completedAt ?? new Date('2026-01-01T01:00:00Z'),
  }
}

function makeSetLog(
  overrides: Partial<SetLogRow> & { sessionId: number; setNumber: number },
): SetLogRow {
  return {
    id: overrides.id ?? 1,
    sessionId: overrides.sessionId,
    exerciseId: 1,
    setNumber: overrides.setNumber,
    weight: overrides.weight ?? null,
    targetReps: overrides.targetReps ?? null,
    actualReps: overrides.actualReps ?? null,
    durationSeconds: overrides.durationSeconds ?? null,
    actualDurationSeconds: overrides.actualDurationSeconds ?? null,
    action: overrides.action ?? 'Complete',
    loggedAt: new Date('2026-01-01T01:00:00Z'),
  }
}

// ---------------------------------------------------------------------------
// topSetPlanned
// ---------------------------------------------------------------------------

describe('topSetPlanned', () => {
  it('AE1: 105 + 5 × (3-1) = 115', () => {
    expect(topSetPlanned(105, 5, 3)).toBe(115)
  })

  it('returns startingWeight when sets = 1', () => {
    expect(topSetPlanned(100, 5, 1)).toBe(100)
  })

  it('scales for 5 sets', () => {
    expect(topSetPlanned(100, 5, 5)).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// heaviestLogged
// ---------------------------------------------------------------------------

describe('heaviestLogged', () => {
  it('AE2: returns null for empty logs', () => {
    expect(heaviestLogged([])).toBeNull()
  })

  it('AE2: returns the max non-null weight across logs', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, weight: 100 }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 2, weight: 105 }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 3, weight: 105 }) },
    ]
    expect(heaviestLogged(logs)).toBe(105)
  })

  it('ignores null weights and returns null when all are null', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, weight: null }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 2, weight: null }) },
    ]
    expect(heaviestLogged(logs)).toBeNull()
  })

  it('ignores null weights and returns the max among non-null', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, weight: null }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 2, weight: 80 }) },
    ]
    expect(heaviestLogged(logs)).toBe(80)
  })
})

// ---------------------------------------------------------------------------
// sessionsPerformed
// ---------------------------------------------------------------------------

describe('sessionsPerformed', () => {
  it('returns 0 for empty logs', () => {
    expect(sessionsPerformed([])).toBe(0)
  })

  it('counts distinct sessions', () => {
    const session1 = makeSession(1)
    const session2 = makeSession(2)
    const logs = [
      {
        setLog: makeSetLog({ sessionId: 1, setNumber: 1 }),
        session: session1,
      },
      {
        setLog: makeSetLog({ sessionId: 1, setNumber: 2 }),
        session: session1,
      },
      {
        setLog: makeSetLog({ sessionId: 2, setNumber: 1 }),
        session: session2,
      },
    ]
    expect(sessionsPerformed(logs)).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// lastResult
// ---------------------------------------------------------------------------

describe('lastResult', () => {
  it('returns null when no logs', () => {
    expect(lastResult([])).toBeNull()
  })

  it('AE5: returns middle-dot separated reps for most recent session', () => {
    // Session 2 is more recent
    const session1 = makeSession(1, new Date('2026-01-01T01:00:00Z'))
    const session2 = makeSession(2, new Date('2026-01-02T01:00:00Z'))

    const logs = [
      {
        setLog: makeSetLog({
          id: 1,
          sessionId: 1,
          setNumber: 1,
          actualReps: 10,
        }),
        session: session1,
      },
      {
        setLog: makeSetLog({
          id: 2,
          sessionId: 1,
          setNumber: 2,
          actualReps: 8,
        }),
        session: session1,
      },
      // Most recent — these should appear in result
      {
        setLog: makeSetLog({
          id: 3,
          sessionId: 2,
          setNumber: 1,
          actualReps: 15,
        }),
        session: session2,
      },
      {
        setLog: makeSetLog({
          id: 4,
          sessionId: 2,
          setNumber: 2,
          actualReps: 15,
        }),
        session: session2,
      },
      {
        setLog: makeSetLog({
          id: 5,
          sessionId: 2,
          setNumber: 3,
          actualReps: 12,
        }),
        session: session2,
      },
    ]

    expect(lastResult(logs)).toBe('15 · 15 · 12')
  })

  it('falls back to session.id when completedAt is null', () => {
    // Session 2 has higher id but null completedAt; session 1 has a completedAt
    const session1 = makeSession(1, new Date('2026-01-01T01:00:00Z'))
    const session2 = makeSession(2, null)

    const logs = [
      {
        setLog: makeSetLog({
          id: 1,
          sessionId: 1,
          setNumber: 1,
          actualReps: 5,
        }),
        session: session1,
      },
      {
        setLog: makeSetLog({
          id: 2,
          sessionId: 2,
          setNumber: 1,
          actualReps: 99,
        }),
        session: session2,
      },
    ]

    // session2 has null completedAt but higher id → treated as newer
    expect(lastResult(logs)).toBe('99')
  })

  it('handles a single set in the most recent session', () => {
    const session = makeSession(1)
    const logs = [
      {
        setLog: makeSetLog({ sessionId: 1, setNumber: 1, actualReps: 20 }),
        session,
      },
    ]
    expect(lastResult(logs)).toBe('20')
  })
})

// ---------------------------------------------------------------------------
// successRate
// ---------------------------------------------------------------------------

describe('successRate', () => {
  it('returns "—" when no sets', () => {
    expect(successRate([])).toBe('—')
  })

  it('3 Hold of 4 sets → "75%"', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, action: 'Hold' }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 2, action: 'Hold' }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 3, action: 'Hold' }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 4, action: 'Failed' }) },
    ]
    expect(successRate(logs)).toBe('75%')
  })

  it('all Hold → "100%"', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, action: 'Hold' }) },
      { setLog: makeSetLog({ sessionId: 1, setNumber: 2, action: 'Hold' }) },
    ]
    expect(successRate(logs)).toBe('100%')
  })

  it('no Hold → "0%"', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, action: 'Failed' }) },
    ]
    expect(successRate(logs)).toBe('0%')
  })
})

// ---------------------------------------------------------------------------
// doneSkippedCount
// ---------------------------------------------------------------------------

describe('doneSkippedCount', () => {
  it('counts Done and Skipped actions', () => {
    const logs = [
      { setLog: makeSetLog({ sessionId: 1, setNumber: 1, action: 'Done' }) },
      { setLog: makeSetLog({ sessionId: 2, setNumber: 1, action: 'Done' }) },
      { setLog: makeSetLog({ sessionId: 3, setNumber: 1, action: 'Skipped' }) },
    ]
    expect(doneSkippedCount(logs)).toEqual({ done: 2, skipped: 1 })
  })

  it('returns zeros when logs is empty', () => {
    expect(doneSkippedCount([])).toEqual({ done: 0, skipped: 0 })
  })
})

// ---------------------------------------------------------------------------
// classifyConsistency
// ---------------------------------------------------------------------------

describe('classifyConsistency', () => {
  it('AE4: bodyweight all Complete → hit', () => {
    const logs = [
      makeSetLog({ sessionId: 1, setNumber: 1, action: 'Complete' }),
      makeSetLog({ sessionId: 1, setNumber: 2, action: 'Complete' }),
      makeSetLog({ sessionId: 1, setNumber: 3, action: 'Complete' }),
    ]
    expect(classifyConsistency(logs, 'bodyweight')).toBe('hit')
  })

  it('weighted all Complete → hit', () => {
    const logs = [
      makeSetLog({ sessionId: 1, setNumber: 1, action: 'Complete' }),
      makeSetLog({ sessionId: 1, setNumber: 2, action: 'Complete' }),
    ]
    expect(classifyConsistency(logs, 'weighted')).toBe('hit')
  })

  it('weighted all Increment → hit', () => {
    const logs = [
      makeSetLog({ sessionId: 1, setNumber: 1, action: 'Increment' }),
      makeSetLog({ sessionId: 1, setNumber: 2, action: 'Increment' }),
    ]
    expect(classifyConsistency(logs, 'weighted')).toBe('hit')
  })

  it('weighted mixed Complete and Stay → hit', () => {
    const logs = [
      makeSetLog({ sessionId: 1, setNumber: 1, action: 'Complete' }),
      makeSetLog({ sessionId: 1, setNumber: 2, action: 'Stay' }),
    ]
    expect(classifyConsistency(logs, 'weighted')).toBe('hit')
  })

  it('AE4: time-based any Failed → partial', () => {
    const logs = [
      makeSetLog({ sessionId: 1, setNumber: 1, action: 'Hold' }),
      makeSetLog({ sessionId: 1, setNumber: 2, action: 'Failed' }),
    ]
    expect(classifyConsistency(logs, 'time-based')).toBe('partial')
  })

  it('time-based all Hold → hit', () => {
    const logs = [
      makeSetLog({ sessionId: 1, setNumber: 1, action: 'Hold' }),
      makeSetLog({ sessionId: 1, setNumber: 2, action: 'Hold' }),
    ]
    expect(classifyConsistency(logs, 'time-based')).toBe('hit')
  })

  it('AE4: cardio Done → done', () => {
    const logs = [makeSetLog({ sessionId: 1, setNumber: 1, action: 'Done' })]
    expect(classifyConsistency(logs, 'cardio')).toBe('done')
  })

  it('AE4: cardio Skipped → skipped', () => {
    const logs = [makeSetLog({ sessionId: 1, setNumber: 1, action: 'Skipped' })]
    expect(classifyConsistency(logs, 'cardio')).toBe('skipped')
  })
})

// ---------------------------------------------------------------------------
// groupSetLogsBySession
// ---------------------------------------------------------------------------

describe('groupSetLogsBySession', () => {
  it('groups by session id, preserving newest-first order', () => {
    const session1 = makeSession(1)
    const session2 = makeSession(2)

    // Input is newest-session-first (session 2 comes first in input)
    const rows = [
      {
        setLog: makeSetLog({ id: 3, sessionId: 2, setNumber: 1 }),
        session: session2,
      },
      {
        setLog: makeSetLog({ id: 4, sessionId: 2, setNumber: 2 }),
        session: session2,
      },
      {
        setLog: makeSetLog({ id: 1, sessionId: 1, setNumber: 1 }),
        session: session1,
      },
      {
        setLog: makeSetLog({ id: 2, sessionId: 1, setNumber: 2 }),
        session: session1,
      },
    ]

    const groups = groupSetLogsBySession(rows)

    expect(groups).toHaveLength(2)
    // First group is the newest session
    expect(groups.at(0)!.session.id).toBe(2)
    expect(groups.at(0)!.setLogs).toHaveLength(2)
    // Second group is older session
    expect(groups.at(1)!.session.id).toBe(1)
    expect(groups.at(1)!.setLogs).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(groupSetLogsBySession([])).toEqual([])
  })

  it('handles a single session with multiple set logs', () => {
    const session = makeSession(5)
    const rows = [
      { setLog: makeSetLog({ id: 1, sessionId: 5, setNumber: 1 }), session },
      { setLog: makeSetLog({ id: 2, sessionId: 5, setNumber: 2 }), session },
      { setLog: makeSetLog({ id: 3, sessionId: 5, setNumber: 3 }), session },
    ]
    const groups = groupSetLogsBySession(rows)
    expect(groups).toHaveLength(1)
    expect(groups.at(0)!.session.id).toBe(5)
    expect(groups.at(0)!.setLogs).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// shouldRenderWeightChart
// ---------------------------------------------------------------------------

describe('shouldRenderWeightChart', () => {
  const makeProgression = (id: number): ProgressionRow => ({
    id,
    exerciseId: 1,
    sessionId: null,
    startingWeight: 100 + id,
    reason: 'session_progression',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  })

  it('AE3: false for empty array', () => {
    expect(shouldRenderWeightChart([])).toBe(false)
  })

  it('AE3: false for one point', () => {
    expect(shouldRenderWeightChart([makeProgression(1)])).toBe(false)
  })

  it('AE3: true for two points', () => {
    expect(
      shouldRenderWeightChart([makeProgression(1), makeProgression(2)]),
    ).toBe(true)
  })

  it('true for three or more points', () => {
    expect(
      shouldRenderWeightChart([
        makeProgression(1),
        makeProgression(2),
        makeProgression(3),
      ]),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// hasLoggedSession
// ---------------------------------------------------------------------------

describe('hasLoggedSession', () => {
  it('returns false for empty logs', () => {
    expect(hasLoggedSession([])).toBe(false)
  })

  it('returns true when there is at least one log', () => {
    const session = makeSession(1)
    const logs = [
      {
        setLog: makeSetLog({ sessionId: 1, setNumber: 1 }),
        session,
      },
    ]
    expect(hasLoggedSession(logs)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// buildWeightTrendPoints
// ---------------------------------------------------------------------------

describe('buildWeightTrendPoints', () => {
  const makeProg = (
    id: number,
    startingWeight: number,
    effectiveFrom: Date,
  ): ProgressionRow => ({
    id,
    exerciseId: 1,
    sessionId: null,
    startingWeight,
    reason: 'session_progression',
    effectiveFrom,
  })

  it('returns an empty series when there are no progressions', () => {
    const logs = [{ session: makeSession(1) }]
    expect(buildWeightTrendPoints([], logs)).toEqual([])
  })

  it('maps progression rows to date/weight points', () => {
    const progs = [
      makeProg(1, 185, new Date('2026-04-30T00:00:00Z')),
      makeProg(2, 195, new Date('2026-05-21T00:00:00Z')),
    ]
    const points = buildWeightTrendPoints(progs, [])
    expect(points).toEqual([
      { date: new Date('2026-04-30T00:00:00Z'), weight: 185 },
      { date: new Date('2026-05-21T00:00:00Z'), weight: 195 },
    ])
  })

  it('carries the last weight forward when the newest session is later than the last progression', () => {
    const progs = [
      makeProg(1, 185, new Date('2026-04-30T00:00:00Z')),
      makeProg(2, 185, new Date('2026-05-21T00:00:00Z')),
    ]
    // A later "Stay" session created no progression row.
    const logs = [
      { session: makeSession(9, new Date('2026-05-28T00:00:00Z')) },
      { session: makeSession(8, new Date('2026-05-21T00:00:00Z')) },
    ]
    const points = buildWeightTrendPoints(progs, logs)
    expect(points).toHaveLength(3)
    expect(points.at(-1)).toEqual({
      date: new Date('2026-05-28T00:00:00Z'),
      weight: 185,
    })
  })

  it('does not append when the newest session coincides with the last progression', () => {
    const progs = [
      makeProg(1, 185, new Date('2026-04-30T00:00:00Z')),
      makeProg(2, 185, new Date('2026-05-21T00:00:00Z')),
    ]
    const logs = [{ session: makeSession(8, new Date('2026-05-21T00:00:00Z')) }]
    expect(buildWeightTrendPoints(progs, logs)).toHaveLength(2)
  })

  it('ignores sessions with a null completedAt', () => {
    const progs = [
      makeProg(1, 100, new Date('2026-04-30T00:00:00Z')),
      makeProg(2, 110, new Date('2026-05-21T00:00:00Z')),
    ]
    const logs = [{ session: makeSession(8, null) }]
    expect(buildWeightTrendPoints(progs, logs)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// weightTrendDomain
// ---------------------------------------------------------------------------

describe('weightTrendDomain', () => {
  it('returns a safe default for an empty series', () => {
    expect(weightTrendDomain([])).toEqual([0, 5])
  })

  it('does not anchor the lower bound at 0 for realistic lifting weights', () => {
    // Regression: a [0, max] domain pins the line to the top of the chart.
    const [lo] = weightTrendDomain([135, 135, 140])
    expect(lo).toBeGreaterThan(0)
  })

  it('frames a varying series with padding rounded to the nearest 5', () => {
    expect(weightTrendDomain([135, 140])).toEqual([130, 145])
  })

  it('opens a window around a flat series instead of collapsing it', () => {
    const [lo, hi] = weightTrendDomain([185, 185])
    expect(lo).toBeLessThan(185)
    expect(hi).toBeGreaterThan(185)
  })

  it('lo === hi guard: all-zero weights produce a non-zero-height domain', () => {
    expect(weightTrendDomain([0, 0])).toEqual([0, 5])
  })
})

// ---------------------------------------------------------------------------
// U1: estimatedOneRepMax
// ---------------------------------------------------------------------------

describe('estimatedOneRepMax', () => {
  it('185×3 → ~203.5 (Epley)', () => {
    expect(estimatedOneRepMax(185, 3)).toBeCloseTo(203.5, 1)
  })

  it('100×1 → 100 (identity for single-rep sets)', () => {
    expect(estimatedOneRepMax(100, 1)).toBe(100)
  })

  it('0 reps → identity weight', () => {
    expect(estimatedOneRepMax(135, 0)).toBe(135)
  })
})

// ---------------------------------------------------------------------------
// U1: countExercisesWithRecentPR
// ---------------------------------------------------------------------------

// 30 days = 30 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

// NOW is pinned to a mid-day instant.
const NOW = new Date('2026-05-29T12:00:00Z')
// Boundary of the 30-day window
const WINDOW_START = new Date(NOW.getTime() - THIRTY_DAYS_MS)

function makeWeightedSession(
  id: number,
  completedAt: Date,
  routineId = 1,
): SessionRow {
  return { id, routineId, startedAt: completedAt, completedAt }
}

function makeWeightedSetLog(
  overrides: Partial<SetLogRow> & {
    sessionId: number
    exerciseId: number
    setNumber: number
  },
): SetLogRow {
  return {
    id: overrides.id ?? overrides.setNumber + overrides.sessionId * 100,
    sessionId: overrides.sessionId,
    exerciseId: overrides.exerciseId,
    setNumber: overrides.setNumber,
    weight: overrides.weight ?? 100,
    targetReps: overrides.targetReps ?? 5,
    actualReps: overrides.actualReps ?? 5,
    durationSeconds: null,
    actualDurationSeconds: null,
    action: overrides.action ?? 'Complete',
    loggedAt: new Date(),
  }
}

describe('countExercisesWithRecentPR', () => {
  it('empty input → 0', () => {
    expect(countExercisesWithRecentPR([], NOW)).toBe(0)
  })

  it('AE1 happy: in-window set above pre-window baseline counts the exercise', () => {
    const preSession = makeWeightedSession(
      1,
      new Date(WINDOW_START.getTime() - 1000),
    )
    const inSession = makeWeightedSession(2, NOW)

    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 160,
          actualReps: 5,
        }),
        session: preSession,
      },
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 185,
          actualReps: 3,
        }),
        session: inSession,
      },
    ]
    // pre-window e1RM: 160×5 = 160×(1+5/30) ≈ 186.7
    // in-window e1RM: 185×3 = 185×1.1 = 203.5 > 186.7 → PR
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(1)
  })

  it('AE1 failed-set exclusion: Failed set with higher weight does not become a PR', () => {
    const preSession = makeWeightedSession(
      1,
      new Date(WINDOW_START.getTime() - 1000),
    )
    const inSession = makeWeightedSession(2, NOW)

    const logs = [
      // pre-window baseline: 160×5
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 160,
          actualReps: 5,
        }),
        session: preSession,
      },
      // in-window: eligible set below baseline
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 185,
          actualReps: 3,
        }),
        session: inSession,
      },
      // in-window: Failed set at 200lb — should be excluded
      {
        setLog: makeWeightedSetLog({
          id: 999,
          sessionId: 2,
          exerciseId: 1,
          setNumber: 2,
          weight: 200,
          actualReps: 1,
          action: 'Failed',
        }),
        session: inSession,
      },
    ]
    // pre-window e1RM: 160×5 ≈ 186.7
    // in-window eligible e1RM: 185×3 = 203.5 > 186.7 → PR regardless of failed set
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(1)
  })

  it('Failed-only in-window: does not count as PR', () => {
    const preSession = makeWeightedSession(
      1,
      new Date(WINDOW_START.getTime() - 1000),
    )
    const inSession = makeWeightedSession(2, NOW)

    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 160,
          actualReps: 5,
        }),
        session: preSession,
      },
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 200,
          actualReps: 1,
          action: 'Failed',
        }),
        session: inSession,
      },
    ]
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(0)
  })

  it('Decrement set excluded from eligibility', () => {
    const preSession = makeWeightedSession(
      1,
      new Date(WINDOW_START.getTime() - 1000),
    )
    const inSession = makeWeightedSession(2, NOW)

    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 100,
          actualReps: 5,
        }),
        session: preSession,
      },
      // Decrement at high weight — should be excluded from eligibility
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 300,
          actualReps: 5,
          action: 'Decrement',
        }),
        session: inSession,
      },
    ]
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(0)
  })

  it('in-window sets tie the pre-window baseline → not a PR (strict >)', () => {
    const preSession = makeWeightedSession(
      1,
      new Date(WINDOW_START.getTime() - 1000),
    )
    const inSession = makeWeightedSession(2, NOW)

    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 185,
          actualReps: 3,
        }),
        session: preSession,
      },
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 185,
          actualReps: 3,
        }),
        session: inSession,
      },
    ]
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(0)
  })

  it('first-ever single in-window set → not a PR (lone baseline)', () => {
    const inSession = makeWeightedSession(1, NOW)
    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 135,
          actualReps: 5,
        }),
        session: inSession,
      },
    ]
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(0)
  })

  it('review 2A: entire history is two in-window sessions → counts as PR (young exercise)', () => {
    const s1 = makeWeightedSession(
      1,
      new Date(NOW.getTime() - 15 * 24 * 60 * 60 * 1000),
    )
    const s2 = makeWeightedSession(2, NOW)

    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 100,
          actualReps: 5,
        }),
        session: s1,
      },
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 110,
          actualReps: 5,
        }),
        session: s2,
      },
    ]
    // earliest in-window e1RM (s1): 100×(1+5/30) ≈ 116.7
    // max in-window e1RM (s2): 110×(1+5/30) ≈ 128.3 > 116.7 → PR
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(1)
  })

  it('only Failed/Decrement/null-weight in-window → 0, no throw', () => {
    const inSession = makeWeightedSession(1, NOW)
    const logs = [
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 200,
          actualReps: 1,
          action: 'Failed',
        }),
        session: inSession,
      },
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 2,
          setNumber: 1,
          weight: 150,
          actualReps: 3,
          action: 'Decrement',
        }),
        session: inSession,
      },
    ]
    expect(() => countExercisesWithRecentPR(logs, NOW)).not.toThrow()
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(0)
  })

  it('counts distinct exercises (not sets)', () => {
    const pre = makeWeightedSession(1, new Date(WINDOW_START.getTime() - 1000))
    const inSess = makeWeightedSession(2, NOW)

    const logs = [
      // Exercise 1: pre + in-window PR
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 1,
          setNumber: 1,
          weight: 100,
          actualReps: 5,
        }),
        session: pre,
      },
      {
        setLog: makeWeightedSetLog({
          sessionId: 2,
          exerciseId: 1,
          setNumber: 1,
          weight: 120,
          actualReps: 5,
        }),
        session: inSess,
      },
      // Exercise 2: only pre-window, no in-window → not a PR
      {
        setLog: makeWeightedSetLog({
          sessionId: 1,
          exerciseId: 2,
          setNumber: 1,
          weight: 200,
          actualReps: 5,
        }),
        session: pre,
      },
    ]
    expect(countExercisesWithRecentPR(logs, NOW)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// U2: classifyTrend
// ---------------------------------------------------------------------------

const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000

function makeProgression(
  id: number,
  startingWeight: number,
  effectiveFrom: Date,
  exerciseId = 1,
): ProgressionRow {
  return {
    id,
    exerciseId,
    sessionId: null,
    startingWeight,
    reason: 'session_progression',
    effectiveFrom,
  }
}

describe('classifyTrend', () => {
  const trendNow = new Date('2026-05-29T12:00:00Z')
  const windowStart = new Date(trendNow.getTime() - TWENTY_EIGHT_DAYS_MS)

  it('AE2 up: progression increases within window', () => {
    const progs = [
      makeProgression(1, 90, new Date(windowStart.getTime() - 1000)), // pre-window baseline = 90
      makeProgression(2, 95, trendNow), // current = 95
    ]
    expect(classifyTrend(progs, trendNow)).toBe('up')
  })

  it('AE2 flat: no change in window (baseline = current)', () => {
    const progs = [
      makeProgression(1, 90, new Date(windowStart.getTime() - 1000)),
      // no in-window progressions
    ]
    expect(classifyTrend(progs, trendNow)).toBe('flat')
  })

  it('plateaued-but-heavy lift whose last change predates window → flat', () => {
    // All progressions are pre-window; no in-window change
    const progs = [
      makeProgression(1, 185, new Date(windowStart.getTime() - 2000)),
      makeProgression(2, 190, new Date(windowStart.getTime() - 1000)),
    ]
    expect(classifyTrend(progs, trendNow)).toBe('flat')
  })

  it('decrement in-window → down', () => {
    const progs = [
      makeProgression(1, 95, new Date(windowStart.getTime() - 1000)), // baseline = 95
      makeProgression(2, 90, trendNow), // current = 90
    ]
    expect(classifyTrend(progs, trendNow)).toBe('down')
  })

  it('single in-window progression, no prior → flat', () => {
    const progs = [makeProgression(1, 135, trendNow)]
    expect(classifyTrend(progs, trendNow)).toBe('flat')
  })

  it('oscillation up-then-down ending below baseline → down (endpoint comparison)', () => {
    const progs = [
      makeProgression(1, 100, new Date(windowStart.getTime() - 1000)), // baseline = 100
      makeProgression(
        2,
        110,
        new Date(trendNow.getTime() - 7 * 24 * 60 * 60 * 1000),
      ), // peak 110
      makeProgression(3, 95, trendNow), // current = 95
    ]
    expect(classifyTrend(progs, trendNow)).toBe('down')
  })

  it('empty progressions → flat', () => {
    expect(classifyTrend([], trendNow)).toBe('flat')
  })

  it('boundary: progression exactly at window start is in-window (half-open [start, now])', () => {
    // effectiveFrom === windowStart → in-window (not pre-window)
    // No pre-window progressions, 1 in-window → flat (single in-window)
    const progs = [makeProgression(1, 100, windowStart)]
    expect(classifyTrend(progs, trendNow)).toBe('flat')
  })
})

// ---------------------------------------------------------------------------
// U3: maxScheduledGap
// ---------------------------------------------------------------------------

describe('maxScheduledGap', () => {
  it('empty days → 0', () => {
    expect(maxScheduledGap([])).toBe(0)
  })

  it('single day → 7 (full week cycle)', () => {
    expect(maxScheduledGap(['mon'])).toBe(7)
  })

  it('mon/thu → 4 (largest gap is thu→mon wrapping 4 days)', () => {
    expect(maxScheduledGap(['mon', 'thu'])).toBe(4)
  })

  it('mon/tue/wed → 5 (largest gap is wed→mon wrapping 5 days)', () => {
    expect(maxScheduledGap(['mon', 'tue', 'wed'])).toBe(5)
  })

  it('mon/fri → 4 (mon→fri=4, fri→mon=3)', () => {
    expect(maxScheduledGap(['mon', 'fri'])).toBe(4)
  })

  it('order of input does not matter', () => {
    expect(maxScheduledGap(['fri', 'mon'])).toBe(
      maxScheduledGap(['mon', 'fri']),
    )
  })
})

// ---------------------------------------------------------------------------
// U3: expectedSessions
// ---------------------------------------------------------------------------

describe('expectedSessions', () => {
  it('AE3: routine ≥4 weeks old, 2×/wk → expected = 8', () => {
    const createdAt = new Date(NOW.getTime() - 5 * 7 * 24 * 60 * 60 * 1000)
    const result = expectedSessions([{ days: ['mon', 'thu'], createdAt }], NOW)
    expect(result).toBe(8)
  })

  it('review 1A: routine created 10 days ago, 3×/wk → expected < 4 (age-clamped)', () => {
    const createdAt = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000)
    const result = expectedSessions(
      [{ days: ['mon', 'tue', 'wed'], createdAt }],
      NOW,
    )
    // 10 days ≈ 1.43 weeks → min(4, 1.43) = 1.43 → 3 × 1.43 ≈ 4.29
    expect(result).toBeGreaterThan(4)
    expect(result).toBeLessThan(5)
  })

  it('empty days → 0 expected', () => {
    const createdAt = new Date(NOW.getTime() - 5 * 7 * 24 * 60 * 60 * 1000)
    const result = expectedSessions([{ days: [], createdAt }], NOW)
    expect(result).toBe(0)
  })

  it('empty routine list → 0', () => {
    expect(expectedSessions([], NOW)).toBe(0)
  })

  it('sums across multiple routines', () => {
    const old = new Date(NOW.getTime() - 8 * 7 * 24 * 60 * 60 * 1000)
    const result = expectedSessions(
      [
        { days: ['mon', 'thu'], createdAt: old }, // 2×/wk × 4 = 8
        { days: ['tue', 'fri'], createdAt: old }, // 2×/wk × 4 = 8
      ],
      NOW,
    )
    expect(result).toBe(16)
  })
})

// ---------------------------------------------------------------------------
// U3: consistencyPct
// ---------------------------------------------------------------------------

describe('consistencyPct', () => {
  it('AE3: 6 completed / 8 expected → 75', () => {
    expect(consistencyPct(6, 8)).toBe(75)
  })

  it('caps at 100 when completed > expected', () => {
    expect(consistencyPct(10, 8)).toBe(100)
  })

  it('expected = 0 → null (no divide-by-zero)', () => {
    expect(consistencyPct(4, 0)).toBeNull()
  })

  it('rounds to nearest integer', () => {
    // 5/7 = 71.43% → 71
    expect(consistencyPct(5, 7)).toBe(71)
  })
})

// ---------------------------------------------------------------------------
// U3: sessionsThisWeek
// ---------------------------------------------------------------------------

describe('sessionsThisWeek', () => {
  const swNow = new Date('2026-05-29T12:00:00Z')
  const SEVEN_MS = 7 * 24 * 60 * 60 * 1000

  function makeCompletedSession(id: number, completedAt: Date): SessionRow {
    return { id, routineId: 1, startedAt: completedAt, completedAt }
  }

  it('5 this week, 3 prior → {count:5, delta:+2}', () => {
    const sessions: SessionRow[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeCompletedSession(
          i + 1,
          new Date(swNow.getTime() - i * 24 * 60 * 60 * 1000),
        ),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeCompletedSession(
          i + 10,
          new Date(swNow.getTime() - SEVEN_MS - i * 24 * 60 * 60 * 1000),
        ),
      ),
    ]
    const result = sessionsThisWeek(sessions, swNow)
    expect(result.count).toBe(5)
    expect(result.delta).toBe(2)
  })

  it('prior week 0 → delta = +count', () => {
    const sessions: SessionRow[] = [
      makeCompletedSession(1, swNow),
      makeCompletedSession(
        2,
        new Date(swNow.getTime() - 3 * 24 * 60 * 60 * 1000),
      ),
    ]
    const result = sessionsThisWeek(sessions, swNow)
    expect(result.count).toBe(2)
    expect(result.delta).toBe(2)
  })

  it('this week < prior → negative delta', () => {
    const sessions: SessionRow[] = [
      makeCompletedSession(1, swNow),
      ...Array.from({ length: 4 }, (_, i) =>
        makeCompletedSession(
          i + 10,
          new Date(swNow.getTime() - SEVEN_MS - i * 24 * 60 * 60 * 1000),
        ),
      ),
    ]
    const result = sessionsThisWeek(sessions, swNow)
    expect(result.count).toBe(1)
    expect(result.delta).toBe(-3)
  })

  it('empty → {count:0, delta:0}', () => {
    expect(sessionsThisWeek([], swNow)).toEqual({ count: 0, delta: 0 })
  })
})

// ---------------------------------------------------------------------------
// U3: overdueScore
// ---------------------------------------------------------------------------

describe('overdueScore', () => {
  const odNow = new Date('2026-05-29T12:00:00Z')

  it('never performed → null', () => {
    expect(overdueScore(null, ['mon', 'thu'], odNow)).toBeNull()
  })

  it('empty days → null', () => {
    const lastDone = new Date(odNow.getTime() - 24 * 24 * 60 * 60 * 1000)
    expect(overdueScore(lastDone, [], odNow)).toBeNull()
  })

  it('AE4 OHP: mon/thu (maxGap=4), 24d since → score ≈ 6', () => {
    const lastDone = new Date(odNow.getTime() - 24 * 24 * 60 * 60 * 1000)
    const score = overdueScore(lastDone, ['mon', 'thu'], odNow)
    expect(score).not.toBeNull()
    expect(score!).toBeCloseTo(6, 0)
  })

  it('AE4 Deadlift: 1×/wk (maxGap=7), 17d since → score ≈ 2.4', () => {
    const lastDone = new Date(odNow.getTime() - 17 * 24 * 60 * 60 * 1000)
    const score = overdueScore(lastDone, ['thu'], odNow)
    expect(score).not.toBeNull()
    expect(score!).toBeCloseTo(17 / 7, 1)
  })
})

// ---------------------------------------------------------------------------
// U3: selectNeedsAttention
// ---------------------------------------------------------------------------

describe('selectNeedsAttention', () => {
  const saNow = new Date('2026-05-29T12:00:00Z')

  it('AE4: OHP above Deadlift, Face Pull in notStarted', () => {
    const items = [
      {
        id: 1,
        name: 'OHP',
        days: ['mon', 'thu'] as const,
        lastPerformedAt: new Date(saNow.getTime() - 24 * 24 * 60 * 60 * 1000),
      },
      {
        id: 2,
        name: 'Deadlift',
        days: ['thu'] as const,
        lastPerformedAt: new Date(saNow.getTime() - 17 * 24 * 60 * 60 * 1000),
      },
      {
        id: 3,
        name: 'Face Pull',
        days: ['mon', 'wed', 'fri'] as const,
        lastPerformedAt: null,
      },
    ]
    const { overdue, notStarted } = selectNeedsAttention(items, saNow)
    expect(overdue.map(e => e.name)).toEqual(['OHP', 'Deadlift'])
    expect(notStarted.map(e => e.name)).toEqual(['Face Pull'])
  })

  it('review 4A: on-cadence weekend (mon/tue/wed, maxGap=5, last 5d ago) → not flagged', () => {
    const items = [
      {
        id: 1,
        name: 'Bench',
        days: ['mon', 'tue', 'wed'] as const,
        lastPerformedAt: new Date(saNow.getTime() - 5 * 24 * 60 * 60 * 1000),
      },
    ]
    const { overdue } = selectNeedsAttention(items, saNow)
    // score = 5/5 = 1.0 ≤ 2 → not overdue
    expect(overdue).toHaveLength(0)
  })

  it('caps overdue list at 3', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      name: `Exercise ${i + 1}`,
      days: ['mon'] as const,
      lastPerformedAt: new Date(
        saNow.getTime() - (30 + i) * 24 * 60 * 60 * 1000,
      ),
    }))
    const { overdue } = selectNeedsAttention(items, saNow)
    expect(overdue.length).toBeLessThanOrEqual(3)
  })

  it('tie-break by id asc', () => {
    // Two exercises with identical score (same days and days-since)
    const lastDone = new Date(saNow.getTime() - 21 * 24 * 60 * 60 * 1000)
    const items = [
      { id: 5, name: 'B', days: ['thu'] as const, lastPerformedAt: lastDone },
      { id: 2, name: 'A', days: ['thu'] as const, lastPerformedAt: lastDone },
    ]
    const { overdue } = selectNeedsAttention(items, saNow)
    expect(overdue.map(e => e.id)).toEqual([2, 5])
  })

  it('days:[] exercise not in overdue', () => {
    const items = [
      {
        id: 1,
        name: 'Free',
        days: [] as const,
        lastPerformedAt: new Date(saNow.getTime() - 30 * 24 * 60 * 60 * 1000),
      },
    ]
    const { overdue } = selectNeedsAttention(items, saNow)
    expect(overdue).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// U3: resolveStatsScope
// ---------------------------------------------------------------------------

type RoutineMeta = { id: number; archivedAt: Date | null; hasHistory: boolean }

function makeRoutineMeta(
  id: number,
  archivedAt: Date | null = null,
  hasHistory = false,
): RoutineMeta {
  return { id, archivedAt, hasHistory }
}

describe('resolveStatsScope', () => {
  const routines = [
    makeRoutineMeta(1, null), // active
    makeRoutineMeta(2, null), // active
    makeRoutineMeta(3, new Date(), true), // archived with history
    makeRoutineMeta(4, new Date(), false), // archived without history
  ]

  it('undefined param → all', () => {
    expect(resolveStatsScope(undefined, routines)).toEqual({ kind: 'all' })
  })

  it('non-numeric param → all', () => {
    expect(resolveStatsScope('abc', routines)).toEqual({ kind: 'all' })
  })

  it('negative param → all', () => {
    expect(resolveStatsScope('-1', routines)).toEqual({ kind: 'all' })
  })

  it('"0" → all', () => {
    expect(resolveStatsScope('0', routines)).toEqual({ kind: 'all' })
  })

  it('nonexistent id → all', () => {
    expect(resolveStatsScope('999', routines)).toEqual({ kind: 'all' })
  })

  it('archived-without-history id → all', () => {
    expect(resolveStatsScope('4', routines)).toEqual({ kind: 'all' })
  })

  it('active id → active', () => {
    expect(resolveStatsScope('1', routines)).toEqual({ kind: 'active', id: 1 })
  })

  it('archived-with-history id → archived', () => {
    expect(resolveStatsScope('3', routines)).toEqual({
      kind: 'archived',
      id: 3,
    })
  })
})

// ---------------------------------------------------------------------------
// Scope selector helpers (U2)
// ---------------------------------------------------------------------------

function makeRoutine(id: number, name: string): RoutineRow {
  return {
    id,
    name,
    days: ['mon', 'wed', 'fri'],
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

describe('shouldRenderScopeSelector', () => {
  it('(0,0) → false', () => expect(shouldRenderScopeSelector(0, 0)).toBe(false))
  it('(1,0) → false', () => expect(shouldRenderScopeSelector(1, 0)).toBe(false))
  it('(2,0) → true', () => expect(shouldRenderScopeSelector(2, 0)).toBe(true))
  it('(1,1) → true', () => expect(shouldRenderScopeSelector(1, 1)).toBe(true))
  it('(0,1) → true', () => expect(shouldRenderScopeSelector(0, 1)).toBe(true))
  it('(3,0) → true', () => expect(shouldRenderScopeSelector(3, 0)).toBe(true))
})

describe('buildScopeChips', () => {
  const push = makeRoutine(1, 'Push')
  const pull = makeRoutine(2, 'Pull')
  const legs = makeRoutine(3, 'Legs')
  const archived = makeRoutine(10, 'Old Push')

  it('scope=all: All selected, active unselected, no archived chip, correct hrefs', () => {
    const chips = buildScopeChips([push, pull], [], { kind: 'all' })
    expect(chips).toHaveLength(3)
    expect(chips[0]).toMatchObject({
      kind: 'all',
      selected: true,
      href: '/stats',
      routineId: null,
    })
    expect(chips[1]).toMatchObject({
      kind: 'active',
      routineId: 1,
      selected: false,
      href: '/stats?routine=1',
    })
    expect(chips[2]).toMatchObject({
      kind: 'active',
      routineId: 2,
      selected: false,
    })
  })

  it('scope=active id: matching chip selected, others unselected, no archived chip', () => {
    const chips = buildScopeChips([push, pull, legs], [], {
      kind: 'active',
      id: 2,
    })
    expect(chips.filter(c => c.selected)).toHaveLength(1)
    expect(chips.find(c => c.routineId === 2)?.selected).toBe(true)
    expect(chips.find(c => c.kind === 'archived')).toBeUndefined()
  })

  it('scope=archived: All + active unselected, archived chip selected, last in array', () => {
    const chips = buildScopeChips([push, pull], [archived], {
      kind: 'archived',
      id: 10,
    })
    const archivedChip = chips[chips.length - 1]!
    expect(archivedChip.kind).toBe('archived')
    expect(archivedChip.selected).toBe(true)
    expect(archivedChip.routineId).toBe(10)
    expect(
      chips.filter(c => c.kind !== 'archived').every(c => !c.selected),
    ).toBe(true)
  })

  it('exactly one selected chip across all scope kinds', () => {
    const checkExactlyOne = (chips: ReturnType<typeof buildScopeChips>) =>
      expect(chips.filter(c => c.selected)).toHaveLength(1)
    checkExactlyOne(buildScopeChips([push, pull], [], { kind: 'all' }))
    checkExactlyOne(
      buildScopeChips([push, pull], [], { kind: 'active', id: 1 }),
    )
    checkExactlyOne(
      buildScopeChips([push, pull], [archived], { kind: 'archived', id: 10 }),
    )
  })

  it('AE2 follow-through: scope=active after archived → no archived chip', () => {
    const chips = buildScopeChips([push, pull], [archived], {
      kind: 'active',
      id: 1,
    })
    expect(chips.find(c => c.kind === 'archived')).toBeUndefined()
  })

  it('defensive: scope=archived with id absent from archivedWithHistory → no archived chip appended', () => {
    const chips = buildScopeChips([push], [], { kind: 'archived', id: 999 })
    expect(chips.find(c => c.kind === 'archived')).toBeUndefined()
  })
})

describe('orderArchivedByRecency', () => {
  const a = makeRoutine(1, 'Alpha')
  const b = makeRoutine(2, 'Beta')
  const c = makeRoutine(3, 'Gamma')

  it('newest-first by last trained date', () => {
    const map = new Map([
      [1, new Date('2026-01-01T00:00:00Z')],
      [2, new Date('2026-05-01T00:00:00Z')],
      [3, new Date('2026-03-01T00:00:00Z')],
    ])
    const result = orderArchivedByRecency([a, b, c], map)
    expect(result.map(r => r.id)).toEqual([2, 3, 1])
  })

  it('equal-date tie → name ascending', () => {
    const date = new Date('2026-05-01T00:00:00Z')
    const map = new Map([
      [1, date],
      [2, date],
    ])
    const result = orderArchivedByRecency([b, a], map)
    expect(result.map(r => r.name)).toEqual(['Alpha', 'Beta'])
  })

  it('missing from map → sorts last', () => {
    const map = new Map([[2, new Date('2026-05-01T00:00:00Z')]])
    const result = orderArchivedByRecency([a, b, c], map)
    expect(result[0]!.id).toBe(2)
    // a and c have no map entry, both go last (sorted by name)
    const tail = result.slice(1).map(r => r.name)
    expect(tail).toEqual(['Alpha', 'Gamma'])
  })

  it('empty input → []', () => {
    expect(orderArchivedByRecency([], new Map())).toEqual([])
  })
})

describe('selectVisibleArchived', () => {
  const items = Array.from({ length: 15 }, (_, i) =>
    makeRoutine(i + 1, `Routine ${String(i + 1).padStart(2, '0')}`),
  )

  it('empty query → first ARCHIVED_RECENT_CAP items', () => {
    const result = selectVisibleArchived(items, '', ARCHIVED_RECENT_CAP)
    expect(result).toHaveLength(ARCHIVED_RECENT_CAP)
    expect(result[0]!.id).toBe(1)
  })

  it('fewer than cap → returns all', () => {
    const small = items.slice(0, 5)
    expect(selectVisibleArchived(small, '', ARCHIVED_RECENT_CAP)).toHaveLength(
      5,
    )
  })

  it('whitespace-only query → treated as empty (recent slice)', () => {
    const result = selectVisibleArchived(items, '   ', ARCHIVED_RECENT_CAP)
    expect(result).toHaveLength(ARCHIVED_RECENT_CAP)
  })

  it('non-empty query → all case-insensitive matches, bypasses cap', () => {
    const big = Array.from({ length: 40 }, (_, i) =>
      makeRoutine(i + 1, i < 12 ? `Leg Day ${i + 1}` : `Push Day ${i + 1}`),
    )
    const result = selectVisibleArchived(big, 'leg', ARCHIVED_RECENT_CAP)
    expect(result).toHaveLength(12)
  })

  it('no match → []', () => {
    expect(selectVisibleArchived(items, 'zzz', ARCHIVED_RECENT_CAP)).toEqual([])
  })

  it('cap boundary: exactly cap items → all cap', () => {
    const exact = items.slice(0, ARCHIVED_RECENT_CAP)
    expect(selectVisibleArchived(exact, '', ARCHIVED_RECENT_CAP)).toHaveLength(
      ARCHIVED_RECENT_CAP,
    )
  })

  it('cap boundary: cap+1 items → cap returned', () => {
    const extra = items.slice(0, ARCHIVED_RECENT_CAP + 1)
    expect(selectVisibleArchived(extra, '', ARCHIVED_RECENT_CAP)).toHaveLength(
      ARCHIVED_RECENT_CAP,
    )
  })
})
