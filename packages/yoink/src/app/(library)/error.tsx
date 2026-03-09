'use client'

import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import Button from '@mui/material/Button'
import { useEffect } from 'react'

import { EmptyState } from 'src/components/empty-state'

interface ErrorPageProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function LibraryError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <EmptyState
      className="mt-16"
      icon={<ErrorOutlineIcon />}
      title="Something went wrong"
      description={
        error.digest
          ? `An unexpected error occurred. (${error.digest})`
          : 'An unexpected error occurred. Try refreshing or going back.'
      }
      action={
        <Button variant="outlined" color="secondary" size="small" onClick={reset}>
          Try again
        </Button>
      }
    />
  )
}
