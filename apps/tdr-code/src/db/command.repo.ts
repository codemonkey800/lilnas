import { sql } from 'drizzle-orm'

import type { Db } from './database.module'
import { type CommandRow, commands, type CommandType } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// command repo — shared between main server (enqueue) and bot (claim).
// ──────────────────────────────────────────────────────────────────────────────

export function enqueue(
  db: Db,
  opts: {
    generationId: number
    type: CommandType
    target: string | null
    createdAt: Date
  },
): CommandRow {
  return db
    .insert(commands)
    .values({
      generationId: opts.generationId,
      type: opts.type,
      target: opts.target,
      status: 'pending',
      createdAt: opts.createdAt,
    })
    .returning()
    .get()!
}

// Atomically claim all pending commands for this generation whose generation
// is not yet finalized. Returns the claimed rows.
// Uses BEGIN IMMEDIATE to prevent double-claim under concurrent bots / retries.
export function claimPending(db: Db, generationId: number): CommandRow[] {
  return db.transaction(
    () => {
      const pending = db
        .select()
        .from(commands)
        .where(
          sql`${commands.generationId} = ${generationId}
            AND ${commands.status} = 'pending'
            AND EXISTS (
              SELECT 1 FROM bot_generation
              WHERE id = ${generationId}
              AND ended_at IS NULL
            )`,
        )
        .all()

      if (pending.length === 0) return []

      const ids = pending.map(r => r.id)
      const now = new Date()
      db.update(commands)
        .set({ status: 'consumed', consumedAt: now })
        .where(
          sql`${commands.id} IN (${sql.join(
            ids.map(id => sql`${id}`),
            sql`, `,
          )})`,
        )
        .run()

      return pending.map(r => ({
        ...r,
        status: 'consumed' as const,
        consumedAt: now,
      }))
    },
    { behavior: 'immediate' },
  )
}
