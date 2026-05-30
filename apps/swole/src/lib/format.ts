// Pure display-formatting helpers for the home page. No side effects, no
// `'use client'` or `'server-only'` — these are consumable from anywhere.
//
// `getCurrentDayCode` relies on the container's `TZ` env var (set in
// `infra/.env.swole`) for the right local day-of-week. A missing-TZ regression
// will not break this code, but will silently return the wrong day on UTC.

import type { Exercise, NextTarget } from 'src/core/session-machine'
import { type DataLayerErrorKind } from 'src/db/errors'
import { type DayCode } from 'src/db/schema'
import type { PreviousSetPeek } from 'src/lib/runner'

const DAY_INDEX_TO_CODE: readonly DayCode[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
]

export const DAY_LABELS: Record<DayCode, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function getCurrentDayCode(now: Date = new Date()): DayCode {
  // `Date.getDay()` reads the date in the JS runtime's local timezone, which
  // is set by the container's TZ env var. Maps 0=Sun..6=Sat to the schema's
  // DayCode union.
  return DAY_INDEX_TO_CODE[now.getDay()] as DayCode
}

export type DayCodeToken = {
  code: DayCode
  label: string
  isToday: boolean
}

export function formatDayCodes(
  days: DayCode[],
  today: DayCode | null,
): DayCodeToken[] {
  return days.map(code => ({
    code,
    label: DAY_LABELS[code],
    isToday: today != null && code === today,
  }))
}

export function formatTimeBasedDuration(seconds: number): string {
  return `${seconds}s`
}

export function formatCardioDuration(seconds: number): string {
  return `${Math.round(seconds / 60)} min`
}

export function formatNextUpLine(exercise: Exercise): string {
  switch (exercise.type) {
    case 'weighted':
      return `${exercise.name} · ${exercise.sets}×${exercise.targetReps} @ ${exercise.startingWeight} lb`
    case 'bodyweight':
      return `${exercise.name} · ${exercise.sets}×${exercise.targetReps}`
    case 'time-based':
      return `${exercise.name} · ${exercise.sets}×${formatTimeBasedDuration(exercise.durationSeconds)}`
    case 'cardio':
      return `${exercise.name} · ${formatCardioDuration(exercise.durationSeconds)}`
  }
}

export function formatBannerSubtitle(
  exercise: Exercise,
  target: NextTarget,
): string {
  const setLabel = `set ${target.setIdx + 1}/${exercise.sets}`
  switch (exercise.type) {
    case 'weighted':
      return `${exercise.name}, ${setLabel} · ${target.weight} lb × ${target.reps}`
    case 'bodyweight':
      return `${exercise.name}, ${setLabel} · ${target.reps} reps`
    case 'time-based':
      return `${exercise.name}, ${setLabel} · ${formatTimeBasedDuration(target.duration as number)}`
    case 'cardio':
      return `${exercise.name}, set ${target.setIdx + 1}/1 · ${formatCardioDuration(target.duration as number)}`
  }
}

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
const MONTH_DAY_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

export function formatRecentSessionDate(at: Date, now: Date): string {
  const diff = now.getTime() - at.getTime()
  if (diff < SEVEN_DAYS_MS) {
    return WEEKDAY_FMT.format(at)
  }
  return MONTH_DAY_FMT.format(at)
}

export type ErrorToast = {
  message: string
  severity: 'warning' | 'error'
}

type ActionError = { ok: false; kind: DataLayerErrorKind; code: string }

export function mapStartSessionError(result: ActionError): ErrorToast {
  if (result.code === 'RoutineAlreadyHasActiveSession') {
    return {
      message:
        'A session is already in progress for this routine — tap Resume above to continue.',
      severity: 'warning',
    }
  }
  if (result.code === 'RoutineArchived') {
    return {
      message:
        'This routine has been archived — restore it to start a session.',
      severity: 'error',
    }
  }
  return { message: 'Could not start session. Try again.', severity: 'error' }
}

