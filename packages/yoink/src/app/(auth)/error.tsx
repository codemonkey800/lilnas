'use client'

import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import Button from '@mui/material/Button'
import { useEffect } from 'react'

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-carbon-950 p-8">
      <div className="scanlines pointer-events-none fixed inset-0" />
      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <ErrorOutlineIcon
          sx={{ fontSize: 48, color: 'var(--color-carbon-400)' }}
        />
        <div className="space-y-1">
          <h3 className="font-mono text-lg font-medium text-carbon-200">
            Something went wrong
          </h3>
          <p className="max-w-sm text-sm text-carbon-400">
            {error.digest
              ? `An unexpected error occurred. (${error.digest})`
              : 'An unexpected error occurred during authentication.'}
          </p>
        </div>
        <Button
          variant="outlined"
          color="secondary"
          size="small"
          onClick={reset}
        >
          Try again
        </Button>
      </div>
    </div>
  )
}
