'use client'

import { cns } from '@lilnas/utils/cns'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import {
  HiCheck,
  HiEnvelope,
  HiHeart,
  HiPaperAirplane,
  HiXMark,
} from 'react-icons/hi2'

import { SyncIcon } from 'src/components/sync-icon'

import {
  acceptInvite,
  cancelInvite,
  declineInvite,
  type IncomingInvite,
  type OutgoingInvite,
  sendPartnerInvite,
} from './actions'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PartnerConnectionProps {
  initialIncomingInvites: IncomingInvite[]
  initialOutgoingInvite: OutgoingInvite | null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PartnerConnection({
  initialIncomingInvites,
  initialOutgoingInvite,
}: PartnerConnectionProps) {
  const router = useRouter()
  const [incomingInvites, setIncomingInvites] = useState(initialIncomingInvites)
  const [outgoingInvite, setOutgoingInvite] = useState(initialOutgoingInvite)
  const [inviteIndex, setInviteIndex] = useState(0)

  // Determine which view to show
  const currentInvite = incomingInvites[inviteIndex] as
    | IncomingInvite
    | undefined

  if (currentInvite) {
    return (
      <IncomingInviteView
        invite={currentInvite}
        currentIndex={inviteIndex}
        totalCount={incomingInvites.length}
        onAccepted={() => router.push('/')}
        onDeclined={() => {
          if (inviteIndex < incomingInvites.length - 1) {
            setInviteIndex(i => i + 1)
          } else {
            // All invites processed, clear them
            setIncomingInvites([])
            setInviteIndex(0)
          }
        }}
      />
    )
  }

  if (outgoingInvite) {
    return (
      <PendingOutgoingView
        invite={outgoingInvite}
        onCancelled={() => setOutgoingInvite(null)}
      />
    )
  }

  return <InviteFormView onSent={invite => setOutgoingInvite(invite)} />
}

// ---------------------------------------------------------------------------
// State A: Incoming invite review (one at a time)
// ---------------------------------------------------------------------------

interface IncomingInviteViewProps {
  invite: IncomingInvite
  currentIndex: number
  totalCount: number
  onAccepted: () => void
  onDeclined: () => void
}

function IncomingInviteView({
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
    <div
      key={invite.id}
      className={cns(
        'flex w-full max-w-lg flex-col gap-6',
        'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
        'animate-fade-in',
      )}
    >
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
      <div
        className={cns(
          'flex flex-col items-center gap-3 rounded-md border border-border-subtle',
          'bg-bg-raised p-5 animate-slide-up',
        )}
      >
        {/* Avatar placeholder */}
        <div
          className={cns(
            'flex h-14 w-14 items-center justify-center rounded-full',
            'bg-primary-900 text-xl font-bold text-primary-300',
          )}
        >
          {invite.inviterDisplayName.charAt(0).toUpperCase()}
        </div>

        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-semibold text-text">
            {invite.inviterDisplayName}
          </span>
          <span className="flex items-center gap-1.5 text-sm text-text-muted">
            <HiEnvelope className="h-3.5 w-3.5" />
            {invite.inviterEmail}
          </span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-error animate-fade-in">
          {error}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={loading !== null}
          className={cns(
            'inline-flex w-full items-center justify-center gap-2 rounded-sm px-5 py-2.5',
            'bg-primary text-sm font-medium text-text-inverse',
            'transition-colors duration-150 ease-smooth',
            'hover:bg-primary-600',
            'focus-visible:shadow-focus',
            'disabled:opacity-40',
          )}
        >
          <HiCheck className="h-4 w-4" />
          {loading === 'accept' ? 'Accepting...' : 'Accept'}
        </button>

        <button
          type="button"
          onClick={handleDecline}
          disabled={loading !== null}
          className={cns(
            'inline-flex w-full items-center justify-center gap-2 rounded-sm px-4 py-2.5',
            'text-sm font-medium text-text-secondary',
            'transition-colors duration-150 ease-smooth',
            'hover:bg-bg-overlay hover:text-text',
            'focus-visible:shadow-focus',
            'disabled:opacity-40',
          )}
        >
          <HiXMark className="h-4 w-4" />
          {loading === 'decline' ? 'Declining...' : 'Decline'}
        </button>
      </div>

      {/* Counter */}
      {totalCount > 1 && (
        <p className="text-center text-xs text-text-muted">
          Request {currentIndex + 1} of {totalCount}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// State B: Invite form (send invite by email)
// ---------------------------------------------------------------------------

interface InviteFormViewProps {
  onSent: (invite: OutgoingInvite) => void
}

function InviteFormView({ onSent }: InviteFormViewProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await sendPartnerInvite(email)

    if (result.success) {
      onSent({
        id: result.partnershipId ?? '',
        inviteeDisplayName: '',
        inviteeEmail: email.trim().toLowerCase(),
      })
    } else {
      setError(result.error)
    }

    setLoading(false)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cns(
        'flex w-full max-w-lg flex-col gap-6',
        'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
        'animate-fade-in',
      )}
    >
      {/* Icon */}
      <div className="flex justify-center">
        <SyncIcon className="h-10 w-10 text-primary-400" />
      </div>

      {/* Header */}
      <div className="flex flex-col items-center gap-2 text-center">
        <HiHeart className="h-6 w-6 text-primary-400" />
        <h1 className="text-2xl font-bold text-text md:text-3xl">
          Connect with your partner
        </h1>
        <p className="text-sm text-text-secondary">
          Enter your partner&apos;s email to send them a connection request.
          They&apos;ll need to accept before you can start checking in together.
        </p>
      </div>

      {/* Email input */}
      <label className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-sm font-medium text-text-secondary">
          <HiEnvelope className="h-3.5 w-3.5" />
          Partner&apos;s email
        </span>
        <input
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="partner@example.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className={cns(
            'w-full rounded-sm border border-border bg-bg-raised px-3 py-2.5',
            'text-sm text-text placeholder:text-text-muted',
            'transition-colors duration-150 ease-smooth',
            'focus:border-primary focus:outline-none focus-visible:shadow-focus',
          )}
        />
      </label>

      {/* Error */}
      {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !email.trim()}
        className={cns(
          'inline-flex w-full items-center justify-center gap-2 rounded-sm px-5 py-2.5',
          'bg-primary text-sm font-medium text-text-inverse',
          'transition-colors duration-150 ease-smooth',
          'hover:bg-primary-600',
          'focus-visible:shadow-focus',
          'disabled:opacity-40',
        )}
      >
        <HiPaperAirplane className="h-4 w-4" />
        {loading ? 'Sending...' : 'Send Invite'}
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// State C: Pending outgoing invite (waiting for partner to respond)
// ---------------------------------------------------------------------------

interface PendingOutgoingViewProps {
  invite: OutgoingInvite
  onCancelled: () => void
}

function PendingOutgoingView({
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
    <div
      className={cns(
        'flex w-full max-w-lg flex-col gap-6',
        'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
        'animate-fade-in',
      )}
    >
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
      <div
        className={cns(
          'flex items-center justify-center gap-3 rounded-md border border-border-subtle',
          'bg-bg-raised px-5 py-4',
        )}
      >
        {/* Animated dots */}
        <div className="flex gap-1.5">
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-primary-500"
            style={{ animationDelay: '0ms' }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-primary-500"
            style={{ animationDelay: '150ms' }}
          />
          <span
            className="h-2 w-2 animate-bounce rounded-full bg-primary-500"
            style={{ animationDelay: '300ms' }}
          />
        </div>
        <span className="text-sm text-text-muted">Waiting for response</span>
      </div>

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-error animate-fade-in">
          {error}
        </p>
      )}

      {/* Cancel */}
      <button
        type="button"
        onClick={handleCancel}
        disabled={loading}
        className={cns(
          'inline-flex w-full items-center justify-center gap-2 rounded-sm px-4 py-2.5',
          'text-sm font-medium text-text-secondary',
          'transition-colors duration-150 ease-smooth',
          'hover:bg-bg-overlay hover:text-text',
          'focus-visible:shadow-focus',
          'disabled:opacity-40',
        )}
      >
        <HiXMark className="h-4 w-4" />
        {loading ? 'Cancelling...' : 'Cancel Invite'}
      </button>
    </div>
  )
}