export function mapArchiveRoutineError(result: ActionError): ErrorToast {
  if (result.code === 'ArchiveBlockedByActiveSession') {
    return {
      message:
        "Can't archive this routine — a session is in progress. Resume and finish it first.",
      severity: 'warning',
    }
  }
  return { message: 'Could not archive routine. Try again.', severity: 'error' }
}

export function mapCreateRoutineError(result: ActionError): ErrorToast {
  if (result.code === 'ValidationError') {
    return {
      message: 'Check the highlighted fields and try again.',
      severity: 'error',
    }
  }
  return { message: 'Could not create routine. Try again.', severity: 'error' }
}

// ─── Runner formatters ────────────────────────────────────────────────────────

// Big card target string for the current set.
export function formatRunnerTarget(
  exercise: Exercise,
  target: NextTarget,
): string {
  switch (exercise.type) {
    case 'weighted':
      return `${target.weight} lb × ${target.reps}`
    case 'bodyweight':
      return `${target.reps} reps`
    case 'time-based':
      return formatTimeBasedDuration(target.duration as number)
    case 'cardio':
      return formatCardioDuration(target.duration as number)
  }
}

// Formats the numeric next-weight computed by deriveButtonConfig into "→105".
export function formatWeightPreview(nextWeight: number): string {
  return `→${nextWeight}`
}

// Formats the previous-set peek struct into a display string.
export function formatPreviousSetPeek(
  peek: PreviousSetPeek,
  exercise: Exercise,
): string {
  switch (peek.kind) {
    case 'none':
      return ''
    case 'start':
      return `starting weight ${peek.startingWeight} lb`
    case 'log': {
      const actionLabel = peek.action.type
      switch (exercise.type) {
        case 'weighted':
          return `${peek.weight} lb × ${peek.actualReps ?? peek.reps} · ${actionLabel}`
        case 'bodyweight':
          return `${peek.actualReps ?? peek.reps} reps · ${actionLabel}`
        case 'time-based': {
          const dur = peek.actualDuration ?? peek.duration
          return `${formatTimeBasedDuration(dur as number)} · ${actionLabel}`
        }
        case 'cardio':
          return `${formatCardioDuration(peek.duration as number)} · ${actionLabel}`
      }
    }
  }
}

// ─── Reconciliation mappers ───────────────────────────────────────────────────

export type Reconciliation = {
  kind: 'rollback' | 'rehydrate' | 'halt'
  toast: ErrorToast
}

// Maps an appendSetLog result envelope to a reconciliation directive (R21).
export function mapSetLogError(result: ActionError): Reconciliation {
  if (result.code === 'DuplicateSetLog') {
    return {
      kind: 'rehydrate',
      toast: {
        message: 'Synced with your other tab.',
        severity: 'warning',
      },
    }
  }
  if (result.code === 'SessionAlreadyCompleted') {
    return {
      kind: 'halt',
      toast: {
        message: 'This session was completed elsewhere.',
        severity: 'warning',
      },
    }
  }
  return {
    kind: 'rollback',
    toast: {
      message: "Couldn't save that set. Try again.",
      severity: 'error',
    },
  }
}

// Maps an undoLastSetLog result envelope to a reconciliation directive.
export function mapUndoError(result: ActionError): Reconciliation {
  if (
    result.code === 'UndoBlockedBySessionCompleted' ||
    result.code === 'SessionAlreadyCompleted'
  ) {
    return {
      kind: 'halt',
      toast: {
        message: 'This session was completed elsewhere.',
        severity: 'warning',
      },
    }
  }
  if (result.code === 'UndoBlockedByCommittedProgression') {
    // Defensive — unreachable before F3, but classifiable rather than swallowed.
    return {
      kind: 'rollback',
      toast: {
        message: "Couldn't undo — a progression decision has been committed.",
        severity: 'error',
      },
    }
  }
  return {
    kind: 'rollback',
    toast: {
      message: "Couldn't undo that set. Try again.",
      severity: 'error',
    },
  }
}
