import { cns } from '@lilnas/utils/cns'

import type { CompletedSessionLogEntry } from 'src/db/setLogs'
import type { ExerciseRow } from 'src/db/types'
import { formatJournalSessionDate } from 'src/lib/format'
import { classifyConsistency, groupSetLogsBySession } from 'src/lib/stats'

type Props = {
  exercise: ExerciseRow
  logs: CompletedSessionLogEntry[]
}

export function ConsistencyView({ exercise, logs }: Props) {
  // Groups arrive newest-first; reverse for a left→right chronological timeline.
  const timeline = groupSetLogsBySession(logs)
    .map(({ session, setLogs }) => {
      const cls = classifyConsistency(setLogs, exercise.type)
      return { session, isHit: cls === 'hit' || cls === 'done' }
    })
    .reverse()

  const completed = timeline.filter(t => t.isHit).length

  return (
    <div className="flex h-full min-h-[180px] flex-col justify-between gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Consistency
        </h3>
        <span className="text-xs text-neutral-500">
          {completed}/{timeline.length} completed
        </span>
      </div>

      <div className="flex flex-1 flex-wrap content-center items-center gap-2.5">
        {timeline.map(({ session, isHit }) => (
          <div
            key={session.id}
            title={formatJournalSessionDate(session.completedAt)}
            className={cns(
              'h-4 w-4 rounded-full ring-1',
              isHit
                ? 'bg-orange-500 ring-orange-500/30'
                : 'bg-neutral-700 ring-neutral-600/40',
            )}
          />
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
          Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
          Incomplete
        </span>
      </div>
    </div>
  )
}
