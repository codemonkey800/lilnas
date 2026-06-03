import type { CompletedSessionLogEntry } from 'src/db/setLogs'
import type { ExerciseRow, ProgressionRow } from 'src/db/types'
import {
  buildWeightTrendPoints,
  hasLoggedSession,
  shouldRenderWeightChart,
} from 'src/lib/stats'

import { ConsistencyView } from './ConsistencyView'
import { WeightTrendChart } from './WeightTrendChart'

type Props = {
  exercise: ExerciseRow
  progressions: ProgressionRow[]
  logs: CompletedSessionLogEntry[]
}

export function TrendRegion({ exercise, progressions, logs }: Props) {
  const isWeighted = exercise.type === 'weighted'

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Trend
        </h2>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      <div className="min-h-[280px] rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        {isWeighted ? (
          shouldRenderWeightChart(progressions) ? (
            <WeightTrendChart
              points={buildWeightTrendPoints(progressions, logs).map(p => ({
                ts: p.date.getTime(),
                weight: p.weight,
              }))}
            />
          ) : (
            <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
              <p className="text-sm text-neutral-400">
                Your weight progression will chart here after a couple of
                sessions.
              </p>
            </div>
          )
        ) : hasLoggedSession(logs) ? (
          <ConsistencyView exercise={exercise} logs={logs} />
        ) : (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
            <p className="text-sm text-neutral-400">
              Your session history will appear here once you complete a workout.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
