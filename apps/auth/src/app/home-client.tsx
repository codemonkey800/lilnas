'use client'

import { Brandmark } from 'src/app/components/brandmark'
import { Icon } from 'src/app/components/icons'
import { signOut } from 'src/app/lib/auth-client'
import { getInitials } from 'src/app/lib/initials'
import type { MeResponse } from 'src/app/lib/require-session'
import { getServiceMeta } from 'src/app/service-meta'

export type HomeClientProps = {
  me: MeResponse
}

type AccountStatus = 'admin' | 'blocked' | 'granted' | 'pending' | 'none'

function getAccountStatus(me: MeResponse): AccountStatus {
  if (me.isAdmin) return 'admin'
  if (me.blockedAt) return 'blocked'
  if (me.grants.length > 0) return 'granted'
  if (me.pendingRequests.length > 0) return 'pending'
  return 'none'
}

function StatusChip({ status }: { status: AccountStatus }) {
  if (status === 'admin') {
    return (
      <span className="chip chip-admin">
        <Icon name="shield" />
        <span>Admin</span>
      </span>
    )
  }
  if (status === 'granted') {
    return (
      <span className="chip chip-granted">
        <Icon name="check" />
        <span>Granted</span>
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="chip chip-pending">
        <Icon name="clock" />
        <span>Pending</span>
      </span>
    )
  }
  if (status === 'blocked') {
    return (
      <span className="chip chip-revoked">
        <Icon name="x" />
        <span>Blocked</span>
      </span>
    )
  }
  return (
    <span className="chip chip-revoked">
      <Icon name="x" />
      <span>No access</span>
    </span>
  )
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
// admin-specific additions are the "Admin" link in the topbar (see
// deviation #8 in the redesign plan: `/` no longer force-redirects an admin
// to /admin) and the "Admin" status chip, which takes priority over
// blocked/granted/pending/none — an ADMIN_EMAILS address's access doesn't
// depend on grants (see MeResponse.isAdmin's own comment), so the chip
// reflects that rather than whatever the grants table happens to say.
export function HomeClient({ me }: HomeClientProps) {
  const status = getAccountStatus(me)

  function handleSignOut() {
    void signOut().then(() => {
      window.location.href = '/login'
    })
  }

  return (
    <>
      <header className="topbar">
        <Brandmark />
        <div className="row gap-2.5">
          {me.isAdmin ? (
            <a href="/admin" className="btn btn-outline btn-sm">
              Admin
            </a>
          ) : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="shell shell--home">
        <div className="stack gap-1">
          <h1 className="h1">Your account</h1>
          <p className="body-text muted">
            This is what&apos;s tied to your session at lilnas.io.
          </p>
        </div>

        <div className="account-card">
          <span className="avatar avatar-lg avatar-ring overflow-hidden">
            {me.image ? (
              <img
                src={me.image}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              getInitials(me.name)
            )}
          </span>
          <div className="account-card__text">
            <div className="account-card__row">
              <span className="h2">{me.name}</span>
              <StatusChip status={status} />
            </div>
            <span className="body-text muted">{me.email}</span>
          </div>
        </div>

        {status === 'pending' ? (
          <div className="notice" role="status">
            <Icon name="clock" />
            <span>
              Your access request is still awaiting admin approval. You&apos;ll
              be able to reach gated services once it&apos;s approved.
            </span>
          </div>
        ) : null}

        <div className="stack gap-3.5">
          <h2 className="h3 text-xs uppercase tracking-[0.06em] text-muted">
            Session details
          </h2>
          <div className="meta-list card px-[18px] py-1">
            <div className="meta-list__row">
              <span className="meta-list__label">Role</span>
              <span className="meta-list__value">
                {me.isAdmin ? 'Admin' : 'Member'}
              </span>
            </div>
            <div className="meta-list__row">
              <span className="meta-list__label">Member since</span>
              <span className="meta-list__value">
                {new Date(me.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="stack gap-3.5">
          <div className="row between">
            <h2 className="h2">Your services</h2>
            <span className="caption">
              {me.grants.length}{' '}
              {me.grants.length === 1 ? 'service' : 'services'}
            </span>
          </div>
          <div className="services-grid">
            {me.grants.length === 0 ? (
              <div className="empty-state col-span-full">
                <p className="body-text">No services granted yet.</p>
              </div>
            ) : (
              me.grants.map(host => {
                const meta = getServiceMeta(host)
                return (
                  <a
                    key={host}
                    href={`https://${host}`}
                    className="service-tile"
                  >
                    <span className="service-tile__icon">
                      <Icon name={meta.icon} />
                    </span>
                    <span className="service-tile__name">{meta.name}</span>
                    <span className="service-tile__domain">{host}</span>
                  </a>
                )
              })
            )}
          </div>
        </div>
      </div>
    </>
  )
}
