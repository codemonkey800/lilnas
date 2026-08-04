import { env } from '@lilnas/utils/env'
import { redirect } from 'next/navigation'

import { getInitials } from 'src/app/lib/initials'
import { fetchMe } from 'src/app/lib/require-session'
import { checkRequestStatus } from 'src/app/pending/actions'
import { resolveRedirectTarget } from 'src/auth/redirect'
import { EnvKeys } from 'src/env'

import { BlockedClient } from './blocked-client'

type BlockedPageProps = {
  searchParams: Promise<{ redirect?: string | string[] }>
}

// ──────────────────────────────────────────────────────────────────────────────
// VerifyService redirects a blocked account's ForwardAuth check here (see
// verify.service.ts's own REDIRECT_PATHS.blocked comment for the full
// history of this reversal from R16's original "stays opaque" design)
// carrying `?redirect=<original URL>` — the exact same param shape /pending
// uses, validated with the SAME resolveRedirectTarget() validator
// pending/page.tsx and login/page.tsx already share (src/auth/redirect.ts),
// and checked with the SAME checkRequestStatus() Server Action pending/
// page.tsx already calls (imported from that file's own actions.ts rather
// than duplicated — the response shape and the backend endpoint behind it
// are already shared, and this page has no reason to know about either
// independently).
//
// A stale or bookmarked /blocked URL for someone who's since been unblocked
// (or approved/rejected in the meantime, in the rare case an admin does
// both in quick succession) must never trap them here — this page's own
// first status check below is what makes that hold, mirroring pending/
// page.tsx's identical "defensive first check" reasoning for its own
// granted branch.
// ──────────────────────────────────────────────────────────────────────────────
export default async function BlockedPage({ searchParams }: BlockedPageProps) {
  const params = await searchParams
  const redirectParam =
    typeof params.redirect === 'string' ? params.redirect : undefined

  const safeRedirect = resolveRedirectTarget(redirectParam, {
    authHost: env(EnvKeys.AUTH_HOST),
    allowedSuffix: env(EnvKeys.REDIRECT_ALLOWED_SUFFIX),
    // Same sentinel-checked-just-below convention as pending/page.tsx — a
    // candidate resolveRedirectTarget() rejected is indistinguishable from
    // "nothing to be blocked about"; this page only ever makes sense
    // reached via /verify's own redirect, which always carries a valid one.
    defaultDestination: '/login',
  })
  if (safeRedirect === '/login') {
    redirect('/login')
  }

  const serviceHost = new URL(safeRedirect).hostname

  const [status, me] = await Promise.all([
    checkRequestStatus(safeRedirect),
    fetchMe(),
  ])
  if (status.outcome === 'granted') {
    redirect(safeRedirect)
  }
  // No longer blocked — either unblocked since /verify's redirect, or this
  // URL was bookmarked/guessed by someone who was never blocked at all.
  // /pending itself resolves the exact remaining outcome (rendering
  // 'pending' or 'rejected' in place — see that page's own comment), so
  // this only ever needs to send them there, never re-derive which one.
  if (status.outcome === 'pending' || status.outcome === 'rejected') {
    redirect(`/pending?redirect=${encodeURIComponent(safeRedirect)}`)
  }

  return (
    <BlockedClient
      serviceHost={serviceHost}
      redirectUrl={safeRedirect}
      identity={{
        name: me.name,
        email: me.email,
        initials: getInitials(me.name),
      }}
    />
  )
}
