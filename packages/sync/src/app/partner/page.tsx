import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { profiles } from 'src/db/schema'

import { getPartnershipStatus } from './actions'
import { PartnerConnection } from './partner-connection'

export const dynamic = 'force-dynamic'

export default async function PartnerPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  // Redirect users who haven't completed onboarding
  const [profile] = await db
    .select({ onboardingCompleted: profiles.onboardingCompleted })
    .from(profiles)
    .where(eq(profiles.userId, session.user.id!))
    .limit(1)

  if (!profile?.onboardingCompleted) {
    redirect('/onboarding')
  }

  // If user already has an active partnership, send them home
  const status = await getPartnershipStatus()

  if (status?.activePartnership) {
    redirect('/')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <PartnerConnection
        initialIncomingInvites={status?.incomingInvites ?? []}
        initialOutgoingInvite={status?.outgoingInvite ?? null}
      />
    </main>
  )
}
