import type {
  ProgressionRow,
  RoutineRow,
  SessionRow,
  SetLogRow,
} from 'src/db/types'
import type { StatsScope } from 'src/lib/stats'
import {
  classifyTrend,
  consistencyPct,
  countExercisesWithRecentPR,
  expectedSessions,
  sessionsThisWeek,
} from 'src/lib/stats'

import { StatTile } from './StatTile'

type LogEntry = { setLog: SetLogRow; session: SessionRow }

type Props = {
  scope: StatsScope
  routines: RoutineRow[]
  sessions: SessionRow[]
  weightedSetLogs: LogEntry[]
  progressionsByExercise: Map<number, ProgressionRow[]>
  now: Date
}

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `${delta}`
  return '0'
}

export function StatsHeader({
  scope,
  routines,
  sessions,
  weightedSetLogs,
  progressionsByExercise,
  now,
}: Props) {
  const isArchivedScope = scope.kind === 'archived'
  const totalSessions = sessions.length
  // Window numerator to the same 4 weeks that expectedSessions uses as denominator.
  const windowStartMs = now.getTime() - FOUR_WEEKS_MS
  const sessionsInWindow = sessions.filter(
    s => s.completedAt !== null && s.completedAt.getTime() >= windowStartMs,
  ).length

  // Cold-start: ≤1 completed session (only for non-archived scope)
  const isColdStart = !isArchivedScope && totalSessions <= 1

  // Transitional: >1 session but at least one routine has < 4 weeks history
  const isTransitional =
    !isArchivedScope &&
    !isColdStart &&
    routines.some(r => now.getTime() - r.createdAt.getTime() < FOUR_WEEKS_MS)

  // Tile A: Sessions this week (always computed honestly)
  const weekly = sessionsThisWeek(sessions, now)
  const weeklyDelta = weekly.delta !== 0 ? formatDelta(weekly.delta) : undefined
  const weeklyTrend =
    weekly.delta > 0 ? 'up' : weekly.delta < 0 ? 'down' : undefined

  // Tile B: Recent PRs (suppressed on cold-start; archived computes normally)
  const recentPRs = isColdStart
    ? null
    : countExercisesWithRecentPR(weightedSetLogs, now)

  // Tile C: Lifts progressing (suppressed on cold-start and archived scope)
  const liftsProgressing =
    isColdStart || isArchivedScope
      ? null
      : Array.from(progressionsByExercise.values()).filter(
          progs => classifyTrend(progs, now) === 'up',
        ).length

  // Tile D: Overall consistency (suppressed on cold-start and archived scope)
  const consistency =
    isColdStart || isArchivedScope
      ? null
      : consistencyPct(sessionsInWindow, expectedSessions(routines, now))

  const showCaption = isColdStart || isTransitional
  const caption = isColdStart
    ? 'Log a few sessions to build your stats'
    : 'Still building your 4-week trends'

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <StatTile
          hero
          label="Sessions this week"
          value={String(weekly.count)}
          delta={weeklyDelta}
          trend={weeklyTrend}
        />
        <StatTile
          label="Recent PRs"
          value={recentPRs !== null ? String(recentPRs) : '—'}
        />
        <StatTile
          label="Lifts progressing"
          value={liftsProgressing !== null ? String(liftsProgressing) : '—'}
          trend={
            liftsProgressing !== null && liftsProgressing > 0 ? 'up' : undefined
          }
        />
        <StatTile
          label="Overall consistency"
          value={consistency !== null ? `${consistency}%` : '—'}
        />
      </div>
      {showCaption && <p className="text-xs text-neutral-500">{caption}</p>}
    </div>
  )
}
