import { and, eq, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { redirect } from 'next/navigation'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { partnerships, profiles, users } from 'src/db/schema'

import { PartnerCard } from './partner/partner-card'

export default async function HomePage() {
  const session = await auth()
  // Layout guarantees an authenticated session; redirect defensively if missing
  const userId = session?.user?.id
  if (!userId) {
    redirect('/login')
  }

  // Table aliases for joining both sides of the partnership
  const inviterProfile = alias(profiles, 'inviter_profile')
  const inviterUser = alias(users, 'inviter_user')
  const inviteeProfile = alias(profiles, 'invitee_profile')
  const inviteeUser = alias(users, 'invitee_user')

  const [activePartnership] = await db
    .select({
      id: partnerships.id,
      inviterId: partnerships.inviterId,
      inviteeId: partnerships.inviteeId,
      inviterDisplayName: inviterProfile.displayName,
      inviterPronouns: inviterProfile.pronouns,
      inviterEmail: inviterUser.email,
      inviteeDisplayName: inviteeProfile.displayName,
      inviteePronouns: inviteeProfile.pronouns,
      inviteeEmail: inviteeUser.email,
    })
    .from(partnerships)
    .leftJoin(inviterProfile, eq(inviterProfile.userId, partnerships.inviterId))
    .leftJoin(inviterUser, eq(inviterUser.id, partnerships.inviterId))
    .leftJoin(inviteeProfile, eq(inviteeProfile.userId, partnerships.inviteeId))
    .leftJoin(inviteeUser, eq(inviteeUser.id, partnerships.inviteeId))
    .where(
      and(
        eq(partnerships.status, 'accepted'),
        or(
          eq(partnerships.inviterId, userId),
          eq(partnerships.inviteeId, userId),
        ),
      ),
    )
    .limit(1)

  if (!activePartnership) {
    redirect('/partner')
  }

  // Pick the partner's info based on which side the current user is on
  const isInviter = activePartnership.inviterId === userId

  return (
    <div className="flex flex-col items-center gap-6 py-8 animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
        Dashboard
      </h1>

      <PartnerCard
        partnershipId={activePartnership.id}
        displayName={
          (isInviter
            ? activePartnership.inviteeDisplayName
            : activePartnership.inviterDisplayName) ?? 'Partner'
        }
        pronouns={
          isInviter
            ? activePartnership.inviteePronouns
            : activePartnership.inviterPronouns
        }
        email={
          isInviter
            ? activePartnership.inviteeEmail
            : activePartnership.inviterEmail
        }
      />
    </div>
  )
}
