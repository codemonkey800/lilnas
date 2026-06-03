'use client'

import { cns } from '@lilnas/utils/cns'
import Button from '@mui/material/Button'
import Link from 'next/link'
import { useState } from 'react'

import type { CompletedSessionLogEntry } from 'src/db/setLogs'
import type { ExerciseRow } from 'src/db/types'
import { formatJournalSessionDate, formatSetRow } from 'src/lib/format'
import { groupSetLogsBySession } from 'src/lib/stats'

const INITIAL_VISIBLE = 5

type Props = {
  exercise: ExerciseRow
  logs: CompletedSessionLogEntry[]
}

export function HistoryJournal({ exercise, logs }: Props) {
  const groups = groupSetLogsBySession(logs)
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? groups : groups.slice(0, INITIAL_VISIBLE)
  const hiddenCount = groups.length - INITIAL_VISIBLE

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
          {visible.map(({ session, setLogs }) => (
            <div key={session.id} className="flex flex-col gap-1">
              <Link
                href={`/session/${session.id}`}
                className="text-xs font-medium text-neutral-400 hover:text-orange-400"
                prefetch={false}
              >
                {formatJournalSessionDate(session.completedAt)}
              </Link>
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

          {!showAll && hiddenCount > 0 && (
            <Button
              variant="text"
              size="small"
              onClick={() => setShowAll(true)}
              className="!self-start !text-neutral-400 hover:!text-neutral-200"
            >
              Show {hiddenCount} more session{hiddenCount === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
