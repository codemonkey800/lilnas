'use client'

import { Button, Note } from '@lilnas/ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  GateCard,
  GateHeading,
  GateScreen,
  IdentityRow,
  StatusRing,
  TargetPill,
} from 'src/app/components/gate'
import { signOut } from 'src/app/lib/auth-client'
import { timeAgo } from 'src/app/lib/time-ago'

import { checkRequestStatus, submitReRequest } from './actions'

export type PendingClientProps = {
  serviceHost: string
  redirectUrl: string
  identity: { name: string; email: string; initials: string }
  // The matching pending-request row's own createdAt, or null in the
  // narrow gap where it was decided between page.tsx's own reads and this
  // render, OR whenever `initialOutcome` is 'rejected' (a rejected row is
  // never "pending") — the "Requested {time}" caption is simply omitted
  // then, rather than guessing. Seeds local `requestedAt` state — see
  // handleRequestAgain()'s own comment for why this needs to be mutable
  // rather than a plain prop read.
  requestedAt: string | null
  // Which of the two persistent visual states to render on first paint —
  // page.tsx's own first status check already resolved 'granted' (redirect
  // before this ever mounts) and 'blocked' (redirect to /blocked) away, so
  // this is only ever 'pending' or 'rejected'. Seeds local `outcome` state,
  // updated in place thereafter by recheck()/handleRequestAgain() below —
  // never by a second prop change (this component never remounts with a
  // new value for this prop; router.refresh() is the admin dashboard's own
  // mechanism, not this page's).
  initialOutcome: 'pending' | 'rejected'
}

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R9, AE2, AE3), revised for rejection visibility (twice): this
// component renders TWO persistent visual states in place — "waiting for
// approval" (`outcome === 'pending'`) and "access declined"
// (`outcome === 'rejected'`) — rather than the single state the original
// design had. Rejection USED TO be a terminal outcome that navigated away
// entirely (to `/login` with a decline notice); that was reversed (see
// requests.service.ts's own header comment for the full history) in favor
// of rendering in place with a same-page "Request access again" action
// (handleRequestAgain() below), so a decline is no longer a dead end.
//
// Approval and blocking are the only outcomes that still navigate away
// entirely — approval straight to `redirectUrl`, blocking to the dedicated
// `/blocked` page (see verify.service.ts's own REDIRECT_PATHS.blocked
// comment for that separate, still-unchanged-in-shape reversal). Neither
// gets its own transitional visual on THIS page — the redirect happens
// near-instantly, so there is nothing useful to animate through first.
//
// Approval-to-redirect (and blocked-to-redirect) requires no reload and no
// poll: the SSE connection's `status-changed` event, AND its own `open`
// event (fired on first connect AND every browser-native auto-reconnect),
// both trigger the SAME re-check. The `open`-triggered recheck is what
// closes the "dropped connection" edge case — a decision made while this
// tab's SSE connection was down is caught the moment the browser
// reconnects, not just on the next live push. That SSE/polling machinery
// itself is UNCHANGED by this revision — only what recheck() does with a
// 'rejected'/'blocked' result differs from before.
// ──────────────────────────────────────────────────────────────────────────────
// The browser will NOT retry an EventSource connection on its own when the
// initial/reconnect request fails with a non-2xx status or the wrong
// Content-Type — per the EventSource processing model, that class of
// failure sets `readyState` to CLOSED and fires a terminal `error` with no
// further auto-reconnect. That is exactly what happens to every open
// pending tab whenever the Nest backend is down for any reason (a restart,
// a crash, the cutover runbook's own `docker-compose restart lilnas-auth`)
// — the Nest backend and Next server are separate processes, so the
// rewrite this hits returns 5xx independent of whether Next itself is up.
// A dropped-then-restored NETWORK connection is already handled: the
// browser retries that class on its own and fires 'open' again, which
// recheck() below is already wired to. Only the terminal-CLOSED class needs
// manual intervention.
const RECONNECT_BACKOFF_MS = 5000
// A low-frequency floor, independent of SSE health entirely — makes this
// page eventually-correct regardless of whether the EventSource is
// connected, reconnecting, or has silently stopped mattering for some
// reason this file's own reasoning above didn't anticipate.
const POLL_FLOOR_MS = 30_000
// How long the "Check again" button's icon spins after a manual click —
// purely cosmetic feedback, independent of whether recheck() has actually
// resolved by then, mirroring the design mockups' own fixed-duration spin.
const CHECK_AGAIN_SPIN_MS = 500

