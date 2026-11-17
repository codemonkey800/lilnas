'use client'

import {
  AppBar,
  Avatar,
  Button,
  Card,
  EmptyState,
  Icon,
  Note,
  Sheet,
  Tile,
} from '@lilnas/ui'
import type { ReactNode } from 'react'

import type { AccountStatus } from 'src/app/components/status-badge'
import { StatusBadge } from 'src/app/components/status-badge'
import { signOut } from 'src/app/lib/auth-client'
import { getInitials } from 'src/app/lib/initials'
import type { MeResponse } from 'src/app/lib/require-session'
import { getServiceMeta } from 'src/app/service-meta'

export type HomeClientProps = {
  me: MeResponse
}

function getAccountStatus(me: MeResponse): AccountStatus {
  if (me.isAdmin) return 'admin'
  if (me.blockedAt) return 'blocked'
  // A user whose only access is an access rule is just as granted.
  if (me.grants.length > 0 || me.rules.length > 0) return 'granted'
  if (me.pendingRequests.length > 0) return 'pending'
  return 'none'
}

// The redesigned home page's signed-in-user view. Renders entirely from the
// `me` prop the server component fetched via GET /me (require-session.ts) —
// no client-side useSession() read at all, unlike the pre-redesign version:
// this component is only ever reached once page.tsx's own fetchMe() has
// already resolved a real session (redirecting to /login otherwise), so
// there is no "still loading" or "signed out" state left for a client hook
// to cover.
//
// Every authenticated user — admin or not — sees this same view; the only
// admin-specific additions are the "Admin" link in the app bar (see
// deviation #8 in the redesign plan: `/` no longer force-redirects an admin
// to /admin) and the "Admin" status badge, which takes priority over
// blocked/granted/pending/none — an ADMIN_EMAILS address's access doesn't
// depend on grants (see MeResponse.isAdmin's own comment), so the chip
// reflects that rather than whatever the grants table happens to say.
export function HomeClient({ me }: HomeClientProps) {
  const status = getAccountStatus(me)
  const serviceCount = me.grants.length + me.rules.length
  const initials = getInitials(me.name)

  function handleSignOut() {
    void signOut().then(() => {
      window.location.href = '/login'
    })
  }

  return (
    <>
      <AppBar
        app="auth"
        links={me.isAdmin ? [{ href: '/admin', label: 'Admin' }] : undefined}
        end={
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              Sign out
            </Button>
            <Avatar
              initials={initials}
              size={32}
              self
              src={me.image ?? undefined}
              title={me.name}
            />
          </div>
        }
        sheet={
          <Sheet.Root>
            <Sheet.Trigger
              render={
                <Button variant="ghost" icon="menu" aria-label="Open menu" />
              }
            />
            <Sheet.Popup side="bottom">
              <Sheet.Title className="mb-2">Menu</Sheet.Title>
              <div className="-mx-1.5 flex flex-col">
                {me.isAdmin ? (
                  <a
                    href="/admin"
                    className="flex h-11 items-center gap-2 rounded-md px-2.5 text-body text-ink hover:bg-surface-2"
                  >
                    <Icon name="shield" />
                    Admin
                  </a>
                ) : null}
                <button
                  type="button"
                  className="flex h-11 items-center gap-2 rounded-md px-2.5 text-body text-ink hover:bg-surface-2"
                  onClick={handleSignOut}
                >
                  <Icon name="logout" />
                  Sign out
                </button>
              </div>
            </Sheet.Popup>
          </Sheet.Root>
        }
      />

      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-6 md:gap-8 md:px-8 md:py-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-h1">Your account</h1>
          <p className="text-body text-ink-3">
            This is what&apos;s tied to your session at lilnas.io.
          </p>
        </div>

        <Card className="flex items-start gap-4 md:items-center">
          <Avatar
            initials={initials}
            size={64}
            self
            src={me.image ?? undefined}
            title={me.name}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-h2">{me.name}</h2>
              <StatusBadge status={status} />
            </div>
            <p className="truncate font-mono text-mono text-ink-3">
              {me.email}
            </p>
          </div>
        </Card>

        {status === 'pending' ? (
          <Note tone="warn" lead="Your request is waiting for approval.">
            You&apos;ll be able to open services once an admin approves it.
          </Note>
        ) : null}

        <section className="flex flex-col gap-3">
          <h2 className="text-label text-ink-3 uppercase">Session details</h2>
          <dl className="rounded-lg border border-line bg-surface px-4">
            <DetailRow label="Role">
              {me.isAdmin ? 'Admin' : 'Member'}
            </DetailRow>
            <DetailRow label="Member since">
              {new Date(me.createdAt).toLocaleDateString()}
            </DetailRow>
            <DetailRow label="Signed in with">Google</DetailRow>
          </dl>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-h2">Your services</h2>
            <span className="text-cap text-ink-3 tabular-nums">
              {serviceCount} {serviceCount === 1 ? 'service' : 'services'}
            </span>
          </div>
          {serviceCount === 0 ? (
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState
                title="No services granted yet."
                body="Once an admin grants you access, your services show up here."
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Access rules first, as plain (non-link) tiles — a rule names
                  a whole family of sites, so there's no single URL to send
                  the user to. */}
              {me.rules.map(rule => (
                <Tile
                  key={rule}
                  icon="globe"
                  title={`Any ${rule} site`}
                  meta="Access rule"
                />
              ))}
              {me.grants.map(host => {
                const meta = getServiceMeta(host)
                return (
                  <Tile
                    key={host}
                    href={`https://${host}`}
                    icon={meta.icon}
                    title={meta.name}
                    meta={host}
                  />
                )
              })}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

function DetailRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line-soft py-2.5 first:border-t-0">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}
