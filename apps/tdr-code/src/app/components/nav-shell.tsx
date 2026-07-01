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
      <header className="border-b border-gray-800 bg-gray-950 px-6 py-3">
        <nav className="flex items-center gap-6">
          <span className="text-sm font-bold tracking-tight text-white">
            tdr-code
          </span>
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cns(
                'text-sm font-medium transition-colors',
                pathname === href || (href !== '/' && pathname.startsWith(href))
                  ? 'text-white'
                  : 'text-gray-400 hover:text-gray-200',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  )
}
