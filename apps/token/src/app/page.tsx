'use client'

import AppsIcon from '@mui/icons-material/Apps'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'

import { api } from 'src/components/api'
import { AppCard } from 'src/components/AppCard'

export default function HomePage() {
  const router = useRouter()

  const {
    data: apps,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['apps'],
    queryFn: api.listApps,
  })

  if (isLoading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1,
          minHeight: 300,
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">
          Failed to load apps:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 4 } }}>
      <Box sx={{ mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <AppsIcon sx={{ color: 'primary.light', fontSize: 28 }} />
          <Typography
            variant="h5"
            fontWeight={700}
            sx={{ fontFamily: 'Syne, sans-serif', letterSpacing: '-0.02em' }}
          >
            Applications
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Select an application to manage its API tokens.
        </Typography>
      </Box>

      {apps && apps.length === 0 ? (
        <Box
          sx={{
            py: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            color: 'text.secondary',
          }}
        >
          <AppsIcon sx={{ fontSize: 56, opacity: 0.2 }} />
          <Typography variant="body1" sx={{ opacity: 0.5 }}>
            No applications found
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.35 }}>
            The apps manifest may not have been generated yet.
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {apps?.map(app => (
            <Grid key={app.slug} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
              <AppCard
                app={app}
                onClick={() => router.push(`/apps/${app.slug}`)}
              />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  )
}
