import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

import { ExerciseStatRow } from 'src/components/stats/ExerciseStatRow'
import {
  NeedsAttention,
  type NeedsAttentionItem,
} from 'src/components/stats/NeedsAttention'
import { ScopeSelector } from 'src/components/stats/ScopeSelector'
import { StatsHeader } from 'src/components/stats/StatsHeader'
import { getStatsIndexData } from 'src/db/stats'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams: Promise<{ routine?: string }>
}

export default async function StatsIndexPage({ searchParams }: PageProps) {
  const { routine: routineParam } = await searchParams
  const now = new Date()

  const data = await getStatsIndexData(routineParam)
  const {
    scope,
    routines,
    activeRoutines,
    exercises,
    sessions,
    lastPerformedByExercise,
    weightedSetLogs,
    progressionsByExercise,
    archivedWithHistory,
    archivedLastTrained,
  } = data

  const hasAnyExercise = exercises.length > 0

  if (!hasAnyExercise && activeRoutines.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <Typography component="h2" variant="h5" className="!font-bold">
          No exercises yet
        </Typography>
        <Typography component="p" variant="body2" color="text.secondary">
          Create a routine with exercises to start tracking your progress.
        </Typography>
        <Button href="/routines/new" variant="contained" size="large">
          Create a routine
        </Button>
      </div>
    )
  }

  // Build routine lookup map for group headers and NeedsAttention items.
  const routineById = new Map(routines.map(r => [r.id, r]))

  // Group exercises by routine, preserving the order returned by the data layer.
  const grouped = new Map<number, typeof exercises>()
  for (const exercise of exercises) {
    const group = grouped.get(exercise.routineId) ?? []
    group.push(exercise)
    grouped.set(exercise.routineId, group)
  }

  // NeedsAttention items: exercise with its routine's schedule.
  const needsAttentionItems: NeedsAttentionItem[] = exercises.map(e => {
    const routine = routineById.get(e.routineId)
    return {
      id: e.id,
      name: e.name,
      days: routine?.days ?? [],
      lastPerformedAt: lastPerformedByExercise.get(e.id) ?? null,
    }
  })

  return (
    <div className="flex flex-col gap-6 py-6">
      {/* Scope selector */}
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Stats</h1>
        <ScopeSelector
          activeRoutines={activeRoutines}
          archivedWithHistory={archivedWithHistory}
          archivedLastTrained={archivedLastTrained}
          scope={scope}
          now={now}
        />

        {/* Archived scope banner */}
        {scope.kind === 'archived' && (
          <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-orange-500">
              Archived
            </span>
            <span className="text-sm text-neutral-400">
              Viewing frozen history — this routine is no longer active.
            </span>
          </div>
        )}
      </div>

      {/* Portfolio header */}
      {exercises.length > 0 && (
        <StatsHeader
          scope={scope}
          routines={routines}
          sessions={sessions}
          weightedSetLogs={weightedSetLogs}
          progressionsByExercise={progressionsByExercise}
          now={now}
        />
      )}

      {/* Needs-attention section */}
      <NeedsAttention
        items={needsAttentionItems}
        scope={scope}
        completedSessionCount={sessions.length}
        now={now}
      />

      {/* Routine-grouped exercise list */}
      {exercises.length > 0 ? (
        <div className="flex flex-col gap-6">
          {routines.map(routine => {
            const routineExercises = grouped.get(routine.id)
            if (!routineExercises || routineExercises.length === 0) return null
            return (
              <section key={routine.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    {routine.name}
                  </h2>
                  <div className="h-px flex-1 bg-neutral-800" />
                </div>
                <ul className="flex flex-col divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
                  {routineExercises.map(exercise => (
                    <ExerciseStatRow
                      key={exercise.id}
                      exercise={exercise}
                      lastPerformedAt={
                        lastPerformedByExercise.get(exercise.id) ?? null
                      }
                      progressions={
                        progressionsByExercise.get(exercise.id) ?? []
                      }
                      scope={scope}
                      now={now}
                    />
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-8 text-center text-sm text-neutral-500">
          No exercises in this scope.
        </div>
      )}
    </div>
  )
}
