import type { Exercise, NextTarget } from 'src/core/session-machine'
import {
  formatBannerSubtitle,
  formatCardioDuration,
  formatDayCodes,
  formatNextUpLine,
  formatRecentSessionDate,
  formatTimeBasedDuration,
  getCurrentDayCode,
  mapArchiveRoutineError,
  mapCreateRoutineError,
  mapStartSessionError,
} from 'src/lib/format'

// All test dates are pinned to specific instants so the suite passes
// regardless of the runtime TZ (CI runs UTC; the dev container runs PT).
// Mid-day instants keep the day-of-week stable across PT/UTC.

describe('getCurrentDayCode', () => {
  it('returns the day code for Monday', () => {
    expect(getCurrentDayCode(new Date('2026-05-25T12:00:00-07:00'))).toBe('mon')
  })

  it('returns the day code for Sunday', () => {
    expect(getCurrentDayCode(new Date('2026-05-31T12:00:00-07:00'))).toBe('sun')
  })

  it('covers every day-of-week index', () => {
    expect(getCurrentDayCode(new Date('2026-05-26T12:00:00Z'))).toBe('tue')
    expect(getCurrentDayCode(new Date('2026-05-27T12:00:00Z'))).toBe('wed')
    expect(getCurrentDayCode(new Date('2026-05-28T12:00:00Z'))).toBe('thu')
    expect(getCurrentDayCode(new Date('2026-05-29T12:00:00Z'))).toBe('fri')
    expect(getCurrentDayCode(new Date('2026-05-30T12:00:00Z'))).toBe('sat')
  })
})

describe('formatDayCodes', () => {
  it('marks today and preserves input order', () => {
    expect(formatDayCodes(['mon', 'wed', 'fri'], 'mon')).toEqual([
      { code: 'mon', label: 'Mon', isToday: true },
      { code: 'wed', label: 'Wed', isToday: false },
      { code: 'fri', label: 'Fri', isToday: false },
    ])
  })

  it('returns all isToday: false when today is null', () => {
    const result = formatDayCodes(['mon', 'wed', 'fri'], null)
    expect(result.every(r => r.isToday === false)).toBe(true)
  })

  it('returns all isToday: false when today is not in the days list', () => {
    const result = formatDayCodes(['tue', 'thu'], 'mon')
    expect(result.every(r => r.isToday === false)).toBe(true)
  })
})

describe('formatTimeBasedDuration', () => {
  it('renders zero seconds', () => {
    expect(formatTimeBasedDuration(0)).toBe('0s')
  })

  it('keeps the second-form past a minute', () => {
    expect(formatTimeBasedDuration(60)).toBe('60s')
  })
})

describe('formatCardioDuration', () => {
  it('rounds 60 seconds to 1 minute', () => {
    expect(formatCardioDuration(60)).toBe('1 min')
  })

  it('renders zero seconds as 0 min', () => {
    expect(formatCardioDuration(0)).toBe('0 min')
  })

  it('rounds 90 seconds to 2 min (half rounds up)', () => {
    expect(formatCardioDuration(90)).toBe('2 min')
  })

  it('rounds 1800 seconds to 30 min', () => {
    expect(formatCardioDuration(1800)).toBe('30 min')
  })
})

describe('formatNextUpLine', () => {
  it('formats a weighted exercise (AE1)', () => {
    const ex: Exercise = {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 105,
      increment: 5,
    }
    expect(formatNextUpLine(ex)).toBe('Bench Press · 3×10 @ 105 lb')
  })

  it('formats a bodyweight exercise (AE2)', () => {
    const ex: Exercise = {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    }
    expect(formatNextUpLine(ex)).toBe('Pushups · 3×15')
  })

  it('formats a time-based exercise (AE3)', () => {
    const ex: Exercise = {
      name: 'Plank',
      type: 'time-based',
      sets: 3,
      durationSeconds: 30,
    }
    expect(formatNextUpLine(ex)).toBe('Plank · 3×30s')
  })

  it('formats a cardio exercise (AE4)', () => {
    const ex: Exercise = {
      name: 'Run',
      type: 'cardio',
      sets: 1,
      durationSeconds: 1800,
    }
    expect(formatNextUpLine(ex)).toBe('Run · 30 min')
  })
})

