'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import { Brandmark } from 'src/app/components/brandmark'
import { Icon } from 'src/app/components/icons'
import { Toast, useToast } from 'src/app/components/toast'
import { signIn } from 'src/app/lib/auth-client'
import { getServiceMeta } from 'src/app/service-meta'

// Split out of page.tsx by U4. page.tsx is now an async Server Component so
// it can read AUTH_HOST / REDIRECT_ALLOWED_SUFFIX from real process.env at
// request time and run the untrusted `redirect` query param through
// src/auth/redirect.ts's resolveRedirectTarget() entirely server-side — see
// page.tsx's own header comment for why that config must never be read
// inside a 'use client' module.
//
// A rejected user's decline notice AND re-request trigger USED TO live
// here (a `showRejectedNotice` prop gating both a dismissible banner and a
// submitReRequest() call in handleSignIn below) — removed once rejection
// visibility moved onto the pending page itself (see
// requests.service.ts's own header comment for the full history): a
// rejected user now sees "Access declined" and a "Request access again"
// action directly on /pending (pending-client.tsx), and never reaches
// /login as part of that flow at all.
//
// Reads ?error=<code>, which needs useSearchParams() and therefore a
// Suspense boundary (see the default export below) — kept in its own
// component so the boundary only re-suspends this small slice, not the
// whole page.
function LoginErrorNotice() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  if (!error) return null

  return (
    <div className="notice" role="alert">
      <Icon name="x" />
      <span>Sign-in failed ({error}). Please try again.</span>
    </div>
  )
}

type LoginFormProps = {
  // Already validated by src/auth/redirect.ts's resolveRedirectTarget() in
  // page.tsx's Server Component — this component trusts it as-is and does
  // no further checking. Never wire an unvalidated value into this prop.
  callbackURL: string
  // The destination's hostname, or null when signing in with no specific
  // destination (the plain default-'/' case) — drives the heading copy and
  // the "Continuing to" target pill.
  targetHost: string | null
}

export function LoginForm({ callbackURL, targetHost }: LoginFormProps) {
  const [isRedirecting, setIsRedirecting] = useState(false)
  const { message, showToast } = useToast()

  const targetMeta = targetHost ? getServiceMeta(targetHost) : null

  function handleSignIn() {
    // Disable immediately so a double-click (or a slow network before the
    // full-page navigation away actually happens) can't invoke
    // signIn.social() a second time.
    setIsRedirecting(true)
    showToast('Redirecting to Google…')

    void signIn.social({ provider: 'google', callbackURL })
  }

  return (
    <div className="gate__wrap">
      <div className="gate__card">
        <Brandmark />

        <Suspense fallback={null}>
          <LoginErrorNotice />
        </Suspense>

        <div className="gate__card-header">
          <h1 className="h1">
            {targetHost ? 'Sign in to continue' : 'Sign in to lilnas.io'}
          </h1>
        </div>

        {targetHost && targetMeta ? (
          <div className="target-pill">
            <span className="target-pill__icon">
              <Icon name={targetMeta.icon} />
            </span>
            <div className="target-pill__text">
              <span className="target-pill__name">{targetMeta.name}</span>
              <span className="target-pill__domain">{targetHost}</span>
            </div>
          </div>
        ) : null}

        <div className="oauth-list">
          <button
            type="button"
            onClick={handleSignIn}
            disabled={isRedirecting}
            className="btn btn-oauth btn-block"
          >
            <Icon name="google" />
            <span>
              {isRedirecting ? 'Redirecting…' : 'Continue with Google'}
            </span>
          </button>
        </div>
      </div>

      <Toast message={message} />
    </div>
  )
}
