'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import { useEffect } from 'react'

import { GateCard, GateHeading, GateScreen } from 'src/app/components/gate'

type RootErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

// Root error boundary: a backend outage on `/`, `/pending`, `/blocked` or
// `/login` lands here instead of Next's unthemed default page. Mirrors
// admin/error.tsx; no global-error.tsx, since layout.tsx itself is safe.
export default function RootError({ error, reset }: RootErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <GateScreen>
      <GateCard>
        <GateHeading title="Couldn’t load your account" />
        <Note
          tone="bad"
          lead="The page didn’t load."
          icon={<Icon name="alert" size={16} />}
        >
          {error.message || 'An unexpected error occurred.'}
        </Note>
        {error.digest ? (
          <p className="font-mono text-mono-sm text-ink-3">
            digest {error.digest}
          </p>
        ) : null}
        <Button variant="accent" size="lg" full icon="refresh" onClick={reset}>
          Try again
        </Button>
      </GateCard>
    </GateScreen>
  )
}
