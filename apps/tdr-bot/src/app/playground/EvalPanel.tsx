'use client'

import {
  Badge,
  Button,
  Checkbox,
  Icon,
  Note,
  Panel,
  PanelHead,
  Progress,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useEffect, useRef, useState } from 'react'

import { ApiClient } from 'src/api/api.client'
import { DiscordContent } from 'src/components/DiscordContent'
import type { EmojiLookup } from 'src/queries/useEmojiLookup'
import { useModels } from 'src/queries/useModels'

import { ScoreBadges } from './bubbles'
import { formatMeta, scoreChips } from './conversation'
import {
  bestDictionaryRate,
  estimateCostUsd,
  type EvalCell,
  evalJobs,
  type EvalRow,
  runEval,
  summarize,
} from './eval'
import { EVAL_PROMPTS } from './eval-prompts'

const apiClient = new ApiClient()

/** Rough per-call token budget for the estimate: prompt + dictionary, short reply. */
const EST_PROMPT_TOKENS = 6000
const EST_REPLY_TOKENS = 150
const CONCURRENCY = 2

const COLUMNS = [
  'Model',
  'Reply rate',
  'Dictionary',
  'Repaired',
  'Hallucinated',
  'Unicode',
  'Cost',
  'Latency',
] as const

/** The header and every row share this grid at `md`+; phones stack the row. */
const ROW_GRID =
  'md:grid md:grid-cols-[minmax(150px,1.4fr)_minmax(90px,.8fr)_repeat(4,minmax(84px,.6fr))_minmax(64px,.7fr)_minmax(64px,.7fr)] md:items-center md:gap-2'

const formatEstimate = (usd: number) =>
  `~$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`

const percent = (row: EvalRow) =>
  row.calls === 0
    ? '—'
    : `${Math.round((row.repliesWithDictionary / row.calls) * 100)}%`