describe('formatBannerSubtitle', () => {
  it('formats a weighted target (AE6)', () => {
    const ex: Exercise = {
      name: 'Bench Press',
      type: 'weighted',
      sets: 3,
      targetReps: 10,
      startingWeight: 105,
      increment: 5,
    }
    const target: NextTarget = {
      weight: 105,
      reps: 10,
      exerciseIdx: 0,
      setIdx: 1,
    }
    expect(formatBannerSubtitle(ex, target)).toBe(
      'Bench Press, set 2/3 · 105 lb × 10',
    )
  })

  it('formats a bodyweight target', () => {
    const ex: Exercise = {
      name: 'Pushups',
      type: 'bodyweight',
      sets: 3,
      targetReps: 15,
    }
    const target: NextTarget = { reps: 15, exerciseIdx: 1, setIdx: 0 }
    expect(formatBannerSubtitle(ex, target)).toBe('Pushups, set 1/3 · 15 reps')
  })

  it('formats a time-based target', () => {
    const ex: Exercise = {
      name: 'Plank',
      type: 'time-based',
      sets: 3,
      durationSeconds: 30,
    }
    const target: NextTarget = { duration: 30, exerciseIdx: 2, setIdx: 2 }
    expect(formatBannerSubtitle(ex, target)).toBe('Plank, set 3/3 · 30s')
  })

  it('formats a cardio target with hardcoded 1/1 set label', () => {
    const ex: Exercise = {
      name: 'Run',
      type: 'cardio',
      sets: 1,
      durationSeconds: 1800,
    }
    const target: NextTarget = { duration: 1800, exerciseIdx: 3, setIdx: 0 }
    expect(formatBannerSubtitle(ex, target)).toBe('Run, set 1/1 · 30 min')
  })
})

describe('formatRecentSessionDate', () => {
  // Use mid-UTC-day instants so the formatted weekday is the same in CI (UTC)
  // and locally (PT).
  it('returns the short weekday for sessions completed in the past 7 days', () => {
    const at = new Date('2026-05-27T12:00:00Z') // Wed
    const now = new Date('2026-05-30T12:00:00Z') // Sat, 3 days later
    expect(formatRecentSessionDate(at, now)).toBe('Wed')
  })

  it('returns short month + day for sessions older than 7 days', () => {
    const at = new Date('2026-05-19T12:00:00Z')
    const now = new Date('2026-05-27T12:00:00Z') // 8 days later
    expect(formatRecentSessionDate(at, now)).toBe('May 19')
  })

  it('returns the short weekday when just-completed (at === now)', () => {
    const at = new Date('2026-05-27T12:00:00Z') // Wed
    expect(formatRecentSessionDate(at, at)).toBe('Wed')
  })
})

describe('mapStartSessionError', () => {
  it('maps RoutineAlreadyHasActiveSession code to a warning toast', () => {
    const result = mapStartSessionError({
      ok: false,
      kind: 'conflict',
      code: 'RoutineAlreadyHasActiveSession',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/already in progress/)
  })

  it('maps RoutineArchived code to an error toast mentioning archived', () => {
    const result = mapStartSessionError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'RoutineArchived',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/archived/)
  })

  it('falls back to the generic message for an unknown code', () => {
    const result = mapStartSessionError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not start session/)
  })
})

describe('mapArchiveRoutineError', () => {
  it('maps ArchiveBlockedByActiveSession code to a warning toast', () => {
    const result = mapArchiveRoutineError({
      ok: false,
      kind: 'forbidden_transition',
      code: 'ArchiveBlockedByActiveSession',
    })
    expect(result.severity).toBe('warning')
    expect(result.message).toMatch(/session is in progress/)
  })

  it('falls back to the generic message for an unknown code', () => {
    const result = mapArchiveRoutineError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not archive routine/)
  })
})

describe('mapCreateRoutineError', () => {
  it('maps ValidationError code to a "check highlighted fields" message', () => {
    const result = mapCreateRoutineError({
      ok: false,
      kind: 'validation',
      code: 'ValidationError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/check the highlighted fields/i)
  })

  it('falls back to the generic message for an unknown code', () => {
    const result = mapCreateRoutineError({
      ok: false,
      kind: 'conflict',
      code: 'UnknownError',
    })
    expect(result.severity).toBe('error')
    expect(result.message).toMatch(/Could not create routine/)
  })
})
