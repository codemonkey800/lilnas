'use client'

import { Density, ToastProvider } from '@lilnas/ui'
import type { JSX, ReactNode } from 'react'

/**
 * Toasts and compact density around the whole app, /login included.
 * tdr-code is a workshop tool, so every screen is compact.
 *
 * A client component because `@lilnas/ui` ships as CommonJS, and a server
 * component can't read the `'use client'` exports through its barrel (the
 * prerender fails with "Element type is invalid … undefined").
 */
export function UiProviders({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  return (
    <ToastProvider>
      <Density className="flex min-h-screen flex-col" mode="compact">
        {children}
      </Density>
    </ToastProvider>
  )
}
