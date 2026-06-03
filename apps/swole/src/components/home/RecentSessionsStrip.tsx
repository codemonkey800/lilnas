import HistoryIcon from '@mui/icons-material/History'
import Link from 'next/link'

import type { RoutineRow, SessionRow } from 'src/db/types'
import { formatRelativeDay } from 'src/lib/format'

export type RecentSessionsStripProps = {
  rows: Array<{ session: SessionRow; routine: RoutineRow }>
  now: Date
}

export function RecentSessionsStrip({ rows, now }: RecentSessionsStripProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <HistoryIcon className="!text-base !text-neutral-500" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Recent sessions
        </h2>
        <div className="h-px flex-1 bg-neutral-800" />
      </div>
      <ul className="flex flex-col divide-y divide-neutral-900 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
        {rows.map(({ session, routine }) => (
          <li key={session.id}>
            <Link
              href={`/session/${session.id}`}
              prefetch={false}
              className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-neutral-200 transition-colors hover:bg-neutral-800/50 hover:text-orange-400"
            >
              <span className="font-medium">{routine.name}</span>
              <span className="flex items-center gap-1.5 text-xs text-neutral-500">
                {formatRelativeDay(session.completedAt as Date, now)}
                <span aria-hidden="true" className="text-neutral-700">
                  ›
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
