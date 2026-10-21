import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { EmojiView } from 'src/api/api.types'
import { useUpdateEmoji } from 'src/queries/useEmojis'

import { canSaveDescription, DESCRIPTION_MAX } from './format'

interface DescriptionEditorProps {
  emoji: EmojiView
  onClose: () => void
}

/** The inline description editor; saving marks the description manual. */
export function DescriptionEditor({ emoji, onClose }: DescriptionEditorProps) {
  const [draft, setDraft] = useState(emoji.description ?? '')
  const update = useUpdateEmoji()

  const save = () => {
    update.mutate(
      { id: emoji.id, description: draft.trim() },
      { onSuccess: onClose },
    )
  }

  return (
    <Box>
      <TextField
        multiline
        fullWidth
        autoFocus
        minRows={3}
        size="small"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        slotProps={{
          htmlInput: {
            maxLength: DESCRIPTION_MAX,
            'aria-label': `Description of :${emoji.name}:`,
          },
        }}
      />
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 1,
          mt: 0.5,
        }}
      >
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Saving marks this description as manual.
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {draft.length} / {DESCRIPTION_MAX}
        </Typography>
      </Box>
      {update.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {update.error.message}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button
          size="small"
          variant="contained"
          disabled={
            !canSaveDescription(draft, emoji.description) || update.isPending
          }
          onClick={save}
          startIcon={
            update.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          Save
        </Button>
        <Button size="small" color="inherit" onClick={onClose}>
          Cancel
        </Button>
      </Box>
    </Box>
  )
}
