import type { PlaygroundMessage } from 'src/api/api.types'
import type { EmojiAnalysis } from 'src/emojis/emoji-analysis'

export interface AssistantMeta {
  model: string
  costUsd: number
  durationMs: number
  emojis: EmojiAnalysis
}

export type Turn =
  | { id: string; role: 'user'; content: string }
  | { id: string; role: 'assistant'; content: string; meta: AssistantMeta }
  | { id: string; role: 'error'; message: string; retryOf: string }

export type ThreadAction =
  | { type: 'user'; id: string; content: string }
  | { type: 'assistant'; id: string; content: string; meta: AssistantMeta }
  | { type: 'error'; id: string; message: string; retryOf: string }
  | { type: 'retry'; id: string }
  | { type: 'reset' }

/** Drops the trailing error turn and, when asked, the user turn it belongs to. */
function dropTrailingError(turns: Turn[], withUserTurn: boolean): Turn[] {
  const last = turns[turns.length - 1]
  if (last?.role !== 'error') return turns
  const rest = turns.slice(0, -1)
  return withUserTurn ? rest.filter(t => t.id !== last.retryOf) : rest
}

/**
 * Pure thread reducer. A new user message after a failure replaces the failed
 * attempt (the composer gets its text back on failure, so resending from the
 * input is the edit-and-retry path); `retry` keeps the user turn and only
 * removes the error so the same history is sent again.
 */
export function threadReducer(turns: Turn[], action: ThreadAction): Turn[] {
  switch (action.type) {
    case 'user':
      return [
        ...dropTrailingError(turns, true),
        { id: action.id, role: 'user', content: action.content },
      ]
    case 'assistant':
      return [
        ...turns,
        {
          id: action.id,
          role: 'assistant',
          content: action.content,
          meta: action.meta,
        },
      ]
    case 'error':
      return [
        ...turns,
        {
          id: action.id,
          role: 'error',
          message: action.message,
          retryOf: action.retryOf,
        },
      ]
    case 'retry':
      return turns.filter(t => t.id !== action.id)
    case 'reset':
      return []
  }
}

/** The request history: user and assistant turns only, errors dropped. */
export function toRequestMessages(turns: Turn[]): PlaygroundMessage[] {
  return turns.flatMap(turn =>
    turn.role === 'error' ? [] : [{ role: turn.role, content: turn.content }],
  )
}

/** The draft to send: only when it differs from the saved prompt. */
export function draftOverride(
  draft: string,
  saved: string,
): string | undefined {
  return draft === saved ? undefined : draft
}

function formatCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.0001) return '< $0.0001'
  return `$${costUsd.toFixed(4)}`
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  return `${(durationMs / 1000).toFixed(1)} s`
}

/** 'gpt-5-mini · $0.0042 · 1.8 s' */
export function formatMeta(
  meta: Pick<AssistantMeta, 'model' | 'costUsd' | 'durationMs'>,
): string {
  return [
    meta.model,
    formatCost(meta.costUsd),
    formatDuration(meta.durationMs),
  ].join(' · ')
}

export type ScoreTone = 'ok' | 'bad' | 'warn' | 'muted'

/** MUI Chip colour per score tone. */
export const TONE_COLOR = {
  ok: 'success',
  bad: 'error',
  warn: 'warning',
  muted: 'default',
} as const satisfies Record<ScoreTone, string>

export interface ScoreChip {
  label: string
  tone: ScoreTone
  /** Raw tokens for the hallucinated chip. */
  title?: string
}

/** The score chips under a reply; hallucinated only when there are any. */
export function scoreChips(emojis: EmojiAnalysis): ScoreChip[] {
  const { counts } = emojis
  const chips: ScoreChip[] = [
    { label: `${counts.dictionary} dictionary`, tone: 'ok' },
  ]
  if (counts.hallucinated > 0) {
    chips.push({
      label: `${counts.hallucinated} hallucinated`,
      tone: 'bad',
      title: emojis.hallucinated.map(e => e.raw).join(' '),
    })
  }
  chips.push(
    { label: `${counts.unicode} unicode`, tone: 'warn' },
    { label: `${counts.shortcode} shortcode`, tone: 'muted' },
  )
  return chips
}
