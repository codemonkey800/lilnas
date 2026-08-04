'use client'

import { useState } from 'react'

import { Brandmark } from 'src/app/components/brandmark'
import { Icon } from 'src/app/components/icons'
import { Toast, useToast } from 'src/app/components/toast'
import { signOut } from 'src/app/lib/auth-client'
import { checkRequestStatus } from 'src/app/pending/actions'
import { getServiceMeta } from 'src/app/service-meta'

export type BlockedClientProps = {
  serviceHost: string
  redirectUrl: string
  identity: { name: string; email: string; initials: string }
}

// How long the "Check again" button's icon spins after a manual click —
// same cosmetic-only rationale as pending-client.tsx's identical constant
// (independent of whether the check has actually resolved by then).
const CHECK_AGAIN_SPIN_MS = 500

// ──────────────────────────────────────────────────────────────────────────────
// Modeled on pending-client.tsx's panel/status-ring/identity-row/target-pill
// markup, but deliberately WITHOUT its SSE/poll loop. A blocked user
// re-checking their own status is a rare, admin-initiated event (someone
// has to notice and unblock them) — unlike the pending flow, there is no
// natural per-service topic to hang a live channel off here: blocking is
// account-global, not (userId, serviceHost)-scoped, and the pending SSE
// topic's own per-pair scoping (src/sse/notify-bus.service.ts's topicFor())
// has nothing to key an "this account got unblocked" signal on. A manual
// "Check again" button covers the same ground with no live channel that
// would have nothing meaningful to subscribe to.
// ──────────────────────────────────────────────────────────────────────────────
export function BlockedClient({
  serviceHost,
  redirectUrl,
  identity,
}: BlockedClientProps) {
  const [isChecking, setIsChecking] = useState(false)
  const { message, showToast } = useToast()
  const targetMeta = getServiceMeta(serviceHost)

  function handleCheckAgain() {
    setIsChecking(true)
    checkRequestStatus(redirectUrl)
      .then(status => {
        if (status.outcome === 'blocked') {
          showToast('Still blocked')
          return
        }
        // No longer blocked — /pending itself resolves the exact
        // remaining outcome (granted straight through, or 'pending'/
        // 'rejected' rendered in place), so this only ever needs to send
        // them there, never re-derive which one here.
        window.location.href = `/pending?redirect=${encodeURIComponent(redirectUrl)}`
      })
      .catch(() => {
        // A transient backend hiccup here must never crash this page —
        // matches pending-client.tsx's own recheck() posture. The user can
        // simply click "Check again" a second time.
        showToast('Still blocked')
      })
      .finally(() => {
        setTimeout(() => setIsChecking(false), CHECK_AGAIN_SPIN_MS)
      })
  }

  function handleSignOut() {
    void signOut().then(() => {
      window.location.href = '/login'
    })
  }

  return (
    <div className="wrap">
      <div className="panel">
        <Brandmark />

        <div className="status-ring">
          <Icon name="x" />
        </div>

        <div className="stack gap-1.5" role="status" aria-live="polite">
          <h1 className="h1">Access blocked</h1>
          <p className="body-text muted">
            An admin has blocked your account. Reach out to them directly if you
            think this is a mistake.
          </p>
        </div>

        <div className="identity-row">
          <span className="avatar">{identity.initials}</span>
          <div className="identity-row__text">
            <span className="identity-row__name">{identity.name}</span>
            <span className="identity-row__email">{identity.email}</span>
          </div>
        </div>

        <div className="target-pill">
          <span className="target-pill__icon">
            <Icon name={targetMeta.icon} />
          </span>
          <div className="target-pill__text">
            <span className="target-pill__name">{targetMeta.name}</span>
            <span className="target-pill__domain">{serviceHost}</span>
          </div>
        </div>

        <div className="actions-row">
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleCheckAgain}
          >
            <Icon name="refresh" className={isChecking ? 'spin' : undefined} />
            <span>Check again</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </div>
      </div>

      <Toast message={message} />
    </div>
  )
}
