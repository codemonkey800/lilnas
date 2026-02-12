'use client'

import { FormEvent, useState } from 'react'
import { HiEnvelope, HiHeart, HiPaperAirplane } from 'react-icons/hi2'

import { SyncIcon } from 'src/components/sync-icon'
import { Button } from 'src/components/ui/button'
import { Card } from 'src/components/ui/card'
import { FormField } from 'src/components/ui/form-field'
import { Input } from 'src/components/ui/input'

import { sendPartnerInvite } from './actions'
import type { OutgoingInvite } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InviteFormViewProps {
  onSent: (invite: OutgoingInvite) => void
}

// ---------------------------------------------------------------------------
// InviteFormView
// ---------------------------------------------------------------------------

export function InviteFormView({ onSent }: InviteFormViewProps) {
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
    <Card>
      <form onSubmit={handleSubmit} className="contents">
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
            They&apos;ll need to accept before you can start checking in
            together.
          </p>
        </div>

        {/* Email input */}
        <FormField
          label={
            <span className="flex items-center gap-1.5">
              <HiEnvelope className="h-3.5 w-3.5" />
              Partner&apos;s email
            </span>
          }
        >
          <Input
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="partner@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="py-2.5"
          />
        </FormField>

        {/* Error */}
        {error && <p className="text-sm text-error animate-fade-in">{error}</p>}

        {/* Submit */}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!email.trim()}
          loading={loading}
        >
          <HiPaperAirplane className="h-4 w-4" />
          {loading ? 'Sending...' : 'Send Invite'}
        </Button>
      </form>
    </Card>
  )
}
