import { notFound } from 'next/navigation'

import { BackLink } from 'src/components/stats/BackLink'
import { HistoryJournal } from 'src/components/stats/HistoryJournal'
import { SummaryHeader } from 'src/components/stats/SummaryHeader'
import { TrendRegion } from 'src/components/stats/TrendRegion'
import { getExerciseWithRoutine } from 'src/db/exercises'
import { getProgressionsForExercise } from 'src/db/progressions'
import { getSetLogsForExercise } from 'src/db/setLogs'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ exerciseId: string }>
}

export default async function StatsDetailPage({ params }: Props) {
  const { exerciseId: exerciseIdStr } = await params
  const exerciseId = Number(exerciseIdStr)
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
    notFound()
  }

  const [exerciseWithRoutine, progressions, logs] = await Promise.all([
    getExerciseWithRoutine({ exerciseId, includeArchived: true }),
    getProgressionsForExercise({ exerciseId }),
    getSetLogsForExercise({ exerciseId }),
  ])

  if (!exerciseWithRoutine) {
    notFound()
  }

  const { exercise, routine } = exerciseWithRoutine

  return (
    <div className="flex flex-col gap-6 py-6">
      <BackLink />
      <SummaryHeader exercise={exercise} routine={routine} logs={logs} />
      <TrendRegion
        exercise={exercise}
        progressions={progressions}
        logs={logs}
      />
      <HistoryJournal exercise={exercise} logs={logs} />
    </div>
  )
}
