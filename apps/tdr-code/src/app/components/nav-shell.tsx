'use client'

import { AppBar, Avatar, Button, Sheet } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type JSX, type ReactNode, useState } from 'react'

import { signOut, useSession } from 'src/app/lib/auth-client'

const NAV_LINKS = [
  { href: '/', label: 'Live' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/events', label: 'Events' },
  { href: '/logs', label: 'Logs' },
  { href: '/config', label: 'Config' },
  { href: '/git', label: 'Git' },
]

// Fixed width for the loading/logged-out placeholders so the pending ->
// resolved transition never shrinks the app bar (plan requirement: "a
// fixed-width loading placeholder while the client-side session fetch
// resolves — no layout shift, no flash of logged-out chrome"). Discord caps
// display names at 32 characters, so the resolved badge never truncates one.
const USER_BADGE_WIDTH = 'w-40'

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(href))
}

function initialsOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

function logOut(): void {
  void signOut({
    fetchOptions: {
      // Lands on a BARE /login — no ?error= param — so a deliberate
      // logout is visually distinct from the involuntary
      // session_expired bounce (plan requirement).
      onSuccess: () => {
        window.location.href = '/login'
      },
    },
  })
}

type NavUser = { name: string; image?: string | null }

/**
 * useSession() (better-auth/react) is the CLIENT-SOURCED session read the
 * plan requires — layout.tsx (the server component that renders NavShell)
 * never reads a session itself; NavShell fetches it here, client-side. The
 * user is the Discord display name (`user.name`, Better Auth's default
 * Discord mapping), preferred over a raw username for recognition.
 *
 * `undefined` while pending, and when there is no session: proxy.ts already
 * redirects an unauthenticated page visit to /login, and every /api/* call
 * is guarded server-side regardless, so "no session" is a defensive blank
 * rather than a real reachable UI state.
 */
function useNavUser(): { user: NavUser | undefined; pending: boolean } {
  const { data, isPending } = useSession()
  return { user: data?.user, pending: isPending }
}

/** Avatar, name and Log out at the app bar's right edge (md and up). */
function UserBadge({ user }: { user: NavUser | undefined }): JSX.Element {
  if (!user) {
    return <div className={cns(USER_BADGE_WIDTH, 'h-8')} />
  }

  return (
    <div className="flex min-w-40 items-center gap-3">
      <span className="text-sm whitespace-nowrap text-ink-2">{user.name}</span>
      <Button
        data-track-id="nav-logout"
        onClick={logOut}
        size="sm"
        variant="ghost"
      >
        Log out
      </Button>
      <Avatar
        initials={initialsOf(user.name)}
        self
        size={32}
        src={user.image ?? undefined}
        title={user.name}
      />
    </div>
  )
}

/**
 * The phone menu: the six links at 44px, then who you are and Log out. A
 * bottom sheet, opened from the app bar's menu button; picking a link closes
 * it.
 */
function PhoneNav({
  pathname,
  user,
}: {
  pathname: string
  user: NavUser | undefined
}): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <Sheet.Root onOpenChange={setOpen} open={open}>
      <Sheet.Trigger
        render={
          <Button
            aria-label="Open menu"
            icon="list"
            size="lg"
            variant="ghost"
          />
        }
      />
      <Sheet.Popup className="gap-3" side="bottom">
        <Sheet.Title className="text-h2">Menu</Sheet.Title>
        <nav aria-label="Menu" className="flex flex-col gap-0.5">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              aria-current={isActive(pathname, href) ? 'page' : undefined}
              className={cns(
                'flex h-11 items-center rounded-md px-3 text-body font-medium',
                isActive(pathname, href)
                  ? 'bg-accent-ghost text-accent-hi'
                  : 'text-ink-2',
              )}
              href={href}
              key={href}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
        {user ? (
          <div className="flex items-center gap-3 border-t border-line pt-3">
            <Avatar
              initials={initialsOf(user.name)}
              self
              size={32}
              src={user.image ?? undefined}
              title={user.name}
            />
            <span className="min-w-0 flex-1 text-sm break-words">
              {user.name}
            </span>
            <Button
              data-track-id="nav-logout-mobile"
              icon="logout"
              onClick={logOut}
              size="lg"
              variant="outline"
            >
              Log out
            </Button>
          </div>
        ) : null}
      </Sheet.Popup>
    </Sheet.Root>
  )
}

export function NavShell({ children }: { children: ReactNode }): JSX.Element {
  const pathname = usePathname()
  const { user, pending } = useNavUser()

  // /login renders with ZERO app nav chrome — an unauthenticated visitor
  // must never see the full nav bar above the login button, since every one
  // of those links would just bounce them straight back to /login. This
  // check lives here (not solely in a route-group layout) because
  // layout.tsx (the server component that renders NavShell unconditionally)
  // has no way to let a nested route "opt out" of an ancestor layout —
  // route groups only change URL structure, not the layout tree above them.
  // A pathname guard in this already-client component is the only place
  // that can actually suppress the header for this one route.
  if (pathname === '/login') {
    return <>{children}</>
  }

  const links = NAV_LINKS.map(({ href, label }) => ({
    href,
    label,
    active: isActive(pathname, href),
    render: <Link href={href} />,
  }))

  return (
    <div className="flex flex-1 flex-col">
      <AppBar
        app="tdr-code"
        className="sticky top-0 z-10"
        end={
          <div className="hidden md:block">
            <UserBadge user={pending ? undefined : user} />
          </div>
        }
        links={links}
        sheet={
          <PhoneNav pathname={pathname} user={pending ? undefined : user} />
        }
      />
      <main className="flex-1 py-4 md:py-6">{children}</main>
    </div>
  )
}
