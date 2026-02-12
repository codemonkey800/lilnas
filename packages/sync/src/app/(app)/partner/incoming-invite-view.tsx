'use client'

import { useState } from 'react'
import { HiCheck, HiEnvelope, HiHeart, HiXMark } from 'react-icons/hi2'

import { SyncIcon } from 'src/components/sync-icon'
import { Avatar } from 'src/components/ui/avatar'
import { Button } from 'src/components/ui/button'
import { Card, CardInner } from 'src/components/ui/card'

import { acceptInvite, declineInvite } from './actions'
import type { IncomingInvite } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IncomingInviteViewProps {
  invite: IncomingInvite
  currentIndex: number
  totalCount: number
  onAccepted: () => void
  onDeclined: () => void
}

// ---------------------------------------------------------------------------
// IncomingInviteView
// ---------------------------------------------------------------------------

export function IncomingInviteView({
  invite,
  currentIndex,
  totalCount,
  onAccepted,
  onDeclined,
}: IncomingInviteViewProps) {
  const [loading, setLoading] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setError(null)
    setLoading('accept')

    const result = await acceptInvite(invite.id)

    if (result.success) {
      onAccepted()
    } else {
      setError(result.error)
      setLoading(null)
    }
  }

  async function handleDecline() {
    setError(null)
    setLoading('decline')

    const result = await declineInvite(invite.id)

    if (result.success) {
      setLoading(null)
      onDeclined()
    } else {
      setError(result.error)
      setLoading(null)
    }
  }

  return (
    <Card key={invite.id}>
      {/* Icon */}
      <div className="flex justify-center">
        <SyncIcon className="h-10 w-10 text-primary-400" />
      </div>

      {/* Header */}
      <div className="flex flex-col items-center gap-2 text-center">
        <HiHeart className="h-6 w-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-text md:text-3xl">
          You have a connection request
        </h1>
        <p className="text-sm text-text-secondary">
          Someone wants to be your partner on Sync.
        </p>
      </div>

      {/* Invite card */}
      <CardInner className="animate-slide-up">
        <Avatar initial={invite.inviterDisplayName} />

        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-semibold text-text">
            {invite.inviterDisplayName}
          </span>
          <span className="flex items-center gap-1.5 text-sm text-text-muted">
            <HiEnvelope className="h-3.5 w-3.5" />
            {invite.inviterEmail}
          </span>
        </div>
      </CardInner>

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-error animate-fade-in">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          className="w-full"
          onClick={handleAccept}
          disabled={loading !== null}
        >
          <HiCheck className="h-4 w-4" />
          {loading === 'accept' ? 'Accepting...' : 'Accept'}
        </Button>

        <Button
          variant="ghost"
          size="lg"
          className="w-full"
          onClick={handleDecline}
          disabled={loading !== null}
        >
          <HiXMark className="h-4 w-4" />
          {loading === 'decline' ? 'Declining...' : 'Decline'}
        </Button>
      </div>

      {/* Counter */}
      {totalCount > 1 && (
        <p className="text-center text-xs text-text-muted">
          Request {currentIndex + 1} of {totalCount}
        </p>
      )}
    </Card>
  )
}
