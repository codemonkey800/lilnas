'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import { useEffect, useRef, useState } from 'react'

import { ApiClient } from 'src/api/api.client'
import { DiscordContent } from 'src/components/DiscordContent'
import type { EmojiLookup } from 'src/queries/useEmojiLookup'
import { useModels } from 'src/queries/useModels'

import { formatMeta, scoreChips, TONE_COLOR } from './conversation'
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
  'Replies with ≥1 dictionary emoji',
  'Dictionary',
  'Hallucinated',
  'Unicode',
  'Shortcode',
  'Avg cost',
  'Avg latency',
] as const

const formatEstimate = (usd: number) =>
  `~$${usd.toFixed(usd > 0 && usd < 0.01 ? 4 : 2)}`

const percent = (row: EvalRow) =>
  row.calls === 0
    ? '—'
    : `${Math.round((row.repliesWithDictionary / row.calls) * 100)}%`

function ScoreLine({ cell }: { cell: EvalCell }) {
  if (!cell.result) return null
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
      {scoreChips(cell.result.emojis).map(chip => (
        <Chip
          key={chip.label}
          size="small"
          variant="outlined"
          color={TONE_COLOR[chip.tone]}
          label={chip.label}
          title={chip.title}
        />
      ))}
    </Box>
  )
}

function PromptResults({
  cells,
  lookup,
}: {
  cells: EvalCell[]
  lookup: EmojiLookup
}) {
  return (
    <Stack spacing={1.5} sx={{ py: 1.5 }}>
      {cells.map((cell, i) => (
        <Box key={cell.prompt}>
          <Typography variant="caption" color="text.secondary">
            {i + 1}. {cell.prompt}
          </Typography>
          {cell.result ? (
            <>
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  mt: 0.5,
                  borderRadius: 2,
                  bgcolor: 'background.paper',
                }}
              >
                <DiscordContent text={cell.result.reply} lookup={lookup} />
              </Box>
              <Typography
                variant="caption"
                fontFamily="monospace"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                {formatMeta({
                  model: cell.result.model,
                  costUsd: cell.result.usage.costUsd,
                  durationMs: cell.result.durationMs,
                })}
              </Typography>
              <ScoreLine cell={cell} />
            </>
          ) : (
            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
              failed: {cell.error}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
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
  const weight = best ? 700 : 400
  const mono = { fontFamily: 'monospace', fontWeight: weight }

  return (
    <>
      <TableRow hover>
        <TableCell sx={{ whiteSpace: 'nowrap', ...mono }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton
              size="small"
              aria-label={open ? 'Hide replies' : 'Show replies'}
              aria-expanded={open}
              onClick={() => setOpen(o => !o)}
              sx={{ fontSize: 12, width: 24, height: 24 }}
            >
              {open ? '▾' : '▸'}
            </IconButton>
            {row.model}
            {row.failed > 0 && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={`${row.failed} failed`}
              />
            )}
          </Box>
        </TableCell>
        <TableCell sx={mono}>{percent(row)}</TableCell>
        <TableCell sx={mono}>{row.dictionary}</TableCell>
        <TableCell
          sx={{
            ...mono,
            color: row.hallucinated > 0 ? 'error.main' : undefined,
          }}
        >
          {row.hallucinated}
        </TableCell>
        <TableCell sx={mono}>{row.unicode}</TableCell>
        <TableCell sx={mono}>{row.shortcode}</TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap', ...mono }}>
          ${row.avgCostUsd.toFixed(4)}
        </TableCell>
        <TableCell sx={{ whiteSpace: 'nowrap', ...mono }}>
          {(row.avgDurationMs / 1000).toFixed(1)} s
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={COLUMNS.length} sx={{ p: 0, border: 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
              <PromptResults cells={cells} lookup={lookup} />
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
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
    <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 3 }}>
      <Table size="small" aria-label="Eval results">
        <TableHead>
          <TableRow>
            {COLUMNS.map(column => (
              <TableCell
                key={column}
                sx={{
                  color: 'text.secondary',
                  verticalAlign: 'bottom',
                  ...(column.length > 12
                    ? { minWidth: 112 }
                    : { whiteSpace: 'nowrap' }),
                }}
              >
                {column}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(row => (
            <ResultRow
              key={row.model}
              row={row}
              cells={cells.filter(cell => cell.model === row.model)}
              best={row.model === best}
              lookup={lookup}
            />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
      onRunningChange?.(false)
    }
  }

  const cancel = () => abortRef.current?.abort()

  return (
    <Box
      sx={{
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="subtitle1" fontWeight={600}>
        Emoji eval
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every ticked model answers every prompt once; replies are scored against
        the dictionary.
      </Typography>

      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: '1fr', lg: '16rem 1fr' },
        }}
      >
        <Stack spacing={2}>
          <Box>
            <Typography
              variant="caption"
              fontWeight={500}
              sx={{ display: 'block', mb: 0.5 }}
            >
              Models
            </Typography>
            <FormGroup>
              {models.map(model => (
                <FormControlLabel
                  key={model.id}
                  control={
                    <Checkbox
                      size="small"
                      checked={ticked.includes(model.id)}
                      disabled={running}
                      onChange={e => toggle(model.id, e.target.checked)}
                    />
                  }
                  label={model.id}
                  slotProps={{
                    typography: { variant: 'body2', fontFamily: 'monospace' },
                  }}
                />
              ))}
            </FormGroup>
          </Box>

          <Box component="details">
            <Typography
              component="summary"
              variant="body2"
              sx={{ cursor: 'pointer', userSelect: 'none' }}
            >
              {EVAL_PROMPTS.length} prompts
            </Typography>
            <Box
              component="ol"
              sx={{ mt: 0.75, mb: 0, pl: 2.5, color: 'text.secondary' }}
            >
              {EVAL_PROMPTS.map(prompt => (
                <Typography
                  key={prompt}
                  component="li"
                  variant="caption"
                  sx={{ display: 'list-item' }}
                >
                  {prompt}
                </Typography>
              ))}
            </Box>
          </Box>

          <Typography variant="caption" color="text.secondary">
            {formatEstimate(estimate)} for {calls} calls
          </Typography>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" disabled={!canRun} onClick={run}>
              Run eval
            </Button>
            {running && (
              <Button color="inherit" onClick={cancel}>
                Cancel
              </Button>
            )}
          </Box>
        </Stack>

        <Stack spacing={2} sx={{ minWidth: 0 }}>
          {running && (
            <Box>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 0.5,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  Running…
                </Typography>
                <Typography
                  variant="caption"
                  fontFamily="monospace"
                  color="text.secondary"
                >
                  {progress.done} / {progress.total}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                aria-label="Eval progress"
                value={
                  progress.total === 0
                    ? 0
                    : (progress.done / progress.total) * 100
                }
              />
            </Box>
          )}
          {cells && cells.length > 0 && (
            <ResultsTable cells={cells} lookup={lookup} />
          )}
          {!running && !cells && (
            <Typography variant="caption" color="text.secondary">
              No results yet.
            </Typography>
          )}
        </Stack>
      </Box>
    </Box>
  )
}
