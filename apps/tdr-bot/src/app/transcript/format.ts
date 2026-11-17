import type { LlmCallRow } from 'src/db/schema'

export const usd = (n: number, digits = 5) => `$${n.toFixed(digits)}`

export const fmtInt = (n: number | null) => (n ?? 0).toLocaleString('en-US')

export const fmtCost = (call: LlmCallRow) =>
  call.costUsd === null ? '—' : usd(Number(call.costUsd))

export const fmtDuration = (call: LlmCallRow) =>
  call.durationMs === null ? '—' : `${(call.durationMs / 1000).toFixed(2)}s`

export const formatTime = (iso: string | Date | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''
