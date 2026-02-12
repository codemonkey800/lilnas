// ---------------------------------------------------------------------------
// Partner types
// ---------------------------------------------------------------------------

export type ActionResult =
  | { success: true; partnershipId?: string }
  | { success: false; error: string }

export interface IncomingInvite {
  id: string
  inviterDisplayName: string
  inviterEmail: string | null
  createdAt: Date | null
}

export interface OutgoingInvite {
  id: string
  inviteeDisplayName: string
  inviteeEmail: string | null
}

export interface PartnershipStatus {
  activePartnership: { id: string; partnerId: string } | null
  incomingInvites: IncomingInvite[]
  outgoingInvite: OutgoingInvite | null
}
