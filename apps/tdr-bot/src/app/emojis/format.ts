import type { EmojiView, ReconcileStatus } from 'src/api/api.types'
import type { ReconcileTrigger } from 'src/emojis/emoji-sync.service'

export type EmojiFilter = 'all' | 'pending' | 'ai' | 'manual' | 'deleted'

export type SourceTone = 'ok' | 'muted' | 'warn'

export const DESCRIPTION_MAX = 300

export const FILTERS: { value: EmojiFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Needs description' },
  { value: 'ai', label: 'AI' },
  { value: 'manual', label: 'Manual' },
  { value: 'deleted', label: 'Deleted' },
]

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const EMPTY = '—'

const TRIGGER_LABELS: Record<ReconcileTrigger, string> = {
  boot: 'boot',
  cron: 'nightly',
  admin: 'manual',
  event: 'gateway event',
}

/** Pending rows have no description yet; deleted rows never get one. */
export function isPending(emoji: EmojiView): boolean {
  return emoji.description === null && emoji.deletedAt === null
}

export function matchesFilter(emoji: EmojiView, filter: EmojiFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'pending':
      return isPending(emoji)
    case 'ai':
    case 'manual':
      return emoji.source === filter
    case 'deleted':
      return emoji.deletedAt !== null
  }
}

/** Case-insensitive match on the name or description; blank matches all. */
export function matchesSearch(emoji: EmojiView, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true

  return [emoji.name, emoji.description ?? ''].some(field =>
    field.toLowerCase().includes(needle),
  )
}

export function visibleEmojis(
  emojis: EmojiView[],
  filter: EmojiFilter,
  text: string,
): EmojiView[] {
  return emojis.filter(e => matchesFilter(e, filter) && matchesSearch(e, text))
}

export function filterCounts(emojis: EmojiView[]): Record<EmojiFilter, number> {
  const counts: Record<EmojiFilter, number> = {
    all: 0,
    pending: 0,
    ai: 0,
    manual: 0,
    deleted: 0,
  }
  for (const emoji of emojis) {
    for (const { value } of FILTERS) {
      if (matchesFilter(emoji, value)) counts[value] += 1
    }
  }

  return counts
}

/** "just now" / "3 min ago" / "2 h ago" / "4 d ago". */
export function relativeTime(iso: string, now: Date): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime())
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`

  return `${Math.floor(diff / DAY)} d ago`
}

/**
 * The line under the reconcile button. `startedAt` is when this page last
 * started a reconcile; it names the running one unless a run has finished
 * since (so a later nightly run isn't labelled manual).
 */
export function reconcileStatusLine(
  status: ReconcileStatus,
  now: Date,
  startedAt: Date | null = null,
): string {
  const last = status.last

  if (status.running) {
    const ours =
      startedAt !== null &&
      (!last || new Date(last.finishedAt).getTime() < startedAt.getTime())
    return ours
      ? `Started ${relativeTime(startedAt.toISOString(), now)} (manual)`
      : 'Reconcile running…'
  }

  if (!last) return 'No reconcile has run yet'

  return [
    `Last reconcile ${relativeTime(last.finishedAt, now)} (${TRIGGER_LABELS[last.trigger]})`,
    `${last.synced} synced`,
    `${last.described} described`,
    `${last.failed} failed`,
  ].join(' · ')
}

/** "Oct 14, 9:02 AM"; an em dash when there is no time. */
export function formatWhen(iso: string | null): string {
  if (!iso) return EMPTY
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "Oct 2". */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function sourceLabel(emoji: EmojiView): string {
  return emoji.source ?? 'pending'
}

export function sourceTone(emoji: EmojiView): SourceTone {
  if (emoji.source === 'manual') return 'ok'
  if (emoji.source === 'ai') return 'muted'
  return 'warn'
}

/** Save is allowed when the trimmed draft is non-blank, fits and changed. */
export function canSaveDescription(
  draft: string,
  current: string | null,
): boolean {
  const trimmed = draft.trim()
  return (
    trimmed.length > 0 &&
    trimmed.length <= DESCRIPTION_MAX &&
    trimmed !== (current ?? '').trim()
  )
}

/** Re-describing a hand-written description asks first. */
export function needsRedescribeConfirm(emoji: EmojiView): boolean {
  return emoji.source === 'manual'
}

/** Deleted rows are read-only. */
export function hasActions(emoji: EmojiView): boolean {
  return emoji.deletedAt === null
}
