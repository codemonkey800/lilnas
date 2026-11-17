'use client'

import { Button } from '@lilnas/ui'
import { useState } from 'react'

import {
  GateCard,
  GateHeading,
  GateScreen,
  IdentityRow,
  StatusRing,
  TargetPill,
} from 'src/app/components/gate'
import { useToast } from 'src/app/components/toast'
import { signOut } from 'src/app/lib/auth-client'
import { checkRequestStatus } from 'src/app/pending/actions'

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
// Modeled on pending-client.tsx's gate card / status ring / identity row /
// target pill markup, but deliberately WITHOUT its SSE/poll loop. A blocked user
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
  const { showToast } = useToast()

  function handleCheckAgain() {
    setIsChecking(true)
    checkRequestStatus(redirectUrl)
      .then(status => {
        if (status.outcome === 'blocked') {
          showToast('Still blocked', 'bad')
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
        showToast('Still blocked', 'bad')
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
    <GateScreen>
      <GateCard>
        <StatusRing kind="blocked" />

        <GateHeading
          live
          title="Access blocked"
          body="An admin has blocked your account. Reach out to them directly if you think this is a mistake."
        />

        <IdentityRow
          name={identity.name}
          email={identity.email}
          initials={identity.initials}
        />

        <TargetPill host={serviceHost} />

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="lg"
            full
            icon="refresh"
            className={isChecking ? '[&_svg]:animate-spin' : undefined}
            onClick={handleCheckAgain}
          >
            Check again
          </Button>
          <Button variant="ghost" size="lg" full onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </GateCard>
    </GateScreen>
  )
}
