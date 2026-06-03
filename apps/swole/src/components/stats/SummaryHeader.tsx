import type { CompletedSessionLogEntry } from 'src/db/setLogs'
import type { ExerciseRow, RoutineRow } from 'src/db/types'
import {
  formatCardioDuration,
  formatTimeBasedDuration,
  formatWeight,
} from 'src/lib/format'
import {
  doneSkippedCount,
  heaviestLogged,
  lastResult,
  sessionsPerformed,
  successRate,
  topSetPlanned,
} from 'src/lib/stats'

import { ExerciseTypeBadge } from './ExerciseTypeBadge'
import { StatTile } from './StatTile'

// Discriminated union types that make nullable fields non-null when type matches.
type WeightedExerciseRow = Omit<ExerciseRow, 'startingWeight' | 'increment'> & {
  type: 'weighted'
  startingWeight: number
  increment: number
}

type TimeBasedExerciseRow = Omit<ExerciseRow, 'durationSeconds'> & {
  type: 'time-based'
  durationSeconds: number
}

type CardioExerciseRow = Omit<ExerciseRow, 'durationSeconds'> & {
  type: 'cardio'
  durationSeconds: number
}

function isWeighted(e: ExerciseRow): e is WeightedExerciseRow {
  return (
    e.type === 'weighted' && e.startingWeight !== null && e.increment !== null
  )
}

function isTimeBased(e: ExerciseRow): e is TimeBasedExerciseRow {
  return e.type === 'time-based' && e.durationSeconds !== null
}

function isCardio(e: ExerciseRow): e is CardioExerciseRow {
  return e.type === 'cardio' && e.durationSeconds !== null
}

type Props = {
  exercise: ExerciseRow
  routine: RoutineRow
  logs: CompletedSessionLogEntry[]
}

function WeightedTiles({
  exercise,
  logs,
}: {
  exercise: WeightedExerciseRow
  logs: CompletedSessionLogEntry[]
}) {
  const heaviest = heaviestLogged(logs)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile
        hero
        label="Current weight"
        value={formatWeight(exercise.startingWeight)}
      />
      <StatTile label="Increment" value={formatWeight(exercise.increment)} />
      <StatTile
        label="Sets × reps"
        value={`${exercise.sets}×${exercise.targetReps}`}
      />
      <StatTile
        label="Top set (planned)"
        value={formatWeight(
          topSetPlanned(
            exercise.startingWeight,
            exercise.increment,
            exercise.sets,
          ),
        )}
      />
      <StatTile
        label="Heaviest logged"
        value={heaviest !== null ? formatWeight(heaviest) : '—'}
      />
    </div>
  )
}

function BodyweightTiles({
  exercise,
  logs,
}: {
  exercise: ExerciseRow & { type: 'bodyweight' }
  logs: CompletedSessionLogEntry[]
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile
        hero
        label="Sets × reps"
        value={`${exercise.sets}×${exercise.targetReps}`}
      />
      <StatTile
        label="Sessions performed"
        value={String(sessionsPerformed(logs))}
      />
      <StatTile label="Last result" value={lastResult(logs) ?? '—'} />
    </div>
  )
}

function TimeBasedTiles({
  exercise,
  logs,
}: {
  exercise: TimeBasedExerciseRow
  logs: CompletedSessionLogEntry[]
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile
        hero
        label="Sets × duration"
        value={`${exercise.sets}×${formatTimeBasedDuration(exercise.durationSeconds)}`}
      />
      <StatTile
        label="Sessions performed"
        value={String(sessionsPerformed(logs))}
      />
      <StatTile label="Success rate" value={successRate(logs)} />
    </div>
  )
}

function CardioTiles({
  exercise,
  logs,
}: {
  exercise: CardioExerciseRow
  logs: CompletedSessionLogEntry[]
}) {
  const counts = doneSkippedCount(logs)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatTile
        hero
        label="Target duration"
        value={formatCardioDuration(exercise.durationSeconds)}
      />
      <StatTile label="Done" value={String(counts.done)} />
      <StatTile label="Skipped" value={String(counts.skipped)} />
    </div>
  )
}

export function SummaryHeader({ exercise, routine, logs }: Props) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/80 p-5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold leading-tight text-white">
            {exercise.name}
          </h1>
          <ExerciseTypeBadge type={exercise.type} />
          {exercise.archivedAt != null && (
            <span className="rounded-md bg-neutral-700 px-2 py-0.5 text-xs font-medium text-neutral-400">
              Archived
            </span>
          )}
        </div>
        <p className="text-sm text-neutral-400">{routine.name}</p>
      </div>

      {isWeighted(exercise) && (
        <WeightedTiles exercise={exercise} logs={logs} />
      )}
      {exercise.type === 'bodyweight' && (
        <BodyweightTiles
          exercise={exercise as ExerciseRow & { type: 'bodyweight' }}
          logs={logs}
        />
      )}
      {isTimeBased(exercise) && (
        <TimeBasedTiles exercise={exercise} logs={logs} />
      )}
      {isCardio(exercise) && <CardioTiles exercise={exercise} logs={logs} />}
    </div>
  )
}
