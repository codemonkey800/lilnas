'use client'

import { type ReactNode, useState } from 'react'

import { signOutAction } from 'src/app/(auth)/login/actions'
import { AppSidebar } from 'src/components/shell/app-sidebar'
import { SiteHeader } from 'src/components/shell/site-header'
import type { AuthenticatedUser } from 'src/lib/user-status'

const DRAWER_WIDTH = 224

export function AppShell({
  user,
  children,
}: {
  user: AuthenticatedUser
  children: ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        user={user}
        signOutAction={signOutAction}
        onMenuToggle={() => setMobileOpen(prev => !prev)}
      />
      <div className="flex flex-1">
        <AppSidebar
          isAdmin={user.isAdmin}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
          width={DRAWER_WIDTH}
        />
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
