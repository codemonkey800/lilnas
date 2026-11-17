'use client'

import { Button } from '@lilnas/ui'
import Link from 'next/link'

import { EmptyState } from './components/empty-state'

// Next renders this inside the root layout, so the nav stays. A client
// component because `@lilnas/ui` ships as CommonJS, which a server component
// can't read the `'use client'` exports from through its barrel.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-6">
      <EmptyState
        action={
          <Button render={<Link href="/" />} variant="accent">
            Back to Live
          </Button>
        }
        body="That page doesn't exist. Head back to the live view."
        message="Page not found"
      />
    </div>
  )
}
