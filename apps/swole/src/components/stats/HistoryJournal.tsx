import { cns } from '@lilnas/utils/cns'

import type { CompletedSessionLogEntry } from 'src/db/setLogs'
import type { ExerciseRow } from 'src/db/types'
import { formatJournalSessionDate, formatSetRow } from 'src/lib/format'
import { groupSetLogsBySession } from 'src/lib/stats'

type Props = {
  exercise: ExerciseRow
  logs: CompletedSessionLogEntry[]
}

export function HistoryJournal({ exercise, logs }: Props) {
  const groups = groupSetLogsBySession(logs)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          History
        </h2>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      {groups.length === 0 ? (
        <p className="py-6 text-center text-sm text-neutral-500">
          No sets logged yet.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map(({ session, setLogs }) => (
            <div key={session.id} className="flex flex-col gap-1">
              <p className="text-xs font-medium text-neutral-400">
                {formatJournalSessionDate(session.completedAt)}
              </p>
              <ul
                className={cns(
                  'flex flex-col divide-y divide-neutral-900',
                  'overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40',
                )}
              >
                {setLogs.map(setLog => {
                  const parts = formatSetRow(setLog, exercise)
                  return (
                    <li
                      key={setLog.id}
                      className="px-4 py-2.5 text-sm text-neutral-200"
                    >
                      {parts.kind === 'shortfall' ? (
                        <>
                          {parts.pre}
                          <span className="text-orange-400">
                            {parts.fraction}
                          </span>
                          {parts.post}
                        </>
                      ) : (
                        parts.text
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
