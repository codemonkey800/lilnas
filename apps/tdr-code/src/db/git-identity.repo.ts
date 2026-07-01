import { eq, sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { gitIdentity } from './schema'

export type GitIdentityRow = typeof gitIdentity.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// git_identity repo — admin-only writes; both planes read.
// ──────────────────────────────────────────────────────────────────────────────

export function getIdentity(
  db: Db,
  discordUserId: string,
): GitIdentityRow | undefined {
  return db
    .select()
    .from(gitIdentity)
    .where(eq(gitIdentity.discordUserId, discordUserId))
    .get()
}

export function listIdentities(db: Db): GitIdentityRow[] {
  return db.select().from(gitIdentity).all()
}

export interface UpsertIdentityInput {
  discordUserId: string
  name: string
  email: string
  keyCiphertext: Buffer
  keyIv: Buffer
  keyAuthTag: Buffer
  keyFingerprint: string
}

// Insert or overwrite — bumps keyVersion on conflict (R12).
export function upsertIdentity(db: Db, input: UpsertIdentityInput): GitIdentityRow {
  const now = new Date()
  return db
    .insert(gitIdentity)
    .values({
      discordUserId: input.discordUserId,
      name: input.name,
      email: input.email,
      keyCiphertext: input.keyCiphertext,
      keyIv: input.keyIv,
      keyAuthTag: input.keyAuthTag,
      keyFingerprint: input.keyFingerprint,
      keyVersion: 1,
      masterKeyVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: gitIdentity.discordUserId,
      set: {
        name: input.name,
        email: input.email,
        keyCiphertext: input.keyCiphertext,
        keyIv: input.keyIv,
        keyAuthTag: input.keyAuthTag,
        keyFingerprint: input.keyFingerprint,
        // Increment keyVersion by 1 on each overwrite (per-row overwrite counter, R12).
        keyVersion: sql`${gitIdentity.keyVersion} + 1`,
        masterKeyVersion: 1,
        updatedAt: now,
      },
    })
    .returning()
    .get()!
}

export function deleteIdentity(db: Db, discordUserId: string): void {
  db.delete(gitIdentity)
    .where(eq(gitIdentity.discordUserId, discordUserId))
    .run()
}
