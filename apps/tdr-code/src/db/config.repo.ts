import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

import type { Db } from './database.module'
import { config, type ConfigRow } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// config repo — main-only writes; bot reads only.
// ──────────────────────────────────────────────────────────────────────────────

export function getConfig(db: Db): ConfigRow | undefined {
  return db.select().from(config).get()
}

// Idempotent seed from env defaults — MAIN ONLY. The bot must never call this.
// Uses BEGIN IMMEDIATE so concurrent callers serialize and re-read rather than
// double-insert (atomicity-tests learning).
export function getOrSeedConfig(db: Db): ConfigRow {
  return db.transaction(
    () => {
      const existing = db.select().from(config).get()
      if (existing) return existing

      return db
        .insert(config)
        .values({
          id: 1,
          cwd: env(EnvKeys.CLAUDE_CWD),
          claudeCommand: env(EnvKeys.CLAUDE_COMMAND, 'claude'),
          claudeArgs: ['--dangerously-skip-permissions'],
          idleTimeoutSec: parseInt(
            env(EnvKeys.AGENT_IDLE_TIMEOUT_SECONDS, '300'),
            10,
          ),
          maxConcurrentSessions: parseInt(
            env(EnvKeys.AGENT_MAX_SESSIONS, '5'),
            10,
          ),
          updatedAt: new Date(),
        })
        .returning()
        .get()!
    },
    { behavior: 'immediate' },
  )
}

export type ConfigPatch = Partial<Omit<ConfigRow, 'id' | 'updatedAt'>>

export function updateConfig(db: Db, patch: ConfigPatch): ConfigRow {
  return db.transaction(
    () => {
      return db
        .update(config)
        .set({ ...patch, updatedAt: new Date() })
        .returning()
        .get()!
    },
    { behavior: 'immediate' },
  )
}
