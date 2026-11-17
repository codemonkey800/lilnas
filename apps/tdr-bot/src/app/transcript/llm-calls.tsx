'use client'

import { Badge, type BadgeTone, type Column, DataList, Icon } from '@lilnas/ui'

import type { LlmCallRow } from 'src/db/schema'

import { fmtCost, fmtDuration, fmtInt, usd } from './format'

const finishOf = (call: LlmCallRow) => call.finishReason ?? call.status

function finishTone(call: LlmCallRow): BadgeTone {
  const finish = finishOf(call)
  if (finish === 'stop') return 'ok'
  if (finish === 'tool_calls') return 'accent'
  if (call.finishReason === null && finish !== 'ok' && finish !== 'success') {
    return 'bad'
  }
  return 'mute'
}

export const CALL_COLUMNS: Column<LlmCallRow>[] = [
  { key: 'operation', header: 'Operation', render: c => c.operation },
  { key: 'model', header: 'Model', mono: true, render: c => c.model },
  {
    key: 'in',
    header: 'In',
    align: 'right',
    mono: true,
    render: c => fmtInt(c.inputTokens),
  },
  {
    key: 'out',
    header: 'Out',
    align: 'right',
    mono: true,
    render: c => fmtInt(c.outputTokens),
  },
  {
    key: 'cached',
    header: 'Cached',
    align: 'right',
    mono: true,
    render: c => fmtInt(c.cachedTokens),
  },
  {
    key: 'cost',
    header: 'Cost (USD)',
    align: 'right',
    mono: true,
    render: fmtCost,
  },
  {
    key: 'duration',
    header: 'Duration',
    align: 'right',
    mono: true,
    render: fmtDuration,
  },
  {
    key: 'retries',
    header: 'Retries',
    align: 'right',
    mono: true,
    render: c => {
      const retries = c.retries ?? 0
      return retries > 0 ? <span className="text-warn">{retries}</span> : '0'
    },
  },
  {
    key: 'finish',
    header: 'Finish',
    render: c => <Badge tone={finishTone(c)}>{finishOf(c)}</Badge>,
  },
]

/** The LLM calls behind one reply: a disclosure holding one `DataList`. */
export function LlmCalls({ calls }: { calls: LlmCallRow[] }) {
  const cost = calls.reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0)

  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 text-cap text-ink-3 transition-colors duration-200 ease-standard hover:text-ink [&::-webkit-details-marker]:hidden">
        <Icon
          className="-rotate-90 transition-transform duration-200 ease-standard group-open:rotate-0"
          name="chevron"
          size={12}
        />
        <span>
          {calls.length} LLM call{calls.length === 1 ? '' : 's'} ·
        </span>
        <span className="font-mono text-mono-sm tabular-nums">{usd(cost)}</span>
      </summary>
      <div className="mt-2">
        <DataList
          caption="LLM calls"
          cardBreakpoint="lg"
          columns={CALL_COLUMNS}
          rowKey={c => c.id}
          rows={calls}
        />
      </div>
    </details>
  )
}
