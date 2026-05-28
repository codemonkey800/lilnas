// Pure display-formatting helpers for the home page. No side effects, no
// `'use client'` or `'server-only'` — these are consumable from anywhere.
//
// `getCurrentDayCode` relies on the container's `TZ` env var (set in
// `infra/.env.swole`) for the right local day-of-week. A missing-TZ regression
// will not break this code, but will silently return the wrong day on UTC.

import type { Exercise, NextTarget } from 'src/core/session-machine'
import {
  ArchiveBlockedByActiveSession,
  DataLayerError,
  RoutineAlreadyHasActiveSession,
  RoutineArchived,
} from 'src/db/errors'
import { type DayCode } from 'src/db/schema'

const DAY_INDEX_TO_CODE: readonly DayCode[] = [
  'sun',
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
]

const DAY_LABELS: Record<DayCode, string> = {
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

export function mapStartSessionError(err: unknown): ErrorToast {
  if (err instanceof DataLayerError) {
    if (err instanceof RoutineAlreadyHasActiveSession) {
      return {
        message:
          'A session is already in progress for this routine — tap Resume above to continue.',
        severity: 'warning',
      }
    }
    if (err instanceof RoutineArchived) {
      return {
        message:
          'This routine has been archived — restore it to start a session.',
        severity: 'error',
      }
    }
  }
  return { message: 'Could not start session. Try again.', severity: 'error' }
}

export function mapArchiveRoutineError(err: unknown): ErrorToast {
  if (err instanceof ArchiveBlockedByActiveSession) {
    return {
      message:
        "Can't archive this routine — a session is in progress. Resume and finish it first.",
      severity: 'warning',
    }
  }
  return { message: 'Could not archive routine. Try again.', severity: 'error' }
}
