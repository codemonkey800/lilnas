'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useState } from 'react'

export interface DonutSegment {
  pct: number
  color: string
  label: string
}

interface ArcData extends DonutSegment {
  dasharray: string
  dashoffset: number
}

export function DonutChart({
  segments,
  totalUsedPct,
}: {
  segments: DonutSegment[]
  totalUsedPct: number
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60)
    return () => clearTimeout(t)
  }, [])

  const size = 160
  const strokeWidth = 14
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const gap = 2
  const rotation = -90

  const { arcs } = segments.reduce<{ arcs: ArcData[]; offset: number }>(
    (acc, seg) => {
      const segLen = (seg.pct / 100) * (circumference - gap * segments.length)
      const dasharray = `${mounted ? segLen : 0} ${circumference}`
      const dashoffset = -acc.offset
      acc.arcs.push({ ...seg, dasharray, dashoffset })
      acc.offset += segLen + gap
      return acc
    },
    { arcs: [], offset: 0 },
  )

  const usedPct = Math.round(totalUsedPct)

  return (
    <div className="relative w-full max-w-[220px] shrink-0 sm:w-40 sm:max-w-none">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full overflow-visible"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-carbon-700)"
          strokeWidth={strokeWidth}
        />
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth={strokeWidth}
            strokeDasharray={arc.dasharray}
            strokeDashoffset={arc.dashoffset}
            strokeLinecap="butt"
            transform={`rotate(${rotation} ${size / 2} ${size / 2})`}
            style={{
              transition: mounted
                ? `stroke-dasharray 900ms cubic-bezier(0.16,1,0.3,1) ${i * 80}ms`
                : 'none',
            }}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cns(
            'font-mono text-2xl font-bold tabular-nums leading-none',
            usedPct >= 95
              ? 'text-error'
              : usedPct >= 90
                ? 'text-warning'
                : 'text-carbon-50',
          )}
        >
          {usedPct}%
        </span>
        <span className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-carbon-500">
          used
        </span>
      </div>
    </div>
  )
}
