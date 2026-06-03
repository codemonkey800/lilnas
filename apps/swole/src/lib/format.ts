// Pure display-formatting helpers. No side effects, no `'use client'` or
// `'server-only'` — these are consumable from anywhere.
//
// `getCurrentDayCode` relies on the container's `TZ` env var (set in
// `infra/.env.swole`) for the right local day-of-week. A missing-TZ regression
// will not break this code, but will silently return the wrong day on UTC.

import type { Exercise, NextTarget } from 'src/core/session-machine'
import { type DataLayerErrorKind } from 'src/db/errors'
import { type DayCode } from 'src/db/schema'
import type { ExerciseRow, SetLogRow } from 'src/db/types'
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

export function formatExerciseConfig(exercise: Exercise): string {
  switch (exercise.type) {
    case 'weighted':
      return `${exercise.sets}×${exercise.targetReps} @ ${exercise.startingWeight} lb (+${exercise.increment})`
    case 'bodyweight':
      return `${exercise.sets}×${exercise.targetReps}`
    case 'time-based':
      return `${exercise.sets}×${formatTimeBasedDuration(exercise.durationSeconds)}`
    case 'cardio':
      return formatCardioDuration(exercise.durationSeconds)
  }
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

export type ActionError = { ok: false; kind: DataLayerErrorKind; code: string }

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

export function mapUpdateRoutineError(result: ActionError): ErrorToast {
  if (result.code === 'ValidationError') {
    return {
      message: 'Check the highlighted fields and try again.',
      severity: 'error',
    }
  }
  if (result.code === 'EditBlockedByActiveSession') {
    return {
      message:
        'This routine has a workout in progress — finish or abandon it first.',
      severity: 'warning',
    }
  }
  if (result.code === 'NotFoundError') {
    return {
      message: 'This routine no longer exists.',
      severity: 'warning',
    }
  }
  return { message: 'Could not save changes. Try again.', severity: 'error' }
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

// ---------------------------------------------------------------------------
// Stats-page formatters (R9, R18, R19)
// ---------------------------------------------------------------------------

/**
 * R9 / tile display — formats a weight value with the "lb" unit suffix.
 * e.g. formatWeight(105) → "105 lb"
 */
export function formatWeight(w: number): string {
  return `${w} lb`
}

// Threshold for switching from "Nw ago" to a calendar date string.
const EIGHT_WEEKS_DAYS = 56

/**
 * R16: Row recency label. Compares local calendar days (not rolling ms) so
 * "Today" and "Yesterday" align with the user's clock.
 *
 * - Same local calendar day → "Today"
 * - 1 day ago → "Yesterday"
 * - 2–13 days → "Nd ago"
 * - 14–55 days → "Nw ago" (floored weeks)
 * - ≥56 days → short date string ("May 19")
 *
 * Never-logged "—" is the caller's concern (pass a real Date or handle null
 * before calling this function).
 */
export function formatRelativeDay(at: Date, now: Date): string {
  // Compare local calendar days by constructing midnight-local of each date.
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const atMidnight = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  const dayDiff = Math.round(
    (nowMidnight.getTime() - atMidnight.getTime()) / (24 * 60 * 60 * 1000),
  )

  if (dayDiff <= 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 14) return `${dayDiff}d ago`
  if (dayDiff < EIGHT_WEEKS_DAYS) return `${Math.floor(dayDiff / 7)}w ago`

  return MONTH_DAY_FMT.format(at)
}

const JOURNAL_FMT = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

const JOURNAL_FMT_WITH_YEAR = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

/**
 * R18: Journal group header date.
 * Renders "Wed, May 27" for current-year dates; appends the year for past
 * (or future) years, e.g. "Tue, May 27, 2025".
 */
export function formatJournalSessionDate(at: Date): string {
  const currentYear = new Date().getFullYear()
  if (at.getFullYear() !== currentYear) {
    return JOURNAL_FMT_WITH_YEAR.format(at)
  }
  return JOURNAL_FMT.format(at)
}

/**
 * R19: Discriminated union enabling the journal component to render the
 * shortfall fraction in a different colour without component-level logic.
 */
export type SetRowParts =
  | { kind: 'plain'; text: string }
  | { kind: 'shortfall'; pre: string; fraction: string; post: string }

/**
 * R19: Formats a single set-log row for display in the history journal.
 *
 * - Weighted: "Set N — W × reps · action"
 *     Special case: Failed AND actualReps < targetReps → shortfall parts
 * - Bodyweight: "Set N — actual/target · action" (always plain)
 * - Time-based: "Set N — duration · action"
 *     Uses actualDurationSeconds when action is Failed
 * - Cardio: "duration · action" (no set number prefix)
 */
export function formatSetRow(
  setLog: SetLogRow,
  exercise: ExerciseRow,
): SetRowParts {
  const { setNumber, weight, actualReps, targetReps, action } = setLog

  switch (exercise.type) {
    case 'weighted': {
      const isFailed = action === 'Failed'
      const hasShortfall =
        isFailed &&
        actualReps !== null &&
        targetReps !== null &&
        actualReps < targetReps

      if (hasShortfall) {
        return {
          kind: 'shortfall',
          pre: `Set ${setNumber} — `,
          fraction: `${actualReps}/${targetReps}`,
          post: ` · ${action}`,
        }
      }

      return {
        kind: 'plain',
        text: `Set ${setNumber} — ${weight} × ${actualReps} · ${action}`,
      }
    }

    case 'bodyweight': {
      return {
        kind: 'plain',
        text: `Set ${setNumber} — ${actualReps}/${targetReps} · ${action}`,
      }
    }

    case 'time-based': {
      const usedSeconds =
        action === 'Failed' && setLog.actualDurationSeconds !== null
          ? setLog.actualDurationSeconds
          : (setLog.durationSeconds ?? 0)
      return {
        kind: 'plain',
        text: `Set ${setNumber} — ${formatTimeBasedDuration(usedSeconds)} · ${action}`,
      }
    }

    case 'cardio': {
      const seconds = setLog.durationSeconds ?? 0
      return {
        kind: 'plain',
        text: `${formatCardioDuration(seconds)} · ${action}`,
      }
    }
  }
}
