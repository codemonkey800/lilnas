import { and, eq, or } from 'drizzle-orm'

import { auth } from 'src/auth'
import { db } from 'src/db'
import { partnerships, profiles, users } from 'src/db/schema'

import type { PartnershipStatus } from './types'

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Look up a partner's display info by user id.
 * Returns null when the user has no profile row.
 */
export async function getPartnerInfo(userId: string): Promise<{
  displayName: string
  pronouns: string | null
  email: string
} | null> {
  const [row] = await db
    .select({
      displayName: profiles.displayName,
      pronouns: profiles.pronouns,
      email: users.email,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, userId))
    .limit(1)

  return row ?? null
}

export async function getPartnershipStatus(): Promise<PartnershipStatus | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userId = session.user.id

  // Check for active (accepted) partnership
  const [active] = await db
    .select({
      id: partnerships.id,
      inviterId: partnerships.inviterId,
      inviteeId: partnerships.inviteeId,
    })
    .from(partnerships)
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

  if (active) {
    const partnerId =
      active.inviterId === userId ? active.inviteeId : active.inviterId
    return {
      activePartnership: { id: active.id, partnerId },
      incomingInvites: [],
      outgoingInvite: null,
    }
  }

  // Pending incoming invites (ordered oldest first) -- single JOIN query
  const incomingInvites = await db
    .select({
      id: partnerships.id,
      createdAt: partnerships.createdAt,
      inviterDisplayName: profiles.displayName,
      inviterEmail: users.email,
    })
    .from(partnerships)
    .innerJoin(users, eq(users.id, partnerships.inviterId))
    .innerJoin(profiles, eq(profiles.userId, partnerships.inviterId))
    .where(
      and(
        eq(partnerships.inviteeId, userId),
        eq(partnerships.status, 'pending'),
      ),
    )
    .orderBy(partnerships.createdAt)

  // Pending outgoing invite -- single JOIN query
  const [outgoing] = await db
    .select({
      id: partnerships.id,
      inviteeDisplayName: profiles.displayName,
      inviteeEmail: users.email,
    })
    .from(partnerships)
    .innerJoin(users, eq(users.id, partnerships.inviteeId))
    .innerJoin(profiles, eq(profiles.userId, partnerships.inviteeId))
    .where(
      and(
        eq(partnerships.inviterId, userId),
        eq(partnerships.status, 'pending'),
      ),
    )
    .limit(1)

  return {
    activePartnership: null,
    incomingInvites,
    outgoingInvite: outgoing ?? null,
  }
}
