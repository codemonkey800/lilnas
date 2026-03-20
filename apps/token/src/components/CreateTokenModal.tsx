'use client'

import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { api, type CreateTokenResponse } from './api'

interface CreateTokenModalProps {
  open: boolean
  appSlug: string
  onClose: () => void
  onCreated: () => void
}

export function CreateTokenModal({
  open,
  appSlug,
  onClose,
  onCreated,
}: CreateTokenModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateTokenResponse | null>(null)
  const [copied, setCopied] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    setError(null)

    try {
      const result = await api.createToken(appSlug, {
        name: name.trim(),
        description: description.trim() || undefined,
      })
      setCreated(result)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!created) return
    await navigator.clipboard.writeText(created.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    if (loading) return
    setName('')
    setDescription('')
    setError(null)
    setCreated(null)
    setCopied(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          border: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      <DialogTitle
        sx={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 700,
          borderBottom: '1px solid',
          borderColor: 'divider',
          pb: 2,
        }}
      >
        {created ? 'Token Created' : 'Create New Token'}
      </DialogTitle>

      {!created ? (
        <form onSubmit={handleSubmit}>
          <DialogContent sx={{ pt: 3 }}>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <TextField
              label="Token Name"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              fullWidth
              autoFocus
              placeholder="e.g. Production API Key"
              sx={{ mb: 2 }}
              inputProps={{ maxLength: 100 }}
            />
            <TextField
              label="Description (optional)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={2}
              placeholder="What is this token used for?"
              inputProps={{ maxLength: 500 }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
            <Button onClick={handleClose} disabled={loading} color="inherit">
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={!name.trim() || loading}
              startIcon={
                loading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : undefined
              }
            >
              {loading ? 'Creating...' : 'Create Token'}
            </Button>
          </DialogActions>
        </form>
      ) : (
        <>
          <DialogContent sx={{ pt: 3 }}>
            <Alert
              severity="warning"
              icon={<WarningAmberIcon />}
              sx={{ mb: 3, alignItems: 'flex-start' }}
            >
              <Typography variant="body2" fontWeight={600}>
                Copy this token now — it won&apos;t be shown again.
              </Typography>
              <Typography
                variant="caption"
                sx={{ mt: 0.5, display: 'block', opacity: 0.85 }}
              >
                Once you close this dialog, the full token value cannot be
                recovered.
              </Typography>
            </Alert>

            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                mb: 0.75,
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Token Value
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1.5,
                borderRadius: 1,
                bgcolor: 'rgba(37, 99, 235, 0.08)',
                border: '1px solid',
                borderColor: 'rgba(96, 165, 250, 0.25)',
              }}
            >
              <Typography
                component="code"
                sx={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.8rem',
                  color: 'primary.light',
                  flexGrow: 1,
                  wordBreak: 'break-all',
                }}
              >
                {created.value}
              </Typography>
              <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                <IconButton
                  size="small"
                  onClick={handleCopy}
                  sx={{
                    flexShrink: 0,
                    color: copied ? 'success.main' : 'primary.light',
                  }}
                >
                  {copied ? (
                    <CheckCircleIcon fontSize="small" />
                  ) : (
                    <ContentCopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>

            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1.5,
              }}
            >
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Name
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.25 }}>
                  {created.name}
                </Typography>
              </Box>
              <Box>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Token ID
                </Typography>
                <Typography
                  variant="body2"
                  component="code"
                  sx={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.75rem',
                    mt: 0.25,
                    display: 'block',
                  }}
                >
                  {created.id}
                </Typography>
              </Box>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 3 }}>
            <Button
              variant="contained"
              onClick={handleClose}
              startIcon={<CheckCircleIcon />}
            >
              Done
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
