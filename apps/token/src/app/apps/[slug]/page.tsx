'use client'

import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Paper from '@mui/material/Paper'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'

import { api } from 'src/components/api'
import { CreateTokenModal } from 'src/components/CreateTokenModal'
import { TokenList } from 'src/components/TokenList'

export default function AppDetailPage() {
  const params = useParams()
  const router = useRouter()
  const queryClient = useQueryClient()
  const slug = params['slug'] as string

  const [modalOpen, setModalOpen] = useState(false)

  const {
    data: app,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['app', slug],
    queryFn: () => api.getApp(slug),
  })

  const handleDelete = async (tokenId: string) => {
    await api.deleteToken(slug, tokenId)
    await queryClient.invalidateQueries({ queryKey: ['app', slug] })
    await queryClient.invalidateQueries({ queryKey: ['apps'] })
  }

  const handleCreated = async () => {
    await queryClient.invalidateQueries({ queryKey: ['app', slug] })
    await queryClient.invalidateQueries({ queryKey: ['apps'] })
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <IconButton
          onClick={() => router.push('/')}
          size="small"
          sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
        >
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          All Applications
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error instanceof Error ? error.message : 'Failed to load app'}
        </Alert>
      )}

      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          mb: 3,
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box>
          {isLoading ? (
            <>
              <Skeleton variant="text" width={180} height={40} />
              <Skeleton variant="text" width={120} height={20} />
            </>
          ) : (
            <>
              <Typography
                variant="h5"
                fontWeight={700}
                sx={{
                  fontFamily: 'Syne, sans-serif',
                  letterSpacing: '-0.02em',
                  lineHeight: 1.2,
                }}
              >
                {app?.slug}
              </Typography>
              <Typography
                variant="caption"
                component="code"
                sx={{
                  color: 'text.secondary',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.72rem',
                }}
              >
                {app?.packageName}
              </Typography>
            </>
          )}
        </Box>

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setModalOpen(true)}
          disabled={isLoading || !!error}
        >
          Create Token
        </Button>
      </Box>

      <Paper sx={{ overflow: 'hidden' }}>
        <Box
          sx={{
            px: 3,
            py: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography
            variant="subtitle2"
            fontWeight={700}
            sx={{ fontFamily: 'Syne, sans-serif', letterSpacing: '0.02em' }}
          >
            API Tokens
          </Typography>
          {!isLoading && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {app?.tokens.length ?? 0}{' '}
              {app?.tokens.length === 1 ? 'token' : 'tokens'}
            </Typography>
          )}
        </Box>
        <Divider />

        {isLoading ? (
          <Box sx={{ p: 3 }}>
            {[1, 2, 3].map(i => (
              <Skeleton
                key={i}
                variant="rectangular"
                height={52}
                sx={{ mb: 1, borderRadius: 1 }}
              />
            ))}
          </Box>
        ) : (
          <TokenList tokens={app?.tokens ?? []} onDelete={handleDelete} />
        )}
      </Paper>

      {app && (
        <CreateTokenModal
          open={modalOpen}
          appSlug={slug}
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </Box>
  )
}
