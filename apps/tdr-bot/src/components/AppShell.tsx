'use client'

import MenuIcon from '@mui/icons-material/Menu'
import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ReactNode, useState } from 'react'

import { SadPepeIcon } from './SadPepeIcon'

const NAV_LINKS = [
  { href: '/settings', label: 'Settings' },
  { href: '/transcript', label: 'Transcript' },
  { href: '/reminders', label: 'Reminders' },
  { href: '/emojis', label: 'Emojis' },
  { href: '/playground', label: 'Playground' },
]

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname()
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

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
              minWidth: 0,
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

            <Typography variant="h6" component="span" fontWeight={600} noWrap>
              TDR Bot
            </Typography>
          </Box>

          <Box
            component="nav"
            sx={{ display: { xs: 'none', md: 'flex' }, gap: 1 }}
          >
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

          <IconButton
            color="inherit"
            edge="end"
            aria-label="Open navigation"
            aria-controls={menuAnchor ? 'nav-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={menuAnchor ? 'true' : undefined}
            onClick={event => setMenuAnchor(event.currentTarget)}
            sx={{ display: { xs: 'inline-flex', md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <Menu
            id="nav-menu"
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            sx={{ display: { md: 'none' } }}
          >
            {NAV_LINKS.map(({ href, label }) => (
              <MenuItem
                key={href}
                component={Link}
                href={href}
                selected={pathname.startsWith(href)}
                onClick={() => setMenuAnchor(null)}
              >
                {label}
              </MenuItem>
            ))}
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="main" sx={{ flexGrow: 1 }}>
        {children}
      </Box>
    </Box>
  )
}
