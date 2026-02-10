'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HiArrowLeftOnRectangle,
  HiClipboardDocumentList,
  HiCog6Tooth,
  HiHome,
  HiRectangleStack,
} from 'react-icons/hi2'

import { SyncIcon } from 'src/components/sync-icon'
import { Avatar } from 'src/components/ui/avatar'
import { signOutAction } from 'src/lib/sign-out-action'

const navItems = [
  { label: 'Home', href: '/', icon: HiHome },
  { label: 'Check-ins', href: '/check-ins', icon: HiClipboardDocumentList },
  { label: 'Templates', href: '/templates', icon: HiRectangleStack },
  { label: 'Settings', href: '/settings/profile', icon: HiCog6Tooth },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href)
}

export interface NavBarProps {
  displayName: string
  avatarInitial: string
}

export function NavBar({ displayName, avatarInitial }: NavBarProps) {
  const pathname = usePathname()

  return (
    <>
      {/* ── Desktop top bar ── */}
      <header
        className={cns(
          'fixed inset-x-0 top-0 z-40 hidden h-16 md:flex',
          'items-center justify-between',
          'border-b border-border-subtle bg-bg-raised px-6 shadow-sm',
        )}
      >
        {/* Left: Logo */}
        <Link href="/" className="flex items-center gap-2">
          <SyncIcon className="h-6 w-6 text-primary-400" />
          <span className="text-lg font-bold text-text">Sync</span>
        </Link>

        {/* Center: Nav links */}
        <nav className="flex items-center gap-1">
          {navItems.map(item => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cns(
                  'inline-flex items-center gap-2 rounded-sm px-3 py-2',
                  'text-sm font-medium',
                  'transition-colors duration-150 ease-smooth',
                  'focus-visible:shadow-focus',
                  active
                    ? 'bg-bg-surface text-primary-400'
                    : 'text-text-secondary hover:bg-bg-surface hover:text-text',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Right: User section */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Avatar initial={avatarInitial} size="sm" />
            <span className="hidden text-sm font-medium text-text-secondary lg:inline">
              {displayName}
            </span>
          </div>

          <form action={signOutAction}>
            <button
              type="submit"
              className={cns(
                'flex h-10 w-10 items-center justify-center rounded-sm',
                'text-text-secondary',
                'transition-colors duration-150 ease-smooth',
                'hover:bg-bg-surface hover:text-text',
                'focus-visible:shadow-focus',
              )}
              aria-label="Sign out"
            >
              <HiArrowLeftOnRectangle className="h-5 w-5" />
            </button>
          </form>
        </div>
      </header>

      {/* ── Mobile top bar ── */}
      <header
        className={cns(
          'fixed inset-x-0 top-0 z-40 flex h-16 md:hidden',
          'items-center justify-between',
          'border-b border-border-subtle bg-bg-raised px-4 shadow-sm',
        )}
      >
        <Link href="/" className="flex items-center gap-2">
          <SyncIcon className="h-6 w-6 text-primary-400" />
          <span className="text-lg font-bold text-text">Sync</span>
        </Link>

        <div className="flex items-center gap-2">
          <Avatar initial={avatarInitial} size="sm" />

          <form action={signOutAction}>
            <button
              type="submit"
              className={cns(
                'flex h-10 w-10 items-center justify-center rounded-sm',
                'text-text-secondary',
                'transition-colors duration-150 ease-smooth',
                'hover:bg-bg-surface hover:text-text',
                'focus-visible:shadow-focus',
              )}
              aria-label="Sign out"
            >
              <HiArrowLeftOnRectangle className="h-5 w-5" />
            </button>
          </form>
        </div>
      </header>

      {/* ── Mobile bottom tab bar ── */}
      <nav
        className={cns(
          'fixed inset-x-0 bottom-0 z-40 flex md:hidden',
          'h-16 items-center justify-around',
          'border-t border-border-subtle bg-bg-raised',
          'pb-[env(safe-area-inset-bottom)]',
        )}
      >
        {navItems.map(item => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cns(
                'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5',
                'rounded-sm px-3 py-1',
                'transition-colors duration-150 ease-smooth',
                'focus-visible:shadow-focus',
                active ? 'text-primary-400' : 'text-text-muted',
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-xs font-medium">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
