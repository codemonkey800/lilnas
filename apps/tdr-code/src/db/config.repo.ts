import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

import type { Db } from './database.module'
import { config, type ConfigRow } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// config repo — main-only writes; bot reads only.
// ──────────────────────────────────────────────────────────────────────────────

// Pinned wrapper spec. Unpinned `@agentclientprotocol/claude-agent-acp` resolved
// via npx to a stale cached v0.37 whose inferContextWindowFromModel() only
// inspects the model ID for `\b1m\b` — Anthropic's returned IDs lack that
// token, so `usage_update.size` fell back to DEFAULT_CONTEXT_WINDOW (200k) even
// for sonnet[1m]. v0.57 also scans displayName/description ("1M context"),
// which lands on the correct 1M window.
export const DEFAULT_CLAUDE_ARGS = [
  '@agentclientprotocol/claude-agent-acp@^0.57.0',
]

// Value the seed used to emit before the pin above. Existing installs still
// carry this in their config row; getOrSeedConfig() migrates only this
// specific literal so a user's own claudeArgs edit via the /config UI is left
// alone.
const LEGACY_UNPINNED_CLAUDE_ARGS = ['@agentclientprotocol/claude-agent-acp']

function claudeArgsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function getConfig(db: Db): ConfigRow | undefined {
  return db.select().from(config).get()
}

// Idempotent seed from env defaults — MAIN ONLY. The bot must never call this.
// Uses BEGIN IMMEDIATE so concurrent callers serialize and re-read rather than
// double-insert (atomicity-tests learning). Also self-heals a specific stale
// default: rows whose claudeArgs still equals the pre-pin literal get migrated
// to DEFAULT_CLAUDE_ARGS — see the block comment above the constants for the
// underlying bug this migration exists to close.
export function getOrSeedConfig(db: Db): ConfigRow {
  return db.transaction(
    () => {
      const existing = db.select().from(config).get()
      if (existing) {
        if (claudeArgsMatch(existing.claudeArgs, LEGACY_UNPINNED_CLAUDE_ARGS)) {
          return db
            .update(config)
            .set({ claudeArgs: DEFAULT_CLAUDE_ARGS, updatedAt: new Date() })
            .returning()
            .get()!
        }
        return existing
      }

      return db
        .insert(config)
        .values({
          id: 1,
          cwd: env(EnvKeys.CLAUDE_CWD),
          claudeCommand: env(EnvKeys.CLAUDE_COMMAND, 'npx'),
          claudeArgs: DEFAULT_CLAUDE_ARGS,
          idleTimeoutSec: parseInt(
            env(EnvKeys.AGENT_IDLE_TIMEOUT_SECONDS, '300'),
            10,
          ),
          maxConcurrentSessions: parseInt(
            env(EnvKeys.AGENT_MAX_SESSIONS, '5'),
            10,
          ),
          // Literal, not env()-derived — no sensible env-var default exists
          // for free-form prompt text (unlike the other four seeded fields).
          customSystemPrompt: '',
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
