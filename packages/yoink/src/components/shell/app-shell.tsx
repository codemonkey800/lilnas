'use client'

import { type ReactNode, useState } from 'react'

import type { AuthenticatedUser } from 'src/auth-user'
import { QueryProvider } from 'src/components/query-provider'
import { AppSidebar } from 'src/components/shell/app-sidebar'
import { ScrollContainerProvider } from 'src/components/shell/scroll-container'
import { SiteHeader } from 'src/components/shell/site-header'
import { ToastProvider } from 'src/components/toast-provider'

const DRAWER_WIDTH = 224

export function AppShell({
  user,
  children,
}: {
  user: AuthenticatedUser
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  return (
    <QueryProvider>
      <ToastProvider>
        <div className="flex h-dvh flex-col overflow-hidden">
          <SiteHeader
            user={user}
            onMenuToggle={() => setMobileOpen(prev => !prev)}
          />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <AppSidebar
              isAdmin={user.isAdmin}
              mobileOpen={mobileOpen}
              onMobileClose={() => setMobileOpen(false)}
              width={DRAWER_WIDTH}
            />
            <div ref={setScrollEl} className="flex-1 overflow-y-auto">
              <ScrollContainerProvider value={scrollEl}>
                <main className="mx-auto w-full max-w-6xl p-4 md:p-6">
                  {children}
                </main>
              </ScrollContainerProvider>
            </div>
          </div>
        </div>
      </ToastProvider>
    </QueryProvider>
  )
}
