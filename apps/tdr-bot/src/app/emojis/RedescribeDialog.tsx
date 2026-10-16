import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Paper from '@mui/material/Paper'

import type { EmojiView } from 'src/api/api.types'
import { useRedescribeEmoji } from 'src/queries/useEmojis'

import { EmojiImage } from './EmojiImage'

interface RedescribeDialogProps {
  emoji: EmojiView | null
  onClose: () => void
}

/** Confirms replacing a manual description with an AI one. */
export function RedescribeDialog({ emoji, onClose }: RedescribeDialogProps) {
  const redescribe = useRedescribeEmoji()

  const close = () => {
    redescribe.reset()
    onClose()
  }

  const confirm = () => {
    if (!emoji) return
    redescribe.mutate(emoji.id, { onSuccess: close })
  }

  return (
    <Dialog open={!!emoji} onClose={close} fullWidth maxWidth="xs">
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {emoji && <EmojiImage emoji={emoji} size={40} />}
          Re-describe :{emoji?.name}:?
        </Box>
      </DialogTitle>
      <DialogContent>
        <DialogContentText color="text.primary">
          Replace this hand-written description with an AI one?
        </DialogContentText>
        <Paper
          variant="outlined"
          sx={{
            mt: 1.5,
            px: 1.5,
            py: 1,
            typography: 'body2',
            color: 'text.secondary',
          }}
        >
          {emoji?.description}
        </Paper>
        {redescribe.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {redescribe.error.message}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={close}>
          Keep
        </Button>
        <Button
          variant="contained"
          disabled={redescribe.isPending}
          onClick={confirm}
          startIcon={
            redescribe.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          Re-describe
        </Button>
      </DialogActions>
    </Dialog>
  )
}
