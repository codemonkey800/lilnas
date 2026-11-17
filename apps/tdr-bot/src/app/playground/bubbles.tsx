'use client'

import { Badge, Button, Spinner } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'

import { DiscordContent } from 'src/components/DiscordContent'
import type { EmojiLookup } from 'src/queries/useEmojiLookup'

import {
  formatMeta,
  type ScoreChip,
  scoreChips,
  TONE_BADGE,
  type Turn,
} from './conversation'

/** The author the server stamps on user turns (DEFAULT_PLAYGROUND_AUTHOR). */
const AUTHOR = 'paulbeenis420'

/** The emoji score: how many came from where. */
export function ScoreBadges({ chips }: { chips: ScoreChip[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map(chip => (
        <Badge key={chip.label} title={chip.title} tone={TONE_BADGE[chip.tone]}>
          {chip.label}
        </Badge>
      ))}
    </div>
  )
}

const BOT_BUBBLE =
  'flex flex-col gap-1 rounded-xl rounded-bl-xs border border-line bg-surface px-3.5 py-2.5'

export function UserBubble({
  turn,
  lookup,
}: {
  turn: Extract<Turn, { role: 'user' }>
  lookup: EmojiLookup
}) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[90%] flex-col gap-1 rounded-xl rounded-br-xs bg-accent-ghost px-3.5 py-2.5 md:max-w-[72%]">
        <span className="text-cap font-medium text-accent-hi">{AUTHOR}</span>
        <DiscordContent lookup={lookup} text={turn.content} />
      </div>
    </div>
  )
}

/** A reply: the bubble, then model · cost · latency, then the emoji score. */
export function AssistantBubble({
  turn,
  lookup,
}: {
  turn: Extract<Turn, { role: 'assistant' }>
  lookup: EmojiLookup
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cns(BOT_BUBBLE, 'w-full md:max-w-[80%]')}>
        <span className="text-cap font-medium text-ink-3">tdr-bot</span>
        <DiscordContent lookup={lookup} text={turn.content} />
      </div>
      <p className="px-1 font-mono text-mono-sm text-ink-3">
        {formatMeta(turn.meta)}
      </p>
      <div className="px-1">
        <ScoreBadges chips={scoreChips(turn.meta.emojis)} />
      </div>
    </div>
  )
}

export function ErrorBubble({
  turn,
  retryDisabled,
  onRetry,
}: {
  turn: Extract<Turn, { role: 'error' }>
  /** A request or an eval is in flight. */
  retryDisabled: boolean
  onRetry: () => void
}) {
  return (
    <div className="flex">
      <div className="flex w-full flex-col gap-2 rounded-xl rounded-bl-xs border border-bad/40 bg-bad-ghost px-3.5 py-2.5 md:max-w-[80%]">
        <span className="text-cap font-medium text-bad">tdr-bot · failed</span>
        <p className="text-body wrap-anywhere text-ink">{turn.message}</p>
        <Button
          className="self-start"
          disabled={retryDisabled}
          icon="refresh"
          size="sm"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    </div>
  )
}

export function PendingBubble({ model }: { model: string }) {
  return (
    <div className="flex" data-testid="playground-pending">
      <div className={BOT_BUBBLE}>
        <span className="text-cap font-medium text-ink-3">tdr-bot</span>
        <span className="flex items-center gap-2 text-body text-ink-3">
          <Spinner size={14} />
          {model} is thinking…
        </span>
      </div>
    </div>
  )
}
