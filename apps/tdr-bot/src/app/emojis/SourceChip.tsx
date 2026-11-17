import { Badge, type BadgeTone } from '@lilnas/ui'

import type { EmojiView } from 'src/api/api.types'

import { type SourceTone, sourceTone } from './format'

const TONE: Record<SourceTone, BadgeTone> = {
  ok: 'ok',
  muted: 'mute',
  warn: 'warn',
}

const LABEL: Record<SourceTone, string> = {
  ok: 'Manual',
  muted: 'AI',
  warn: 'Pending',
}

/** Manual · AI · Pending while a description is on its way · Deleted. */
export function SourceChip({ emoji }: { emoji: EmojiView }) {
  if (emoji.deletedAt) return <Badge tone="bad">Deleted</Badge>

  const tone = sourceTone(emoji)
  return <Badge tone={TONE[tone]}>{LABEL[tone]}</Badge>
}
