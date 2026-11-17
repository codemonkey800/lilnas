'use client'

import { Button, Card, Doorplate, Note, type NoteTone } from '@lilnas/ui'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

import { signIn } from 'src/app/lib/auth-client'
import { logEvent, logToServer } from 'src/app/lib/browser-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// Stable enum for ?error=<code> — NEVER a raw Better Auth error string in
// the URL (plan requirement). A raw library error string is (a) liable to
// change across Better Auth versions without this app noticing, and (b) not
// written with an end user in mind. Every rejection reason this app can
// produce collapses into exactly one of these three codes.
type LoginErrorCode = 'not_guild_member' | 'session_expired' | 'oauth_failed'

// Each code is its own note, worded so none reads as another. not_guild_member
// is red (you're not allowed), oauth_failed amber (it didn't finish, try
// again), session_expired the accent (routine, not a rejection). Copy follows
// the approved mockup (docs/features/tdr-code/designs/src/data/login.mjs).
const ERROR_NOTES: Record<
  LoginErrorCode,
  { tone: NoteTone; lead: string; detail: string }
> = {
  not_guild_member: {
    tone: 'bad',
    lead: "That account isn't in the server.",
    detail:
      'tdr-code is limited to members of the configured Discord server. Sign in with a different account, or ask to be added.',
  },
  session_expired: {
    tone: 'accent',
    lead: 'Your session expired.',
    detail: 'Sign in again to pick up where you were.',
  },
  // Deliberately distinct and generic — the plan is explicit that this must
  // read as "sign-in didn't complete" rather than the more alarming
  // not_guild_member wording, so a transient Discord outage isn't
  // misinterpreted by the user as "you're not allowed here."
  oauth_failed: {
    tone: 'warn',
    lead: "Sign-in didn't finish.",
    detail: "Discord didn't complete it. Try again.",
  },
}

function isLoginErrorCode(value: string | null): value is LoginErrorCode {
  return (
    value === 'not_guild_member' ||
    value === 'session_expired' ||
    value === 'oauth_failed'
  )
}

// Reads ?error=<code> is the one piece of this page that needs
// useSearchParams(), which Next requires to sit under a Suspense boundary
// (see the default export below) — kept in its own component so the
// boundary only re-suspends this small slice, not the whole card, and so
// LoginPage's default export stays trivially testable without also having
// to reason about search-param timing.
function LoginErrorBanner() {
  const searchParams = useSearchParams()
  const rawError = searchParams.get('error')
  const code = isLoginErrorCode(rawError) ? rawError : null

  // Log the user-EXPERIENCED auth failure (the banner actually rendered),
  // once per mount per code — the browser-plane complement to the backend's
  // guild-denied / auth-check-error (which record the server-side decision,
  // not whether a human ever saw the wall). session_expired is routine
  // (info via logEvent); not_guild_member / oauth_failed are notable (warn
  // via logToServer), mirroring the banner's own tone split below.
  useEffect(() => {
    if (code === null) return
    if (code === 'session_expired') {
      logEvent(LOG_EVENTS.loginErrorShown, { code })
    } else {
      logToServer('warn', LOG_EVENTS.loginErrorShown, 'login blocked', { code })
    }
  }, [code])

  if (code === null) return null

  const { tone, lead, detail } = ERROR_NOTES[code]

  return (
    <Note className="w-full" lead={lead} tone={tone}>
      {detail}
    </Note>
  )
}

export default function LoginPage() {
  const [isRedirecting, setIsRedirecting] = useState(false)

  function handleLogin() {
    // Disable + relabel immediately so a double-click (or a slow network
    // before the full-page navigation away actually happens) can't invoke
    // signIn.social() a second time (plan requirement).
    setIsRedirecting(true)
    void signIn.social({
      provider: 'discord',
      // HARDCODED relative literal — never derived from a query param,
      // document.location, or referrer (plan hard requirement, called out
      // explicitly to prevent an open-redirect primitive on the login
      // flow). This app does not implement any `returnTo`-style post-login
      // redirect target today: the plan explicitly allows omitting it
      // ("The frontend has no returnTo handling today, so this is net-new
      // and must be built safe" / "your call"), and the safest way to
      // guarantee callbackURL can never be attacker-influenced is to never
      // wire a returnTo value into it at all. If returnTo handling is added
      // later, it must be validated at LEAST as strictly as: reject any
      // value that does not start with exactly one '/' (rejecting both
      // absolute `https://...` AND protocol-relative `//host` — the latter
      // also starts with a single '/', which is the exact bug present in
      // apps/yoink/src/app/(auth)/login/page.tsx's
      // `rawReturnTo.startsWith('/')` check).
      callbackURL: '/',
    })
  }

  return (
    <Card className="flex w-full max-w-[380px] flex-col items-center gap-5 p-8">
      <Doorplate app="tdr-code" href={null} />
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-h2">Sign in</h1>
        <p className="text-sm text-ink-3">
          tdr-code is for members of the Discord server.
        </p>
      </div>

      <Suspense fallback={null}>
        <LoginErrorBanner />
      </Suspense>

      <Button
        data-track-id="login-discord"
        disabled={isRedirecting}
        full
        loading={isRedirecting}
        onClick={handleLogin}
        variant="accent"
      >
        {isRedirecting ? 'Redirecting…' : 'Sign in with Discord'}
      </Button>
    </Card>
  )
}