export function PendingClient({
  serviceHost,
  redirectUrl,
  identity,
  requestedAt: initialRequestedAt,
  initialOutcome,
}: PendingClientProps) {
  const [epoch, setEpoch] = useState(0)
  const [isChecking, setIsChecking] = useState(false)
  const [outcome, setOutcome] = useState(initialOutcome)
  // Mutable, unlike the plain-prop-read this used to be — handleRequestAgain()
  // below sets this to "now" the moment a fresh request is submitted, for
  // the "Requested just now" caption. Renamed the destructured prop above
  // (not this state variable) to `initialRequestedAt`, matching
  // `initialOutcome` -> `outcome`'s own naming convention.
  const [requestedAt, setRequestedAt] = useState(initialRequestedAt)
  // Replaces the prior per-effect-run `let cancelled` closure variable with
  // a ref — same "no-op after this effect run's own cleanup" guarantee,
  // just readable from recheck() now that it's hoisted out of the effect
  // (see recheck's own comment below) rather than defined inline inside it.
  const cancelledRef = useRef(false)

  const isRejected = outcome === 'rejected'

  // Hoisted out of the effect into a stable (per redirectUrl) callback so
  // the "Check again" button below can call the EXACT SAME function the
  // effect's `open`/`status-changed` listeners use, rather than
  // duplicating the status-check logic.
  const recheck = useCallback(() => {
    checkRequestStatus(redirectUrl)
      .then(status => {
        if (cancelledRef.current) return
        if (status.outcome === 'granted') {
          window.location.href = redirectUrl
          return
        }
        if (status.outcome === 'rejected') {
          // Rendered IN PLACE now (reversed post-launch — see this file's
          // own header comment) rather than navigating away to /login.
          setOutcome('rejected')
          return
        }
        if (status.outcome === 'blocked') {
          window.location.href = `/blocked?redirect=${encodeURIComponent(redirectUrl)}`
          return
        }
        // 'pending' — reconciles the rare case where a DIFFERENT tab/device
        // already submitted a fresh request for this same (user,
        // serviceHost) pair (handleRequestAgain() below has no server-push
        // signal of its own on this per-user channel — see that function's
        // comment), so this tab's own outcome could otherwise stay stuck on
        // 'rejected' until the user clicks "Request access again" here too.
        setOutcome('pending')
      })
      .catch(() => {
        // A transient backend hiccup during a status re-check must never
        // crash this page — the SSE connection's own keepalive/reconnect
        // cycle (or a later manual "Check again" click) will simply
        // trigger another recheck shortly. Silent by design, matching this
        // app's general "fail toward pending, not toward a broken page"
        // posture.
      })
  }, [redirectUrl])

  // The explicit, user-initiated counterpart to recheck()'s automatic
  // rejection handling above — calls the SAME re-request Server Action
  // login-form.tsx used to call before signing in again (see
  // requests.controller.ts's own reRequest() comment), now reachable
  // without leaving this page at all. Optimistically flips local state
  // immediately after the call resolves rather than waiting for the next
  // recheck() (SSE/poll) cycle to notice — reRequestAccess() does not
  // publish on this page's own per-user SSE topic (only the admin
  // dashboard's broadcast topic — see requests.service.ts's own comment),
  // so waiting for a live push here would mean waiting for the poll floor.
  function handleRequestAgain() {
    setIsChecking(true)
    void submitReRequest(redirectUrl)
      .then(() => {
        if (cancelledRef.current) return
        setOutcome('pending')
        setRequestedAt(new Date().toISOString())
      })
      .catch(() => {
        // Same fail-toward-pending posture as recheck()'s own catch below
        // — a transient backend hiccup here must not strand the user on a
        // dead button; the next SSE/poll-driven recheck() reconciles
        // whatever actually happened server-side.
      })
    setTimeout(() => setIsChecking(false), CHECK_AGAIN_SPIN_MS)
  }

  useEffect(() => {
    cancelledRef.current = false

    const source = new EventSource(
      `/api/sse/pending?host=${encodeURIComponent(serviceHost)}`,
    )
    source.addEventListener('open', recheck)
    source.addEventListener('status-changed', recheck)

    let retryTimer: ReturnType<typeof setTimeout> | undefined
    source.addEventListener('error', () => {
      if (cancelledRef.current || source.readyState !== EventSource.CLOSED) {
        // A transient/reconnecting state — the browser is already handling
        // this on its own; nothing for this handler to do.
        return
      }
      // The terminal case: the browser has given up and will never retry
      // this connection itself. Recheck immediately (closes the gap for
      // however long this connection has already been dead), then rebuild
      // the EventSource after a backoff by bumping `epoch` — included in
      // this effect's own dependency array below, so bumping it tears this
      // effect down (closing the dead source) and re-runs it (opening a
      // fresh one).
      recheck()
      retryTimer = setTimeout(() => {
        if (!cancelledRef.current) {
          setEpoch(current => current + 1)
        }
      }, RECONNECT_BACKOFF_MS)
    })

    const pollFloor = setInterval(recheck, POLL_FLOOR_MS)

    return () => {
      cancelledRef.current = true
      clearTimeout(retryTimer)
      clearInterval(pollFloor)
      source.close()
    }
    // `epoch` is a write-only trigger, bumped only by the 'error' handler
    // above (via setEpoch) to force this effect to tear down the dead
    // EventSource and open a fresh one — never itself read in the body.
  }, [serviceHost, redirectUrl, epoch, recheck])

  function handleCheckAgain() {
    setIsChecking(true)
    recheck()
    setTimeout(() => setIsChecking(false), CHECK_AGAIN_SPIN_MS)
  }

  function handleSignOut() {
    void signOut().then(() => {
      window.location.href = '/login'
    })
  }

  return (
    <GateScreen>
      <GateCard>
        <StatusRing kind={isRejected ? 'declined' : 'waiting'} />

        <GateHeading
          live
          title={isRejected ? 'Access declined' : 'Waiting for approval'}
          body={
            isRejected
              ? 'An admin declined your request for this service. You can request access again below.'
              : 'An admin needs to grant your account access before you can continue.'
          }
        />

        <IdentityRow
          name={identity.name}
          email={identity.email}
          initials={identity.initials}
        />

        <TargetPill host={serviceHost} />

        {!isRejected && requestedAt ? (
          <p
            className="text-center text-cap text-ink-3"
            suppressHydrationWarning
          >
            Requested {timeAgo(requestedAt)}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {isRejected ? (
            <Button
              variant="accent"
              size="lg"
              full
              loading={isChecking}
              onClick={handleRequestAgain}
            >
              Request access again
            </Button>
          ) : (
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
          )}
          <Button variant="ghost" size="lg" full onClick={handleSignOut}>
            Sign out
          </Button>
        </div>

        <Note
          tone="accent"
          lead={
            isRejected
              ? 'Asking again notifies an admin.'
              : 'This page updates on its own.'
          }
        >
          {isRejected
            ? `You'll be sent to ${serviceHost} the moment you're approved.`
            : `No need to keep refreshing — you'll be sent to ${serviceHost} the moment you're approved.`}
        </Note>
      </GateCard>
    </GateScreen>
  )
}
