'use client'

import { cns } from '@lilnas/utils/cns'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPrev: () => void
  onNext: () => void
}

export function Pagination({
  page,
  pageSize,
  total,
  onPrev,
  onNext,
}: PaginationProps) {
  if (total <= pageSize) return null

  const start = page * pageSize + 1
  const end = Math.min((page + 1) * pageSize, total)

  return (
    <div className="flex items-center justify-end gap-2 border-t border-carbon-600/50 px-4 py-2">
      <span className="font-mono text-xs tabular-nums text-carbon-500">
        {start}–{end} of {total}
      </span>
      <button
        type="button"
        onClick={onPrev}
        disabled={page === 0}
        className={cns(
          'flex size-6 items-center justify-center rounded font-mono text-xs',
          'transition-colors',
          page === 0
            ? 'cursor-not-allowed text-carbon-600'
            : 'text-carbon-400 hover:bg-carbon-700 hover:text-carbon-200',
        )}
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={end >= total}
        className={cns(
          'flex size-6 items-center justify-center rounded font-mono text-xs',
          'transition-colors',
          end >= total
            ? 'cursor-not-allowed text-carbon-600'
            : 'text-carbon-400 hover:bg-carbon-700 hover:text-carbon-200',
        )}
      >
        ›
      </button>
    </div>
  )
}
