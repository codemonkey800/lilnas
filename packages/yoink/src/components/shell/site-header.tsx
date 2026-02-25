'use client'

import { cns } from '@lilnas/utils/cns'
import { LogOut } from 'lucide-react'
import Image from 'next/image'

import { Button } from 'src/components/button'
import { SidebarTrigger } from 'src/components/ui/sidebar'
import type { AuthenticatedUser } from 'src/lib/user-status'

export function SiteHeader({
  user,
  signOutAction,
}: {
  user: AuthenticatedUser
  signOutAction: () => Promise<void>
}) {
  return (
    <header
      className={cns(
        'flex h-14 shrink-0 items-center gap-2',
        'border-b border-sidebar-border bg-carbon-800 px-4',
      )}
    >
      <SidebarTrigger className="md:hidden" />

      <span className="font-mono text-sm font-bold text-terminal text-glow md:hidden">
        yoink
      </span>

      <div className="ml-auto flex items-center gap-3">
        {user.image && (
          <Image
            src={user.image}
            alt={user.name ?? ''}
            width={32}
            height={32}
            className="size-8 rounded-full"
          />
        )}
        <span className="hidden text-sm text-carbon-200 sm:block">
          {user.name}
        </span>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="icon" className="size-8">
            <LogOut className="size-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </form>
      </div>
    </header>
  )
}
