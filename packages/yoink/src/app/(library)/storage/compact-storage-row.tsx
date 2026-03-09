'use client'

import { cns } from '@lilnas/utils/cns'

import { formatBytes } from 'src/media/format'
import type { RootFolderStorage } from 'src/media/storage.types'

import { WARNING_THRESHOLD } from './storage.utils'

export function CompactStorageRow({ folder }: { folder: RootFolderStorage }) {
  const used = folder.totalSpace - folder.freeSpace
  const ratio = folder.totalSpace > 0 ? used / folder.totalSpace : 0
  const isCritical = ratio >= 0.95
  const isWarning = !isCritical && ratio >= WARNING_THRESHOLD
  const pct = Math.round(ratio * 100)

  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-28 shrink-0 truncate font-mono text-xs text-carbon-300 sm:w-36">
        {folder.path}
      </span>
      <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-carbon-700">
        <div
          className={cns(
            'absolute left-0 top-0 h-full rounded-full transition-all duration-700',
            isCritical ? 'bg-error' : isWarning ? 'bg-warning' : 'bg-carbon-500',
          )}
          style={{ width: `${Math.max(ratio * 100, ratio > 0 ? 0.5 : 0)}%` }}
        />
      </div>
      <span
        className={cns(
          'w-28 shrink-0 text-right font-mono text-xs tabular-nums sm:w-36',
          isCritical
            ? 'text-error'
            : isWarning
              ? 'text-warning'
              : 'text-carbon-400',
        )}
      >
        {formatBytes(used)} / {formatBytes(folder.totalSpace)}
      </span>
      <span className="hidden w-10 shrink-0 text-right font-mono text-xs tabular-nums text-carbon-600 sm:block">
        {pct}%
      </span>
    </div>
  )
}
