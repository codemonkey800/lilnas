'use client'

import SearchOffIcon from '@mui/icons-material/SearchOff'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

interface NotFoundCardProps {
  lastSearchedAt: string
}

export function NotFoundCard({ lastSearchedAt }: NotFoundCardProps) {
  const searchedDate = dayjs(lastSearchedAt)
  const relativeLabel = searchedDate.fromNow()
  const absoluteLabel = searchedDate.format('MMM D, YYYY [at] h:mm A')

  return (
    <div
      className="animate-fade-in overflow-hidden rounded-sm"
      style={{
        background:
          'linear-gradient(135deg, rgba(255,170,34,0.04) 0%, rgba(255,170,34,0.02) 100%)',
        border: '1px solid rgba(255,170,34,0.2)',
        borderLeft: '3px solid var(--color-warning)',
      }}
    >
      <div className="flex items-start gap-4 px-5 py-4">
        <div
          className="mt-0.5 flex shrink-0 size-8 items-center justify-center rounded-sm"
          style={{
            background: 'rgba(255,170,34,0.1)',
            border: '1px solid rgba(255,170,34,0.2)',
          }}
        >
          <SearchOffIcon sx={{ fontSize: 18, color: 'var(--color-warning)' }} />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-mono text-sm font-medium text-carbon-100">
            No releases found
          </p>
          <p className="font-mono text-xs text-carbon-400">
            Last searched{' '}
            <span className="text-carbon-300" title={absoluteLabel}>
              {relativeLabel}
            </span>{' '}
            — no indexers returned results for this title
          </p>
        </div>

        <div
          className="shrink-0 self-start rounded-sm px-2 py-0.5 font-mono text-[0.6rem] tabular-nums"
          style={{
            color: 'var(--color-warning)',
            background: 'rgba(255,170,34,0.08)',
            border: '1px solid rgba(255,170,34,0.2)',
          }}
        >
          NOT FOUND
        </div>
      </div>
    </div>
  )
}
