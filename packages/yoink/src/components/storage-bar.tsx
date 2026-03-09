'use client'

import { cns } from '@lilnas/utils/cns'
import Card from '@mui/material/Card'
import { useState } from 'react'

import { formatBytes } from 'src/media/format'

export interface StorageBarProps {
  label: string
  usedBytes: number
  totalBytes: number
  moviesBytes?: number
  showsBytes?: number
  warningThreshold?: number
}

interface LegendDotProps {
  color: string
  label: string
  bytes: number
}

function LegendDot({ color, label, bytes }: LegendDotProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cns('inline-block h-2 w-2 rounded-full', color)} />
      <span className="font-mono text-xs text-carbon-400">{label}</span>
      <span className="font-mono text-xs tabular-nums text-carbon-300">
        {formatBytes(bytes)}
      </span>
    </div>
  )
}

export function StorageBar({
  label,
  usedBytes,
  totalBytes,
  moviesBytes = 0,
  showsBytes = 0,
  warningThreshold = 0.9,
}: StorageBarProps) {
  const [hovered, setHovered] = useState(false)

  const usageRatio = totalBytes > 0 ? usedBytes / totalBytes : 0
  const moviesRatio = totalBytes > 0 ? moviesBytes / totalBytes : 0
  const showsRatio = totalBytes > 0 ? showsBytes / totalBytes : 0
  const otherUsedBytes = Math.max(0, usedBytes - moviesBytes - showsBytes)
  const otherRatio = totalBytes > 0 ? otherUsedBytes / totalBytes : 0

  const isCritical = usageRatio >= 0.95
  const isWarning = !isCritical && usageRatio >= warningThreshold
  const usagePercent = Math.round(usageRatio * 100)

  return (
    <Card
      className={cns(
        'p-4 transition-all duration-300',
        isCritical && 'border-error/40',
        isWarning && 'border-warning/40',
        isCritical && 'animate-pulse-border',
      )}
      sx={
        isCritical
          ? { boxShadow: '0 0 12px rgba(255, 68, 68, 0.08)' }
          : isWarning
            ? { boxShadow: '0 0 12px rgba(255, 170, 34, 0.06)' }
            : undefined
      }
    >
      {/* Header row */}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm text-carbon-200 truncate">
          {label}
        </span>
        <span
          className={cns(
            'shrink-0 font-mono text-xs tabular-nums',
            isCritical
              ? 'text-error'
              : isWarning
                ? 'text-warning'
                : 'text-carbon-400',
          )}
        >
          {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
          {hovered && (
            <span className="ml-1.5 text-carbon-500">({usagePercent}%)</span>
          )}
        </span>
      </div>

      {/* Segmented bar */}
      <div
        className="relative h-4 overflow-hidden rounded-full bg-carbon-700"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={`${usagePercent}% used`}
      >
        {/* Noise texture overlay */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full opacity-[0.07]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        {/* Movies segment */}
        {moviesRatio > 0 && (
          <div
            className="absolute left-0 top-0 h-full bg-info transition-all duration-700 ease-out"
            style={{
              width: `${moviesRatio * 100}%`,
              minWidth: '4px',
            }}
          />
        )}

        {/* Shows segment */}
        {showsRatio > 0 && (
          <div
            className="absolute top-0 h-full bg-phosphor-600 transition-all duration-700 ease-out"
            style={{
              left: `${moviesRatio * 100}%`,
              width: `${showsRatio * 100}%`,
              minWidth: '4px',
            }}
          />
        )}

        {/* Other used space segment */}
        {otherRatio > 0 && (
          <div
            className="absolute top-0 h-full bg-carbon-500 transition-all duration-700 ease-out"
            style={{
              left: `${(moviesRatio + showsRatio) * 100}%`,
              width: `${otherRatio * 100}%`,
              minWidth: '4px',
            }}
          />
        )}

        {/* Subtle inner highlight */}
        <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/5 to-transparent" />
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {moviesBytes > 0 && (
          <LegendDot color="bg-info" label="Movies" bytes={moviesBytes} />
        )}
        {showsBytes > 0 && (
          <LegendDot color="bg-phosphor-600" label="Shows" bytes={showsBytes} />
        )}
        {otherUsedBytes > 0 && (
          <LegendDot
            color="bg-carbon-500"
            label="Other"
            bytes={otherUsedBytes}
          />
        )}
        <LegendDot
          color="bg-carbon-700 border border-carbon-500"
          label="Free"
          bytes={totalBytes - usedBytes}
        />
      </div>
    </Card>
  )
}
