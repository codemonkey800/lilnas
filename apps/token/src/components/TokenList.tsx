'use client'

import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import TokenIcon from '@mui/icons-material/Token'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { type TokenRecord } from './api'

interface TokenListProps {
  tokens: TokenRecord[]
  onDelete: (tokenId: string) => Promise<void>
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TokenList({ tokens, onDelete }: TokenListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TokenRecord | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const handleCopyPrefix = async (token: TokenRecord) => {
    await navigator.clipboard.writeText(token.id)
    setCopiedId(token.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return

    setDeletingId(confirmDelete.id)
    setDeleteError(null)

    try {
      await onDelete(confirmDelete.id)
      setConfirmDelete(null)
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete token',
      )
    } finally {
      setDeletingId(null)
    }
  }

  if (tokens.length === 0) {
    return (
      <Box
        sx={{
          py: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
          color: 'text.secondary',
        }}
      >
        <TokenIcon sx={{ fontSize: 48, opacity: 0.3 }} />
        <Typography variant="body1" sx={{ opacity: 0.6 }}>
          No tokens yet
        </Typography>
        <Typography variant="caption" sx={{ opacity: 0.4 }}>
          Create a token to get started
        </Typography>
      </Box>
    )
  }

  return (
    <>
      <TableContainer>
        <Table size="medium">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Prefix</TableCell>
              <TableCell>Token ID</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tokens.map(token => (
              <TableRow
                key={token.id}
                sx={{
                  '&:hover': { bgcolor: 'rgba(96, 165, 250, 0.04)' },
                  transition: 'background 0.15s',
                }}
              >
                <TableCell>
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {token.name}
                    </Typography>
                    {token.description && (
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary' }}
                      >
                        {token.description}
                      </Typography>
                    )}
                  </Box>
                </TableCell>
                <TableCell>
                  <Chip
                    label={`${token.tokenPrefix}...`}
                    size="small"
                    sx={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: '0.72rem',
                      bgcolor: 'rgba(37, 99, 235, 0.12)',
                      color: 'primary.light',
                      border: '1px solid rgba(96, 165, 250, 0.2)',
                      borderRadius: '4px',
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography
                      component="code"
                      variant="caption"
                      sx={{
                        fontFamily: 'JetBrains Mono, monospace',
                        color: 'text.secondary',
                        fontSize: '0.72rem',
                      }}
                    >
                      {token.id.slice(0, 12)}...
                    </Typography>
                    <Tooltip
                      title={copiedId === token.id ? 'Copied!' : 'Copy ID'}
                    >
                      <IconButton
                        size="small"
                        onClick={() => handleCopyPrefix(token)}
                        sx={{
                          color:
                            copiedId === token.id
                              ? 'success.main'
                              : 'text.secondary',
                          p: 0.25,
                        }}
                      >
                        <ContentCopyIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary' }}
                  >
                    {formatDate(token.createdAt)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title="Revoke token">
                    <IconButton
                      size="small"
                      onClick={() => setConfirmDelete(token)}
                      disabled={deletingId === token.id}
                      sx={{
                        color: 'error.main',
                        opacity: 0.7,
                        '&:hover': { opacity: 1 },
                      }}
                    >
                      {deletingId === token.id ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <DeleteOutlineIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog
        open={!!confirmDelete}
        onClose={() => !deletingId && setConfirmDelete(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <DialogTitle sx={{ fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
          Revoke Token?
        </DialogTitle>
        <DialogContent>
          {deleteError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {deleteError}
            </Alert>
          )}
          <DialogContentText>
            Are you sure you want to revoke{' '}
            <strong>&quot;{confirmDelete?.name}&quot;</strong>? Any applications
            using this token will immediately lose access. This action cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={() => setConfirmDelete(null)}
            disabled={!!deletingId}
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            disabled={!!deletingId}
            startIcon={
              deletingId ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <DeleteOutlineIcon />
              )
            }
          >
            {deletingId ? 'Revoking...' : 'Revoke Token'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