function PromptResults({
  cells,
  lookup,
}: {
  cells: EvalCell[]
  lookup: EmojiLookup
}) {
  return (
    <div className="flex flex-col gap-4 border-t border-line-soft bg-bg-sunk py-3 pr-3 pl-3 md:pl-9">
      {cells.map((cell, i) => (
        <div key={cell.prompt} className="flex flex-col gap-1.5">
          <p className="text-cap text-ink-3">
            {i + 1}. {cell.prompt}
          </p>
          {cell.result ? (
            <>
              <div className="rounded-lg bg-surface px-3 py-2 text-sm">
                <DiscordContent lookup={lookup} text={cell.result.reply} />
              </div>
              <p className="font-mono text-mono-sm text-ink-3">
                {formatMeta({
                  model: cell.result.model,
                  costUsd: cell.result.usage.costUsd,
                  durationMs: cell.result.durationMs,
                })}
              </p>
              <ScoreBadges chips={scoreChips(cell.result.emojis)} />
            </>
          ) : (
            <p className="text-sm text-bad">failed: {cell.error}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function ResultRow({
  row,
  cells,
  best,
  lookup,
}: {
  row: EvalRow
  cells: EvalCell[]
  best: boolean
  lookup: EmojiLookup
}) {
  const [open, setOpen] = useState(false)
  const num = cns('font-mono text-mono tabular-nums', best && 'font-semibold')
  const cost = `$${row.avgCostUsd.toFixed(4)}`
  const latency = `${(row.avgDurationMs / 1000).toFixed(1)} s`

  return (
    <details
      className="group border-b border-line-soft last:border-b-0"
      open={open}
    >
      <summary
        className={cns(
          'flex cursor-pointer list-none flex-col gap-2 px-3 py-2.5 transition-colors duration-[120ms] ease-standard hover:bg-surface-2 [&::-webkit-details-marker]:hidden',
          ROW_GRID,
        )}
        onClick={e => {
          e.preventDefault()
          setOpen(o => !o)
        }}
      >
        <span className="flex items-center gap-2">
          <Icon
            className="-rotate-90 text-ink-3 transition-transform duration-200 ease-standard group-open:rotate-0"
            name="chevron"
            size={14}
          />
          <span className={cns('font-mono text-mono', best && 'font-semibold')}>
            {row.model}
          </span>
          {row.failed > 0 && <Badge tone="bad">{row.failed} failed</Badge>}
        </span>

        <span className="flex items-baseline gap-2 pl-6 md:hidden">
          <span
            className={cns(
              'font-mono text-h2 tabular-nums',
              best ? 'font-semibold' : 'text-ink-2',
            )}
          >
            {percent(row)}
          </span>
          <span className="text-cap text-ink-3">
            reply with ≥1 dictionary emoji
          </span>
        </span>
        <span className="flex flex-wrap gap-1.5 pl-6 md:hidden">
          <Badge tone="ok">{row.dictionary} dictionary</Badge>
          {row.repaired > 0 && (
            <Badge tone="warn">{row.repaired} repaired</Badge>
          )}
          {row.hallucinated > 0 && (
            <Badge tone="bad">{row.hallucinated} hallucinated</Badge>
          )}
          <Badge tone="warn">{row.unicode} unicode</Badge>
        </span>
        <span className="pl-6 font-mono text-mono-sm text-ink-3 md:hidden">
          {cost} · {latency}
        </span>

        <span className={cns(num, 'hidden md:inline')}>{percent(row)}</span>
        <span className="hidden font-mono text-mono tabular-nums md:inline">
          {row.dictionary}
        </span>
        <span
          className={cns(
            'hidden font-mono text-mono tabular-nums md:inline',
            row.repaired > 0 && 'text-warn',
          )}
        >
          {row.repaired}
        </span>
        <span
          className={cns(
            'hidden font-mono text-mono tabular-nums md:inline',
            row.hallucinated > 0 && 'text-bad',
          )}
        >
          {row.hallucinated}
        </span>
        <span className="hidden font-mono text-mono tabular-nums md:inline">
          {row.unicode}
        </span>
        <span className="hidden font-mono text-mono whitespace-nowrap tabular-nums md:inline">
          {cost}
        </span>
        <span className="hidden font-mono text-mono whitespace-nowrap tabular-nums md:inline">
          {latency}
        </span>
      </summary>
      {open && <PromptResults cells={cells} lookup={lookup} />}
    </details>
  )
}

function ResultsTable({
  cells,
  lookup,
}: {
  cells: EvalCell[]
  lookup: EmojiLookup
}) {
  const rows = summarize(cells)
  const best = bestDictionaryRate(rows)

  return (
    <div
      aria-label="Eval results"
      className="overflow-hidden rounded-lg border border-line bg-surface"
      role="group"
    >
      <div
        aria-hidden="true"
        className={cns(
          'hidden border-b border-line-loud px-3 pt-3 pb-2.5 text-label text-ink-3 uppercase md:grid md:items-end',
          ROW_GRID.replace('md:grid ', '').replace('md:items-center ', ''),
        )}
      >
        {COLUMNS.map(column => (
          <span key={column}>{column}</span>
        ))}
      </div>
      {rows.map(row => (
        <ResultRow
          key={row.model}
          best={row.model === best}
          cells={cells.filter(cell => cell.model === row.model)}
          lookup={lookup}
          row={row}
        />
      ))}
    </div>
  )
}

export interface EvalPanelProps {
  /** The saved chat model; ticked by default. */
  savedModel: string
  /** The thread's prompt draft, only when it differs from the saved prompt. */
  systemPromptDraft: string | undefined
  lookup: EmojiLookup
  /** True while the thread has a request pending. */
  disabled?: boolean
  /** Fires on run start and end so the thread can disable Send. */
  onRunningChange?: (running: boolean) => void
}

/**
 * Runs every fixed prompt through every ticked chat model as a fresh
 * one-message conversation and tabulates the emoji scores per model. Results
 * stay until the next run.
 */
export function EvalPanel({
  savedModel,
  systemPromptDraft,
  lookup,
  disabled = false,
  onRunningChange,
}: EvalPanelProps) {
  const { data: models = [] } = useModels('chat')
  const [ticked, setTicked] = useState<readonly string[]>([savedModel])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [cells, setCells] = useState<EvalCell[] | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Abort an in-progress run if the page unmounts.
  useEffect(() => () => abortRef.current?.abort(), [])

  const tickedModels = models.filter(model => ticked.includes(model.id))
  const calls = tickedModels.length * EVAL_PROMPTS.length
  const estimate = estimateCostUsd(
    tickedModels,
    EVAL_PROMPTS.length,
    EST_PROMPT_TOKENS,
    EST_REPLY_TOKENS,
  )
  const canRun = !running && !disabled && tickedModels.length > 0

  const toggle = (id: string, checked: boolean) =>
    setTicked(current =>
      checked ? [...current, id] : current.filter(m => m !== id),
    )

  const run = async () => {
    if (!canRun) return
    const controller = new AbortController()
    abortRef.current = controller
    const jobs = evalJobs(
      tickedModels.map(model => model.id),
      EVAL_PROMPTS,
    )
    setRunning(true)
    setRunError(null)
    onRunningChange?.(true)
    setProgress({ done: 0, total: jobs.length })
    try {
      const result = await runEval(
        jobs,
        job =>
          apiClient.playgroundChat({
            model: job.model,
            messages: [{ role: 'user', content: job.prompt }],
            systemPromptDraft,
          }),
        {
          concurrency: CONCURRENCY,
          signal: controller.signal,
          onProgress: done => setProgress(p => ({ ...p, done })),
        },
      )
      setCells(result)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err))
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
      onRunningChange?.(false)
    }
  }

  const cancel = () => abortRef.current?.abort()

  const failures = cells?.filter(cell => !cell.result) ?? []

  return (
    <Panel>
      <PanelHead
        caption="Every ticked model answers every prompt once. Replies are scored against the dictionary."
        title="Emoji eval"
      />
      <div className="flex flex-col gap-5 p-4 lg:flex-row lg:items-start">
        <div className="flex shrink-0 flex-col gap-4 lg:w-56">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-ink-2">
              Models
            </legend>
            {models.map(model => (
              <Checkbox
                key={model.id}
                checked={ticked.includes(model.id)}
                className="font-mono"
                disabled={running}
                label={model.id}
                onCheckedChange={checked => toggle(model.id, checked)}
              />
            ))}
          </fieldset>

          <details className="group text-sm">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ink-2 [&::-webkit-details-marker]:hidden">
              <Icon
                className="-rotate-90 text-ink-3 transition-transform duration-200 ease-standard group-open:rotate-0"
                name="chevron"
                size={12}
              />
              {EVAL_PROMPTS.length} prompts
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-6 text-cap text-ink-3">
              {EVAL_PROMPTS.map(prompt => (
                <li key={prompt}>{prompt}</li>
              ))}
            </ol>
          </details>

          <p className="text-cap text-ink-3">
            <span className="font-mono text-mono-sm tabular-nums">
              {formatEstimate(estimate)} for {calls} calls
            </span>
          </p>

          <div className="flex gap-2">
            <Button
              disabled={!canRun && !running}
              loading={running}
              variant="accent"
              onClick={run}
            >
              {running ? 'Running…' : 'Run eval'}
            </Button>
            {running && <Button onClick={cancel}>Cancel</Button>}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {running && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-cap text-ink-3">
                <span>Running…</span>
                <span className="font-mono tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <Progress
                label="Eval progress"
                max={progress.total}
                value={progress.done}
              />
            </div>
          )}
          {runError && (
            <Note lead="The eval stopped." tone="bad">
              {runError}
            </Note>
          )}
          {!running && failures.length > 0 && (
            <Note
              lead={`${failures.length} of ${cells?.length ?? 0} replies failed.`}
              tone="bad"
            >
              {failures[0].error}. Results so far are below; run it again in a
              minute.
            </Note>
          )}
          {cells && cells.length > 0 && (
            <ResultsTable cells={cells} lookup={lookup} />
          )}
          {!running && !cells && (
            <p className="text-sm text-ink-3">
              Tick the models to compare and run the eval. Results land here as
              each reply comes back.
            </p>
          )}
        </div>
      </div>
    </Panel>
  )
}
