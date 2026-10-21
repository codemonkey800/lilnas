import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'

import type { EmojiView } from 'src/api/api.types'

import { DescriptionEditor } from './DescriptionEditor'
import { EmojiImage } from './EmojiImage'
import { formatDay, formatWhen, hasActions, isPending } from './format'
import { SourceChip } from './SourceChip'

export interface EmojiRowProps {
  emoji: EmojiView
  editing: boolean
  /** A reconcile is running, so pending rows are being described. */
  reconciling: boolean
  /** This row's re-describe request is in flight. */
  redescribing: boolean
  onEdit: (emoji: EmojiView) => void
  onCloseEdit: () => void
  onRedescribe: (emoji: EmojiView) => void
}

export function Description({
  emoji,
  reconciling,
}: Pick<EmojiRowProps, 'emoji' | 'reconciling'>) {
  if (emoji.description) {
    return <Typography variant="body2">{emoji.description}</Typography>
  }
  if (reconciling && isPending(emoji)) {
    return (
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          fontStyle: 'italic',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <CircularProgress size={12} color="inherit" />
        Describing…
      </Typography>
    )
  }

  return (
    <Typography
      variant="body2"
      sx={{ color: 'text.secondary', fontStyle: 'italic' }}
    >
      Waiting for a description
    </Typography>
  )
}

export function RowActions({
  emoji,
  redescribing,
  onEdit,
  onRedescribe,
}: Pick<EmojiRowProps, 'emoji' | 'redescribing' | 'onEdit' | 'onRedescribe'>) {
  if (!hasActions(emoji)) return null

  return (
    <Box sx={{ whiteSpace: 'nowrap' }}>
      <Button size="small" onClick={() => onEdit(emoji)}>
        Edit
      </Button>
      <Button
        size="small"
        disabled={redescribing}
        onClick={() => onRedescribe(emoji)}
        startIcon={redescribing ? <CircularProgress size={12} /> : undefined}
      >
        {redescribing ? 'Re-describing…' : 'Re-describe'}
      </Button>
    </Box>
  )
}

export function DeletedChip({ emoji }: { emoji: EmojiView }) {
  if (!emoji.deletedAt) return null
  return (
    <Chip
      size="small"
      variant="outlined"
      color="error"
      label={`deleted ${formatDay(emoji.deletedAt)}`}
    />
  )
}

export function AnimatedChip({ emoji }: { emoji: EmojiView }) {
  if (!emoji.animated) return null
  return <Chip size="small" variant="outlined" label="animated" />
}

export function EmojiCard({
  emoji,
  editing,
  reconciling,
  redescribing,
  onEdit,
  onCloseEdit,
  onRedescribe,
}: EmojiRowProps) {
  return (
    <Card variant="outlined" sx={{ opacity: emoji.deletedAt ? 0.6 : 1 }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <EmojiImage emoji={emoji} />
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace' }}>
              :{emoji.name}:
            </Typography>
            <AnimatedChip emoji={emoji} />
          </Box>
          <SourceChip emoji={emoji} />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          {editing ? (
            <DescriptionEditor emoji={emoji} onClose={onCloseEdit} />
          ) : (
            <Description emoji={emoji} reconciling={reconciling} />
          )}
        </Box>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mt: 1.5,
          }}
        >
          {emoji.deletedAt ? (
            <DeletedChip emoji={emoji} />
          ) : (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {emoji.describedAt ? formatWhen(emoji.describedAt) : ''}
            </Typography>
          )}
          {!editing && (
            <RowActions
              emoji={emoji}
              redescribing={redescribing}
              onEdit={onEdit}
              onRedescribe={onRedescribe}
            />
          )}
        </Box>
      </CardContent>
    </Card>
  )
}
