'use client'

import KeyIcon from '@mui/icons-material/Key'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'

import { type AppDetails } from './api'

interface AppCardProps {
  app: AppDetails
  onClick: () => void
}

export function AppCard({ app, onClick }: AppCardProps) {
  return (
    <Card
      sx={{
        height: '100%',
        transition: 'border-color 0.2s, transform 0.15s',
        '&:hover': {
          borderColor: 'primary.main',
          transform: 'translateY(-2px)',
        },
      }}
    >
      <CardActionArea onClick={onClick} sx={{ height: '100%' }}>
        <CardContent sx={{ p: 3, height: '100%' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 2,
            }}
          >
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: '10px',
                bgcolor: 'rgba(37, 99, 235, 0.15)',
                border: '1px solid rgba(96, 165, 250, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <KeyIcon sx={{ color: 'primary.light', fontSize: 22 }} />
            </Box>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography
                variant="subtitle1"
                fontWeight={700}
                sx={{
                  fontFamily: 'Syne, sans-serif',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.3,
                  mb: 0.5,
                }}
                noWrap
              >
                {app.slug}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '0.7rem',
                  display: 'block',
                  mb: 1.5,
                }}
                noWrap
              >
                {app.packageName}
              </Typography>

              <Chip
                label={`${app.tokenCount} ${app.tokenCount === 1 ? 'token' : 'tokens'}`}
                size="small"
                sx={{
                  bgcolor:
                    app.tokenCount > 0
                      ? 'rgba(37, 99, 235, 0.15)'
                      : 'rgba(255, 255, 255, 0.05)',
                  color:
                    app.tokenCount > 0 ? 'primary.light' : 'text.secondary',
                  border: '1px solid',
                  borderColor:
                    app.tokenCount > 0
                      ? 'rgba(96, 165, 250, 0.25)'
                      : 'rgba(255,255,255,0.08)',
                  fontWeight: 600,
                  fontSize: '0.7rem',
                  height: 22,
                }}
              />
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
