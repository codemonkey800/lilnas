'use client'

import { cns } from '@lilnas/utils/cns'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'

import { signOut, useSession } from 'src/app/lib/auth-client'

const NAV_LINKS = [
  { href: '/', label: 'Live' },
  { href: '/sessions', label: 'Sessions' },
  { href: '/events', label: 'Events' },
  { href: '/config', label: 'Config' },
  { href: '/git-identity', label: 'Git identity' },
]

// Fixed width so the loading -> resolved transition never shifts layout in
// the h-14 header (plan requirement: "a fixed-width loading placeholder
// while the client-side session fetch resolves — no layout shift, no flash
// of logged-out chrome"). Matches roughly the width of a short avatar +
// name pairing; long names truncate to this same box via UserBadge's own
// max-w-[...] truncate below, so the header never grows past it either.
const USER_BADGE_WIDTH = 'w-40'

function UserBadge() {
  // useSession() (better-auth/react) is the CLIENT-SOURCED session read the
  // plan requires — layout.tsx (the server component that renders
  // NavShell) never reads a session itself; NavShell fetches it here,
  // client-side, via the Better Auth React client's reactive hook. This is
  // the one place in the app that resolves "who is logged in" for display.
  const { data, isPending } = useSession()

  if (isPending) {
    // Fixed-width placeholder — same box the resolved state renders into,
    // so nothing shifts once the fetch completes. Deliberately blank rather
    // than "Logged out" or any other copy that could read as a real state.
    return <div className={cns(USER_BADGE_WIDTH, 'h-8')} />
  }

  const user = data?.user
  if (!user) {
    // No session — middleware.ts should already have redirected an
    // unauthenticated page visit to /login before NavShell ever renders,
    // and every /api/* call is guarded server-side regardless, so this is
    // a defensive "render nothing" rather than a real reachable UI state.
    return <div className={cns(USER_BADGE_WIDTH, 'h-8')} />
  }

  // Discord's global/display name (Better Auth's default Discord profile
  // mapping writes this into `user.name`) is preferred over a raw username
  // per the plan ("better recognition than username") — auth.ts only
  // overrides `email`/`emailVerified` in mapProfileToUser, so `name` here is
  // whatever the library's own Discord provider default already produced.
  const displayName = user.name
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className={cns(USER_BADGE_WIDTH, 'flex items-center gap-2')}>
      {user.image ? (
        // Plain <img>, not next/image — an external Discord CDN URL;
        // next/image's remote-pattern allowlist isn't configured for
        // cdn.discordapp.com and adding it is out of this unit's scope for
        // one small avatar image. (This repo doesn't lint via
        // eslint-config-next, so no @next/next/no-img-element rule applies
        // here regardless.)
        <img
          src={user.image}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full bg-gray-800 object-cover"
        />
      ) : (
        // Initial-letter fallback — deliberately not a generic person icon
        // (plan: "avoid the generic-person-icon slop").
        <div
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-semibold text-gray-300"
        >
          {initial}
        </div>
      )}
      <span
        className="max-w-[7rem] truncate text-sm text-gray-300"
        title={displayName}
      >
        {displayName}
      </span>
      <button
        type="button"
        onClick={() => {
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
        }}
        className="shrink-0 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-900 hover:text-gray-300"
      >
        Log out
      </button>
    </div>
  )
}

export function NavShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()

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
          <div className="ml-auto">
            <UserBadge />
          </div>
        </div>
      </header>
      <main className="flex-1 px-8 py-10">{children}</main>
    </div>
  )
}
