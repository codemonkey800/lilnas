'use client'

import KeyIcon from '@mui/icons-material/Key'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { ReactNode } from 'react'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexGrow: 1,
            }}
          >
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '8px',
                bgcolor: 'primary.dark',
                border: '1px solid',
                borderColor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <KeyIcon sx={{ color: 'primary.light', fontSize: 20 }} />
            </Box>
            <Box>
              <Typography
                variant="subtitle1"
                component="span"
                fontWeight={700}
                sx={{
                  letterSpacing: '-0.01em',
                  lineHeight: 1.2,
                  display: 'block',
                  fontFamily: 'Syne, sans-serif',
                }}
              >
                Token Manager
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  letterSpacing: '0.04em',
                  lineHeight: 1,
                }}
              >
                API Token Management
              </Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      <Box
        component="main"
        sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </Box>
    </Box>
  )
}
