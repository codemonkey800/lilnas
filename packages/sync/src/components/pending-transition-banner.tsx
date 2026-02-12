'use client'

import { cns } from '@lilnas/utils/cns'
import { useCallback, useState } from 'react'
import { HiClock, HiSparkles } from 'react-icons/hi2'

import type { PendingTransition } from 'src/app/(app)/check-ins/types'
import { Button } from 'src/components/ui/button'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const transitionLabels: Record<PendingTransition, string> = {
  start: 'start',
  complete: 'complete',
  reopen: 're-open',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PendingTransitionBannerProps {
  pendingTransition: PendingTransition
  isInitiator: boolean
  partnerName: string
  onConfirm: () => Promise<{ success: boolean; error?: string }>
  onCancel?: () => Promise<{ success: boolean; error?: string }>
}

// ---------------------------------------------------------------------------
// PendingTransitionBanner
// ---------------------------------------------------------------------------

export function PendingTransitionBanner({
  pendingTransition,
  isInitiator,
  partnerName,
  onConfirm,
  onCancel,
}: PendingTransitionBannerProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = transitionLabels[pendingTransition]

  const handleConfirm = useCallback(async () => {
    setError(null)
    setLoading(true)
    const result = await onConfirm()
    if (!result.success) {
      setError(result.error ?? 'Something went wrong.')
      setLoading(false)
    }
  }, [onConfirm])

  const handleCancel = useCallback(async () => {
    if (!onCancel) return
    setError(null)
    setLoading(true)
    const result = await onCancel()
    if (!result.success) {
      setError(result.error ?? 'Something went wrong.')
      setLoading(false)
    }
  }, [onCancel])

  if (isInitiator) {
    return (
      <div
        className={cns(
          'flex flex-col gap-3 rounded-md border border-primary-700',
          'bg-bg-surface p-4 animate-fade-in',
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <HiClock className="h-5 w-5 shrink-0 text-primary-400" />
          <p className="text-sm font-medium text-text">
            Waiting for {partnerName} to confirm
          </p>
        </div>

        {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          loading={loading}
          className="self-start"
        >
          Cancel request
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cns(
        'flex flex-col gap-3 rounded-md border border-primary-700',
        'bg-primary-900 p-4 shadow-glow animate-fade-in',
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2">
        <HiSparkles className="h-5 w-5 shrink-0 text-primary-400" />
        <p className="text-sm font-medium text-text">
          {partnerName} wants to {label} this check-in
        </p>
      </div>

      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      <Button
        size="sm"
        onClick={handleConfirm}
        loading={loading}
        className="self-start"
      >
        Confirm
      </Button>
    </div>
  )
}
