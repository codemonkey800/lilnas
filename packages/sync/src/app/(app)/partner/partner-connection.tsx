'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { IncomingInviteView } from './incoming-invite-view'
import { InviteFormView } from './invite-form-view'
import { PendingOutgoingView } from './pending-outgoing-view'
import type { IncomingInvite, OutgoingInvite } from './types'

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
