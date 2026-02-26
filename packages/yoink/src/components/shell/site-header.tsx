'use client'

import { cns } from '@lilnas/utils/cns'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import SearchIcon from '@mui/icons-material/Search'
import Avatar from '@mui/material/Avatar'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import Tooltip from '@mui/material/Tooltip'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'

import { YoinkLogo } from 'src/components/yoink-logo'
import type { AuthenticatedUser } from 'src/lib/user-status'

const searchInputSx = {
  flex: 1,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8125rem',
  color: 'var(--color-carbon-100)',
  '& .MuiInputBase-input::placeholder': {
    color: 'var(--color-carbon-400)',
    opacity: 1,
  },
} as const

export function SiteHeader({
  user,
  signOutAction,
  onMenuToggle,
}: {
  user: AuthenticatedUser
  signOutAction: () => Promise<void>
  onMenuToggle: () => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [searchOpen, setSearchOpen] = useState(false)

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`)
    } else {
      router.push('/search')
    }
    setSearchOpen(false)
  }

  return (
    <header
      className={cns(
        'flex h-14 shrink-0 items-center gap-2',
        'border-b border-carbon-500 bg-carbon-800 px-4',
      )}
    >
      {searchOpen ? (
        <div className="flex flex-1 items-center gap-2 sm:hidden">
          <IconButton
            aria-label="Close search"
            onClick={() => setSearchOpen(false)}
            size="small"
          >
            <ArrowBackIcon className="size-5" />
          </IconButton>
          <form
            onSubmit={handleSearch}
            className={cns(
              'flex flex-1 items-center gap-2 rounded-md',
              'border border-carbon-500 bg-carbon-900 px-2',
              'transition-colors focus-within:border-terminal/60',
              'focus-within:shadow-[0_0_0_2px_rgba(57,255,20,0.2)]',
            )}
          >
            <IconButton type="submit" size="small" className="shrink-0">
              <SearchIcon className="size-4 text-carbon-400" />
            </IconButton>
            <InputBase
              autoFocus
              placeholder="Search movies, shows…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              sx={searchInputSx}
            />
          </form>
        </div>
      ) : (
        <>
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

          <form
            onSubmit={handleSearch}
            className={cns(
              'hidden sm:flex',
              'w-64 focus-within:w-96 items-center gap-2 rounded-md',
              'border border-carbon-500 bg-carbon-900 px-2',
              'transition-all duration-200 focus-within:border-terminal/60',
              'focus-within:shadow-[0_0_0_2px_rgba(57,255,20,0.2)]',
            )}
          >
            <IconButton type="submit" size="small" className="shrink-0">
              <SearchIcon className="size-4 text-carbon-400" />
            </IconButton>
            <InputBase
              placeholder="Search movies, shows…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              sx={searchInputSx}
            />
          </form>

          <div className="flex items-center gap-3">
            <div className="sm:hidden">
              <Tooltip title="Search">
                <IconButton size="small" onClick={() => setSearchOpen(true)}>
                  <SearchIcon className="size-4" />
                </IconButton>
              </Tooltip>
            </div>
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
        </>
      )}
    </header>
  )
}
