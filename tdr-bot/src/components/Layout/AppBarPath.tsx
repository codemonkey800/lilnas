'use client'

import { usePathname } from 'next/navigation'
import { match } from 'ts-pattern'

export function AppBarPath() {
  const pathname = usePathname()
  const name = match(pathname)
    .with('/messages', () => 'Messages')
    .with('/settings', () => 'Settings')
    .otherwise(() => null)

  if (!name) {
    return null
  }

  return <span> - {name}</span>
}
