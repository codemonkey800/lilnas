'use client'

import { AppBar, Button, Icon, Sheet } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ReactNode, useState } from 'react'

export const NAV_LINKS = [
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
  const [menuOpen, setMenuOpen] = useState(false)

  const links = NAV_LINKS.map(({ href, label }) => ({
    href,
    label,
    active: pathname.startsWith(href),
    render: <Link href={href} />,
  }))

  return (
    <>
      <AppBar
        app="tdr"
        className="sticky top-0 z-40"
        links={links}
        sheet={
          <Sheet.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Sheet.Trigger
              render={
                <Button
                  aria-label="Open navigation"
                  icon="list"
                  variant="ghost"
                />
              }
            />
            <Sheet.Popup side="bottom">
              <Sheet.Title className="sr-only">Navigation</Sheet.Title>
              <nav aria-label="Menu" className="flex flex-col gap-1 pb-3">
                {links.map(({ href, label, active }) => (
                  <Link
                    key={href}
                    aria-current={active ? 'page' : undefined}
                    className={cns(
                      'flex h-11 items-center justify-between rounded-md px-3 text-body',
                      active
                        ? 'bg-accent-ghost font-medium text-accent-hi'
                        : 'text-ink-2',
                    )}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                  >
                    {label}
                    {active && <Icon name="check" size={14} />}
                  </Link>
                ))}
              </nav>
            </Sheet.Popup>
          </Sheet.Root>
        }
      />
      <main className="flex-1">{children}</main>
    </>
  )
}
