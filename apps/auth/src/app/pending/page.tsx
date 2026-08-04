import { env } from '@lilnas/utils/env'
import { redirect } from 'next/navigation'

import { getInitials } from 'src/app/lib/initials'
import { fetchMe } from 'src/app/lib/require-session'
import { resolveRedirectTarget } from 'src/auth/redirect'
import { EnvKeys } from 'src/env'

import { checkRequestStatus } from './actions'
import { PendingClient } from './pending-client'

type PendingPageProps = {
  searchParams: Promise<{ redirect?: string | string[] }>
}

// U5's VerifyService redirects a "no grant" outcome to this page carrying
// `?redirect=<original URL>` — a "blocked" outcome instead redirects to the
// dedicated /blocked page (see verify.service.ts's own REDIRECT_PATHS.blocked
// comment), sharing this exact same param shape. See VerifyService's
// buildRedirectUrl() comment for why every one of its redirect targets
// shares this one param, and why this page derives the service host from
// the URL rather than a second `service=`/`host=` param.
//
// The raw `redirect` param is run through the SAME resolveRedirectTarget()
// validator src/app/login/page.tsx already uses (U4, R3/AE4) before it is
// EVER navigated to — both this page's own server-side redirect() below
// and PendingClient's `window.location.href` (a Client Component prop,
// see that file) trust this value completely. Before this fix, only a
// `new URL(...).hostname` parse gated it — that answers "can I extract a
// hostname," not "is this URL safe to navigate a signed-in user to";
// `new URL('javascript:...')` parses fine with hostname `''`, and nothing
// downstream re-validates it.
export default async function PendingPage({ searchParams }: PendingPageProps) {
  const params = await searchParams
  const redirectParam =
    typeof params.redirect === 'string' ? params.redirect : undefined

  const safeRedirect = resolveRedirectTarget(redirectParam, {
    authHost: env(EnvKeys.AUTH_HOST),
    allowedSuffix: env(EnvKeys.REDIRECT_ALLOWED_SUFFIX),
    // '/login' is also the sentinel checked just below: a candidate that
    // resolveRedirectTarget() rejected (missing, malformed, wrong scheme,
    // the auth host itself, or outside the allowed domain family) is
    // indistinguishable from "nothing to be pending about" — this page
    // only ever makes sense reached via /verify's own redirect, which
    // always carries a valid param.
    defaultDestination: '/login',
  })
  if (safeRedirect === '/login') {
    redirect('/login')
  }

  const serviceHost = new URL(safeRedirect).hostname

  // The FIRST status check, done server-side before this page ever renders
  // the pending UI — if a grant already exists (e.g. an admin approved
  // while this user was mid-navigation, or a second tab already absorbed
  // the request), send them straight to their destination instead of
  // flashing a pending screen that would immediately redirect itself a
  // moment later. fetchMe() runs alongside it (independent reads, safe to
  // parallelize) — this page is only ever reached with a real session
  // (VerifyService.decide() redirects a genuinely unauthenticated visitor
  // to /login, never here — see that file's own decision order), so
  // fetchMe()'s own 401 branch is not expected to fire in practice.
  const [status, me] = await Promise.all([
    checkRequestStatus(safeRedirect),
    fetchMe(),
  ])
  if (status.outcome === 'granted') {
    redirect(safeRedirect)
  }
  // A blocked account gets its own dedicated page (reversed post-launch —
  // see verify.service.ts's own REDIRECT_PATHS.blocked comment for the
  // full history of this reversal). Checked here too, not just at
  // /verify's own ForwardAuth layer, since this page's OWN first status
  // check (above) can independently discover a block that happened after
  // /verify's redirect but before this render — same "defensive first
  // check" reasoning as the granted branch just above.
  if (status.outcome === 'blocked') {
    redirect(`/blocked?redirect=${encodeURIComponent(safeRedirect)}`)
  }

  // A rejection is now rendered INLINE on this page (reversed post-launch —
  // see requests.service.ts's own header comment) rather than navigating
  // away to /login — see pending-client.tsx's own `initialOutcome` prop and
  // its "Request access again" action for the rest of this reversal.
  const initialOutcome = status.outcome === 'rejected' ? 'rejected' : 'pending'

  // The matching pending-request row's own createdAt, for the "Requested
  // {time}" caption — may be missing in the narrow gap where an admin
  // approves/rejects between the two reads above and this one (in which
  // case the caption below simply omits the timestamp rather than
  // guessing), AND whenever `initialOutcome` is 'rejected' (a rejected row
  // is never "pending", so it never matches this lookup either — the
  // caption is correctly absent for a fresh rejection render too).
  const matchingRequest = me.pendingRequests.find(
    request => request.serviceHost === serviceHost,
  )

  return (
    <PendingClient
      serviceHost={serviceHost}
      redirectUrl={safeRedirect}
      identity={{
        name: me.name,
        email: me.email,
        initials: getInitials(me.name),
      }}
      requestedAt={matchingRequest?.createdAt ?? null}
      initialOutcome={initialOutcome}
    />
  )
}
