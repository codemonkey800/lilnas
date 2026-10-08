'use client'

import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ReactNode } from 'react'

import { SadPepeIcon } from './SadPepeIcon'

const NAV_LINKS = [
  { href: '/settings', label: 'Settings' },
  { href: '/transcript', label: 'Transcript' },
  { href: '/reminders', label: 'Reminders' },
]

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()

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
                width: 40,
                height: 40,
                borderRadius: '50%',
                overflow: 'hidden',
                border: '2px solid',
                borderColor: 'primary.light',
                bgcolor: 'primary.dark',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SadPepeIcon width={40} height={40} aria-label="TDR Bot" />
            </Box>

            <Typography variant="h6" component="span" fontWeight={600}>
              TDR Bot
            </Typography>
          </Box>

          <Box component="nav" sx={{ display: 'flex', gap: 1 }}>
            {NAV_LINKS.map(({ href, label }) => (
              <Button
                key={href}
                component={Link}
                href={href}
                color="inherit"
                sx={{
                  fontWeight: pathname.startsWith(href) ? 700 : 400,
                  opacity: pathname.startsWith(href) ? 1 : 0.75,
                }}
              >
                {label}
              </Button>
            ))}
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1 }}>
        {children}
      </Box>
    </Box>
  )
}
