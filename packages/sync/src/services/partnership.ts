import { and, eq, or } from 'drizzle-orm'

import { db } from 'src/db'
import { partnerships } from 'src/db/schema'

// ---------------------------------------------------------------------------
// Shared partnership helpers (used by templates, check-ins, etc.)
// ---------------------------------------------------------------------------

/**
 * Look up the authenticated user's active (accepted) partnership.
 * Returns the partnership id or null if none found.
 */
export async function getActivePartnership(
  userId: string,
): Promise<{ id: string } | null> {
  const [active] = await db
    .select({ id: partnerships.id })
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

  return active ?? null
}

/**
 * Check whether the given user is a member of an active (accepted)
 * partnership. Returns true if the user is a member and the partnership
 * is in accepted status.
 */
export async function isPartnershipMember(
  partnershipId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      inviterId: partnerships.inviterId,
      inviteeId: partnerships.inviteeId,
    })
    .from(partnerships)
    .where(
      and(
        eq(partnerships.id, partnershipId),
        eq(partnerships.status, 'accepted'),
      ),
    )
    .limit(1)

  if (!row) return false
  return row.inviterId === userId || row.inviteeId === userId
}
