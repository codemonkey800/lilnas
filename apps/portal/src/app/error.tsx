'use client'

import { Button, Note } from '@lilnas/ui'
import { useRouter } from 'next/navigation'
import { startTransition, useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  // reset() alone re-renders the boundary from the RSC payload it already
  // holds, so the failed server render never re-runs; refresh() refetches it.
  const retry = () => {
    startTransition(() => {
      router.refresh()
      reset()
    })
  }

  return (
    <>
      <h1 className="mb-6 text-h1">lilnas apps</h1>

      <div className="flex max-w-[520px] flex-col items-start gap-4">
        <Note lead="Couldn't list the containers." tone="bad">
          Docker didn&apos;t answer.
          {error.digest ? (
            <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
              {error.digest}
            </span>
          ) : null}
        </Note>
        <Button
          className="max-md:h-11 max-md:px-5 max-md:text-[15px]"
          icon="refresh"
          onClick={retry}
          size="sm"
          variant="accent"
        >
          Retry
        </Button>
      </div>
    </>
  )
}
