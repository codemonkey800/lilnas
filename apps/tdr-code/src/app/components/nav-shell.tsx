'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'

const NAV_LINKS = [
  { href: '/', label: 'Live' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/events', label: 'Events' },
  { href: '/config', label: 'Config' },
  { href: '/git-identity', label: 'Git identity' },
]

export function NavShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950">
        <div className="flex h-14 items-center gap-6 px-8">
          <span className="text-xs font-bold tracking-[0.15em] text-gray-400 uppercase">
            tdr-code
          </span>
          <div className="h-4 w-px bg-gray-700" />
          <nav className="flex items-center gap-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={cns(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  pathname === href ||
                    (href !== '/' && pathname.startsWith(href))
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:bg-gray-900 hover:text-gray-300',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 px-8 py-10">{children}</main>
    </div>
  )
}
