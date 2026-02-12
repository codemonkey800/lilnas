import { redirect } from 'next/navigation'

import { PartnerConnection } from './partner-connection'
import { getPartnershipStatus } from './queries'

export default async function PartnerPage() {
  // If user already has an active partnership, send them home
  const status = await getPartnershipStatus()

  if (status?.activePartnership) {
    redirect('/')
  }

  return (
    <div className="flex flex-col items-center py-8">
      <PartnerConnection
        initialIncomingInvites={status?.incomingInvites ?? []}
        initialOutgoingInvite={status?.outgoingInvite ?? null}
      />
    </div>
  )
}
