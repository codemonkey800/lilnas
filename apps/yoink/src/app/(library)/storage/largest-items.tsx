'use client'

import { cns } from '@lilnas/utils/cns'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Link from 'next/link'

import { formatBytes } from 'src/media/format'
import type { LargestItem } from 'src/media/storage.types'

export function PodiumCard({
  item,
  rank,
  maxSize,
  index,
}: {
  item: LargestItem
  rank: number
  maxSize: number
  index: number
}) {
  const Icon = item.mediaType === 'movie' ? MovieIcon : TvIcon
  const sizePct = maxSize > 0 ? (item.sizeOnDisk / maxSize) * 100 : 0

  const rankColor =
    rank === 1
      ? 'text-warning'
      : rank === 2
        ? 'text-carbon-300'
        : 'text-carbon-400'

  return (
    <Card
      className={cns(
        'animate-fade-in group flex flex-col gap-3 p-4 transition-all duration-200',
        'hover:border-carbon-500',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between">
        <span
          className={cns(
            'font-mono text-3xl font-bold tabular-nums leading-none',
            rankColor,
          )}
        >
          {rank}
        </span>
        <Icon
          sx={{ fontSize: 16 }}
          className="text-carbon-500 transition-colors group-hover:text-carbon-300"
        />
      </div>

      <Link
        href={item.href}
        className={cns(
          'min-w-0 font-mono text-sm font-medium text-carbon-100 leading-snug',
          'line-clamp-2 transition-colors hover:text-terminal hover:underline',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terminal/50 rounded',
        )}
      >
        {item.title}
      </Link>

      {item.quality && (
        <div>
          <Chip
            label={item.quality}
            size="small"
            color="secondary"
            variant="outlined"
            sx={{
              fontSize: '0.6rem',
              height: 16,
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        </div>
      )}

      <div className="mt-auto flex flex-col gap-1.5">
        <div className="h-1.5 overflow-hidden rounded-full bg-carbon-700">
          <div
            className="h-full rounded-full bg-phosphor-600 transition-all duration-700"
            style={{ width: `${sizePct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-carbon-500 truncate">
            {item.rootFolder ?? ''}
          </span>
          <span className="font-mono text-xs tabular-nums font-semibold text-carbon-200 shrink-0">
            {formatBytes(item.sizeOnDisk)}
          </span>
        </div>
      </div>
    </Card>
  )
}

export function LargestItemRow({
  item,
  rank,
  index,
}: {
  item: LargestItem
  rank: number
  index: number
}) {
  const Icon = item.mediaType === 'movie' ? MovieIcon : TvIcon

  return (
    <div
      className={cns(
        'animate-fade-in flex items-center gap-3 px-4 py-2.5 transition-colors duration-150',
        'odd:bg-carbon-800 even:bg-carbon-900/40',
        'hover:bg-phosphor-950/60 group',
      )}
      style={{ animationDelay: `${index * 25}ms` }}
    >
      <span className="hidden w-7 shrink-0 font-mono text-sm font-semibold tabular-nums text-carbon-400 sm:block">
        {rank}
      </span>

      <Icon
        sx={{ fontSize: 14 }}
        className="shrink-0 text-carbon-500 transition-colors group-hover:text-carbon-300"
      />

      <div className="min-w-0 flex-1 flex items-center gap-2 truncate">
        <Link
          href={item.href}
          className={cns(
            'min-w-0 truncate font-mono text-sm text-carbon-200',
            'transition-colors hover:text-terminal hover:underline focus-visible:outline-none',
            'focus-visible:ring-2 focus-visible:ring-terminal/50 rounded',
          )}
        >
          {item.title}
        </Link>
        {item.quality && (
          <Chip
            label={item.quality}
            size="small"
            color="secondary"
            variant="outlined"
            sx={{
              fontSize: '0.6rem',
              height: 16,
              flexShrink: 0,
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        )}
      </div>

      {item.rootFolder && (
        <span className="hidden shrink-0 font-mono text-xs tabular-nums text-carbon-600 md:block">
          {item.rootFolder}
        </span>
      )}

      <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-carbon-300">
        {formatBytes(item.sizeOnDisk)}
      </span>
    </div>
  )
}
