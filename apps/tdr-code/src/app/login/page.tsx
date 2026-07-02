'use client'

import { cns } from '@lilnas/utils/cns'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { signIn } from 'src/app/lib/auth-client'

// Stable enum for ?error=<code> — NEVER a raw Better Auth error string in
// the URL (plan requirement). A raw library error string is (a) liable to
// change across Better Auth versions without this app noticing, and (b) not
// written with an end user in mind. Every rejection reason this app can
// produce collapses into exactly one of these three codes.
type LoginErrorCode = 'not_guild_member' | 'session_expired' | 'oauth_failed'

const ERROR_COPY: Record<LoginErrorCode, string> = {
  not_guild_member:
    "You don't have access to tdr-code — this console is limited to members of the configured Discord server.",
  session_expired: 'Your session expired. Please sign in again.',
  // Deliberately distinct and generic — the plan is explicit that this must
  // read as "sign-in didn't complete" rather than the more alarming
  // not_guild_member wording, so a transient Discord outage isn't
  // misinterpreted by the user as "you're not allowed here."
  oauth_failed: "Sign-in didn't complete. Please try again.",
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

  if (!isLoginErrorCode(rawError)) return null

  return (
    <div
      className={cns(
        'w-full rounded border px-4 py-3 text-sm',
        // not_guild_member and oauth_failed both render as attention-states
        // (amber/red-leaning) but with different copy above so they're
        // never confused for each other; session_expired uses a visually
        // distinct informational tone (not alarming — an expired session is
        // routine, not a rejection).
        rawError === 'session_expired'
          ? 'border-gray-700 bg-gray-900 text-gray-300'
          : 'border-red-800 bg-red-950 text-red-300',
      )}
    >
      {ERROR_COPY[rawError]}
    </div>
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
    <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-lg border border-gray-800 bg-gray-950 p-8">
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs font-bold tracking-[0.15em] text-gray-400 uppercase">
          tdr-code
        </span>
        <p className="text-sm text-gray-500">Sign in to continue</p>
      </div>

      <Suspense fallback={null}>
        <LoginErrorBanner />
      </Suspense>

      <button
        type="button"
        onClick={handleLogin}
        disabled={isRedirecting}
        className={cns(
          'w-full rounded px-4 py-2.5 text-sm font-medium transition-colors',
          isRedirecting
            ? 'cursor-not-allowed bg-gray-700 text-gray-400 opacity-50'
            : 'bg-blue-700 text-blue-100 hover:bg-blue-600',
        )}
      >
        {isRedirecting ? 'Redirecting…' : 'Login with Discord'}
      </button>
    </div>
  )
}
