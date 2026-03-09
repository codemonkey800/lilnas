'use client'

import { cns } from '@lilnas/utils/cns'
import Card from '@mui/material/Card'

import { formatBytes } from 'src/media/format'
import type { RootFolderStorage } from 'src/media/storage.types'

import { DonutChart, type DonutSegment } from './donut-chart'

export function StorageSummary({
  rootFolders,
}: {
  rootFolders: RootFolderStorage[]
}) {
  const totalSpace = rootFolders.reduce((s, f) => s + f.totalSpace, 0)
  const totalUsed = rootFolders.reduce(
    (s, f) => s + (f.totalSpace - f.freeSpace),
    0,
  )
  const totalMovies = rootFolders.reduce((s, f) => s + f.moviesBytes, 0)
  const totalShows = rootFolders.reduce((s, f) => s + f.showsBytes, 0)
  const totalOther = Math.max(0, totalUsed - totalMovies - totalShows)
  const totalFree = Math.max(0, totalSpace - totalUsed)

  const pct = (b: number) => (totalSpace > 0 ? (b / totalSpace) * 100 : 0)

  const segments: DonutSegment[] = [
    ...(totalMovies > 0
      ? [{ pct: pct(totalMovies), color: 'var(--color-info)', label: 'Movies' }]
      : []),
    ...(totalShows > 0
      ? [
          {
            pct: pct(totalShows),
            color: 'var(--color-phosphor-600)',
            label: 'Shows',
          },
        ]
      : []),
    ...(totalOther > 0
      ? [
          {
            pct: pct(totalOther),
            color: 'var(--color-carbon-500)',
            label: 'Other',
          },
        ]
      : []),
    ...(totalFree > 0
      ? [
          {
            pct: pct(totalFree),
            color: 'var(--color-carbon-700)',
            label: 'Free',
          },
        ]
      : []),
  ]

  const totalUsedPct = pct(totalUsed)

  interface LegendItem {
    color: string
    label: string
    bytes: number
  }

  const legendItems: LegendItem[] = []
  if (totalMovies > 0)
    legendItems.push({ color: 'bg-info', label: 'Movies', bytes: totalMovies })
  if (totalShows > 0)
    legendItems.push({
      color: 'bg-phosphor-600',
      label: 'Shows',
      bytes: totalShows,
    })
  if (totalOther > 0)
    legendItems.push({
      color: 'bg-carbon-500',
      label: 'Other',
      bytes: totalOther,
    })
  legendItems.push({
    color: 'bg-carbon-700 border border-carbon-500',
    label: 'Free',
    bytes: totalFree,
  })

  return (
    <Card className="animate-fade-in p-5 sm:p-6">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <DonutChart segments={segments} totalUsedPct={totalUsedPct} />

        <div className="flex w-full flex-1 flex-col items-center gap-4 sm:items-start">
          <div
            className="animate-fade-in w-full text-center sm:text-left"
            style={{ animationDelay: '120ms' }}
          >
            <p className="font-mono text-xs uppercase tracking-widest text-carbon-500">
              Total storage
            </p>
            <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-carbon-50">
              {formatBytes(totalUsed)}
              <span className="ml-2 text-base font-normal text-carbon-400">
                / {formatBytes(totalSpace)}
              </span>
            </p>
            <p className="mt-1 font-mono text-xs text-carbon-500">
              across {rootFolders.length}{' '}
              {rootFolders.length === 1 ? 'volume' : 'volumes'}
            </p>
          </div>

          <div
            className="animate-fade-in grid w-full grid-cols-2 gap-x-5 gap-y-2 sm:flex sm:flex-wrap"
            style={{ animationDelay: '200ms' }}
          >
            {legendItems.map(item => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span
                  className={cns('inline-block h-2 w-2 shrink-0 rounded-full', item.color)}
                />
                <span className="font-mono text-xs text-carbon-400">
                  {item.label}
                </span>
                <span className="font-mono text-xs tabular-nums text-carbon-300">
                  {formatBytes(item.bytes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
