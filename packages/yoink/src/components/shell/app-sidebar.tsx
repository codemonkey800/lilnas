'use client'

import { cns } from '@lilnas/utils/cns'
import DownloadIcon from '@mui/icons-material/Download'
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary'
import HistoryIcon from '@mui/icons-material/History'
import ShieldIcon from '@mui/icons-material/Shield'
import StorageIcon from '@mui/icons-material/Storage'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { YoinkLogo } from 'src/components/yoink-logo'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType } from 'react'

const mainNav = [
  { label: 'Library', icon: VideoLibraryIcon, href: '/' },
  { label: 'Downloads', icon: DownloadIcon, href: '/downloads' },
  { label: 'History', icon: HistoryIcon, href: '/history' },
  { label: 'Storage', icon: StorageIcon, href: '/storage' },
] as const

const adminNav = [{ label: 'Admin', icon: ShieldIcon, href: '/admin' }] as const

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

interface NavItemProps {
  label: string
  icon: ComponentType<{ className?: string }>
  href: string
  active: boolean
}

function NavItem({ label, icon: Icon, href, active }: NavItemProps) {
  return (
    <ListItemButton
      component={Link}
      href={href}
      selected={active}
      className={cns(
        'border-l-2 border-transparent',
        active && 'border-terminal',
      )}
    >
      <ListItemIcon>
        <Icon className="size-5" />
      </ListItemIcon>
      <ListItemText
        primary={label}
        primaryTypographyProps={{ variant: 'body2', fontFamily: 'inherit' }}
      />
    </ListItemButton>
  )
}

interface AppSidebarProps {
  isAdmin: boolean
  mobileOpen: boolean
  onMobileClose: () => void
  width: number
}

export function AppSidebar({
  isAdmin,
  mobileOpen,
  onMobileClose,
  width,
}: AppSidebarProps) {
  const pathname = usePathname()
  const muiTheme = useTheme()
  const isDesktop = useMediaQuery(muiTheme.breakpoints.up('md'))

  const navItems = (
    <List component="div" className="flex-1 px-2">
      {mainNav.map(item => (
        <NavItem
          key={item.href}
          label={item.label}
          icon={item.icon}
          href={item.href}
          active={isActive(pathname, item.href)}
        />
      ))}

      {isAdmin && (
        <>
          <Divider className="my-2" />
          {adminNav.map(item => (
            <NavItem
              key={item.href}
              label={item.label}
              icon={item.icon}
              href={item.href}
              active={isActive(pathname, item.href)}
            />
          ))}
        </>
      )}
    </List>
  )

  if (isDesktop) {
    return (
      <aside
        className={cns(
          'hidden shrink-0 border-r border-carbon-500 bg-carbon-800 md:block',
        )}
        style={{ width }}
      >
        <nav className="flex h-full flex-col pt-2">{navItems}</nav>
      </aside>
    )
  }

  return (
    <Drawer
      variant="temporary"
      open={mobileOpen}
      onClose={onMobileClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        '& .MuiDrawer-paper': { width },
      }}
    >
      <nav className="flex h-full flex-col">
        <Link
          href="/"
          onClick={onMobileClose}
          className="flex items-center gap-2 px-4 py-4"
        >
          <YoinkLogo className="h-8 text-terminal" />
          <span className="font-mono text-lg font-semibold text-terminal">
            yoink
          </span>
        </Link>
        {navItems}
      </nav>
    </Drawer>
  )
}
