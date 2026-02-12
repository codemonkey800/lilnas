'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { HiPaperAirplane, HiXMark } from 'react-icons/hi2'

import { SyncIcon } from 'src/components/sync-icon'
import { Button } from 'src/components/ui/button'
import { Card, CardInner } from 'src/components/ui/card'
import { LoadingDots } from 'src/components/ui/loading-dots'

import { cancelInvite } from './actions'
import type { OutgoingInvite } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PendingOutgoingViewProps {
  invite: OutgoingInvite
  onCancelled: () => void
}

// ---------------------------------------------------------------------------
// PendingOutgoingView
// ---------------------------------------------------------------------------

export function PendingOutgoingView({
  invite,
  onCancelled,
}: PendingOutgoingViewProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Poll for partner acceptance -- router.refresh() re-runs the server
  // component which redirects to "/" once the partnership is accepted
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000)
    return () => clearInterval(interval)
  }, [router])

  async function handleCancel() {
    setError(null)
    setLoading(true)

    // If we just sent the invite and don't have the ID yet, refresh
    if (!invite.id) {
      onCancelled()
      return
    }

    const result = await cancelInvite(invite.id)

    if (result.success) {
      onCancelled()
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  return (
    <Card>
      {/* Icon with glow */}
      <div className="flex justify-center">
        <div className="animate-pulse-glow rounded-full p-2">
          <SyncIcon className="h-10 w-10 text-primary-400" />
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col items-center gap-2 text-center">
        <HiPaperAirplane className="h-6 w-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-text md:text-3xl">
          Invite sent
        </h1>
        <p className="text-sm text-text-secondary">
          Waiting for{' '}
          <span className="font-medium text-primary-300">
            {invite.inviteeEmail}
          </span>{' '}
          to accept your connection request.
        </p>
      </div>

      {/* Waiting indicator */}
      <CardInner
        className={cns('flex-row items-center justify-center gap-3 px-5 py-4')}
      >
        <LoadingDots />
        <span className="text-sm text-text-muted">Waiting for response</span>
      </CardInner>

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-error animate-fade-in">
          {error}
        </p>
      )}

      {/* Cancel */}
      <Button
        variant="ghost"
        size="lg"
        className="w-full"
        onClick={handleCancel}
        loading={loading}
      >
        <HiXMark className="h-4 w-4" />
        {loading ? 'Cancelling...' : 'Cancel Invite'}
      </Button>
    </Card>
  )
}
