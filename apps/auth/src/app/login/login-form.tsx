'use client'

import { Button, Icon, Note, PepeFull } from '@lilnas/ui'
import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

import {
  GateCard,
  GateHeading,
  GateScreen,
  TargetPill,
} from 'src/app/components/gate'
import { useToast } from 'src/app/components/toast'
import { signIn } from 'src/app/lib/auth-client'

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
    <Note
      tone="bad"
      lead="Google didn’t sign you in."
      icon={<Icon name="alert" size={16} />}
    >
      It sent back an error. Try again.{' '}
      <code className="font-mono text-mono-sm">{error}</code>
    </Note>
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
  const { showToast } = useToast()

  function handleSignIn() {
    // Mark the button busy immediately so a double-click (or a slow network
    // before the full-page navigation away actually happens) can't invoke
    // signIn.social() a second time — a loading Button swallows clicks.
    setIsRedirecting(true)
    showToast('Redirecting…')

    void signIn.social({ provider: 'google', callbackURL })
  }

  return (
    <GateScreen doorplate={false}>
      <GateCard narrow>
        <PepeFull className="mx-auto" size={42} />

        <Suspense fallback={null}>
          <LoginErrorNotice />
        </Suspense>

        <GateHeading
          className="-mt-1"
          title={targetHost ? 'Sign in to continue' : 'Sign in to lilnas.io'}
        />

        {targetHost ? <TargetPill host={targetHost} /> : null}

        <Button
          variant="outline"
          size="lg"
          full
          icon="google"
          loading={isRedirecting}
          onClick={handleSignIn}
        >
          {isRedirecting ? 'Redirecting…' : 'Continue with Google'}
        </Button>
      </GateCard>
    </GateScreen>
  )
}
