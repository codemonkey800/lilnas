'use client'

import { cns } from '@lilnas/utils/cns'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import Avatar from '@mui/material/Avatar'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Link from 'next/link'

import { YoinkLogo } from 'src/components/yoink-logo'
import type { AuthenticatedUser } from 'src/lib/user-status'

export function SiteHeader({
  user,
  signOutAction,
  onMenuToggle,
}: {
  user: AuthenticatedUser
  signOutAction: () => Promise<void>
  onMenuToggle: () => void
}) {
  return (
    <header
      className={cns(
        'flex h-14 shrink-0 items-center gap-2',
        'border-b border-carbon-500 bg-carbon-800 px-4',
      )}
    >
      <div className="md:hidden">
        <IconButton
          aria-label="Toggle sidebar"
          onClick={onMenuToggle}
          size="small"
        >
          <MenuIcon />
        </IconButton>
      </div>

      <Link href="/" className="flex items-center gap-2">
        <YoinkLogo className="h-6 text-terminal" />
        <span className="font-mono text-sm font-semibold text-terminal">
          yoink
        </span>
      </Link>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {user.image && (
          <Avatar
            src={user.image}
            alt={user.name ?? ''}
            sx={{ width: 32, height: 32 }}
          />
        )}
        <span className="hidden text-sm text-carbon-200 sm:block">
          {user.name}
        </span>
        <form action={signOutAction}>
          <Tooltip title="Sign out">
            <IconButton type="submit" size="small">
              <LogoutIcon className="size-4" />
            </IconButton>
          </Tooltip>
        </form>
      </div>
    </header>
  )
}
