import { eq } from 'drizzle-orm'

import { db } from 'src/db'
import { profiles, users } from 'src/db/schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PartnerInfo {
  displayName: string
  pronouns: string | null
  email: string | null
}

// ---------------------------------------------------------------------------
// Queries (server-component only — NOT a server action)
// ---------------------------------------------------------------------------

export async function getPartnerInfo(
  partnerId: string,
): Promise<PartnerInfo | null> {
  const [result] = await db
    .select({
      displayName: profiles.displayName,
      pronouns: profiles.pronouns,
      email: users.email,
    })
    .from(profiles)
    .innerJoin(users, eq(users.id, profiles.userId))
    .where(eq(profiles.userId, partnerId))
    .limit(1)

  return result ?? null
}
