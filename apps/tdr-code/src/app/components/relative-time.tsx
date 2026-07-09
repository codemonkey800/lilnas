'use client'

import { useEffect, useState } from 'react'

function format(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime()
  const diffMs = Date.now() - ms
  if (isNaN(diffMs)) return '—'
  const diffS = Math.floor(diffMs / 1000)
  if (diffS < 60) return `${diffS}s ago`
  const diffM = Math.floor(diffS / 60)
  if (diffM < 60) return `${diffM}m ago`
  const diffH = Math.floor(diffM / 60)
  if (diffH < 24) return `${diffH}h ago`
  return new Date(ms).toLocaleDateString()
}

// Formats a raw ISO-8601 timestamp (or epoch ms) as a relative human-readable string.
// Keeps timestamps un-formatted in cache; formatting happens only at this leaf.
export function RelativeTime({
  value,
  title,
}: {
  value: string | number
  title?: string
}) {
  const [label, setLabel] = useState(format(value))

  useEffect(() => {
    const timer = setInterval(() => setLabel(format(value)), 30_000)
    return () => clearInterval(timer)
  }, [value])

  const iso = typeof value === 'string' ? value : new Date(value).toISOString()
  return (
    <time dateTime={iso} title={title ?? iso}>
      {label}
    </time>
  )
}
