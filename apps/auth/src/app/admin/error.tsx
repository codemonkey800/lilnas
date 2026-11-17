'use client'

import { Button, Icon, Note } from '@lilnas/ui'
import { useEffect } from 'react'

import { GateCard, GateHeading, GateScreen } from 'src/app/components/gate'

type AdminErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function AdminError({ error, reset }: AdminErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <GateScreen>
      <GateCard>
        <GateHeading title="Couldn’t load access control" />
        <Note
          tone="bad"
          lead="The admin page didn’t load."
          icon={<Icon name="alert" size={16} />}
        >
          {error.message || 'An unexpected error occurred.'}
        </Note>
        <Button variant="accent" size="lg" full icon="refresh" onClick={reset}>
          Try again
        </Button>
      </GateCard>
    </GateScreen>
  )
}
