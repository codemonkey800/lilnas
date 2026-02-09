import { and, eq, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { redirect } from 'next/navigation'

import { auth, signOut } from 'src/auth'
import { db } from 'src/db'
import { partnerships, profiles, users } from 'src/db/schema'

import { PartnerCard } from './partner/partner-card'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  const userId = session.user.id!

  // Table aliases for joining both sides of the partnership
  const inviterProfile = alias(profiles, 'inviter_profile')
  const inviterUser = alias(users, 'inviter_user')
  const inviteeProfile = alias(profiles, 'invitee_profile')
  const inviteeUser = alias(users, 'invitee_user')

  // Run both checks concurrently
  const [profileResult, partnershipResult] = await Promise.all([
    db
      .select({ onboardingCompleted: profiles.onboardingCompleted })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1),
    db
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
      .leftJoin(
        inviterProfile,
        eq(inviterProfile.userId, partnerships.inviterId),
      )
      .leftJoin(inviterUser, eq(inviterUser.id, partnerships.inviterId))
      .leftJoin(
        inviteeProfile,
        eq(inviteeProfile.userId, partnerships.inviteeId),
      )
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
      .limit(1),
  ])

  if (!profileResult[0]?.onboardingCompleted) {
    redirect('/onboarding')
  }

  const activePartnership = partnershipResult[0]

  if (!activePartnership) {
    redirect('/partner')
  }

  // Pick the partner's info based on which side the current user is on
  const isInviter = activePartnership.inviterId === userId

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 animate-fade-in">
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Sync</h1>

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

      <form
        action={async () => {
          'use server'
          await signOut({ redirectTo: '/login' })
        }}
      >
        <button
          type="submit"
          className="rounded-sm bg-bg-surface px-5 py-2.5 text-sm font-medium text-text transition-colors duration-150 ease-smooth hover:bg-bg-overlay focus-visible:shadow-focus"
        >
          Sign out
        </button>
      </form>
    </main>
  )
}
