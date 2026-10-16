import Chip from '@mui/material/Chip'

import type { EmojiView } from 'src/api/api.types'

import { sourceLabel, type SourceTone, sourceTone } from './format'

const TONE_COLOR = {
  ok: 'success',
  muted: 'default',
  warn: 'warning',
} as const satisfies Record<SourceTone, string>

export function SourceChip({ emoji }: { emoji: EmojiView }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color={TONE_COLOR[sourceTone(emoji)]}
      label={sourceLabel(emoji)}
    />
  )
}
