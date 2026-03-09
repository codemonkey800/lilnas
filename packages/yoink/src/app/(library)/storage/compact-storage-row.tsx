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

  const barColor = isCritical
    ? 'bg-error'
    : isWarning
      ? 'bg-warning'
      : 'bg-carbon-500'

  const sizeColor = isCritical
    ? 'text-error'
    : isWarning
      ? 'text-warning'
      : 'text-carbon-400'

  const barWidth = `${Math.max(ratio * 100, ratio > 0 ? 0.5 : 0)}%`

  return (
    <div className="py-2.5">
      {/* Mobile layout */}
      <div className="sm:hidden">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-carbon-300">
            {folder.path}
          </span>
          <span
            className={cns(
              'shrink-0 font-mono text-xs tabular-nums',
              sizeColor,
            )}
          >
            {formatBytes(used)} / {formatBytes(folder.totalSpace)}
          </span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-carbon-700">
          <div
            className={cns(
              'absolute left-0 top-0 h-full rounded-full transition-all duration-700',
              barColor,
            )}
            style={{ width: barWidth }}
          />
        </div>
      </div>

      {/* Desktop layout (sm+) */}
      <div className="hidden sm:flex sm:items-center sm:gap-3">
        <span className="w-36 shrink-0 truncate font-mono text-xs text-carbon-300">
          {folder.path}
        </span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-carbon-700">
          <div
            className={cns(
              'absolute left-0 top-0 h-full rounded-full transition-all duration-700',
              barColor,
            )}
            style={{ width: barWidth }}
          />
        </div>
        <span
          className={cns(
            'w-36 shrink-0 text-right font-mono text-xs tabular-nums',
            sizeColor,
          )}
        >
          {formatBytes(used)} / {formatBytes(folder.totalSpace)}
        </span>
        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-carbon-600">
          {pct}%
        </span>
      </div>
    </div>
  )
}
