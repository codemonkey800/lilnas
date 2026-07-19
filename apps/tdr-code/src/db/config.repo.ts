import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

import type { Db } from './database.module'
import { config, type ConfigRow } from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// config repo — main-only writes; bot reads only.
// ──────────────────────────────────────────────────────────────────────────────

// Current pinned wrapper spec. 0.59.0 is the first version that reports the
// correct context window for natively-1M models (e.g. claude-sonnet-5) from the
// very first `usage_update` — it seeds the window from the SDK's authoritative
// getContextUsage().rawMaxTokens in the shared createSession() path, which runs
// for both new AND resumed sessions.
//
// History of the "reports a 200k window for a 1M model" bug this pin fixes:
//   - Unpinned `@agentclientprotocol/claude-agent-acp` resolved via a stale npx
//     cache to v0.37, whose only window source was inferContextWindowFromModel()
//     matching `\b1m\b` in the model id/displayName — Anthropic's ids for
//     natively-1M models lack that token, so `usage_update.size` fell back to
//     DEFAULT_CONTEXT_WINDOW (200k) forever.
//   - v0.57/v0.58 added a modelUsage-based correction, but it only fires at the
//     END of a turn and the learned window lives solely on the in-memory Session
//     (wrapper issue #596). tdr-code tears down idle sessions and resumes via
//     loadSession, so every resumed long conversation re-initialized to 200k and
//     emitted a mid-turn `usage_update {used: ~154k, size: 200000}` — tripping
//     the 75% notice — before the end-of-turn correction ever landed. This is
//     why the "^0.57.0" pin was necessary (off ancient 0.37) but not sufficient.
//   - v0.59.0 seeds the real window up front via fetchContextWindowSize(),
//     closing the process-restart / session-resume window.
export const DEFAULT_CLAUDE_ARGS = [
  '@agentclientprotocol/claude-agent-acp@^0.59.0',
]

// Seed defaults shipped by earlier versions of this file. Existing installs
// still carry one of these in their config row; getOrSeedConfig() migrates any
// of them to DEFAULT_CLAUDE_ARGS so a stale pin self-heals on the next main
// boot. A user's own claudeArgs edit via the /config UI is any value NOT in this
// list, and is deliberately left untouched.
const SUPERSEDED_DEFAULT_CLAUDE_ARGS: readonly string[][] = [
  ['@agentclientprotocol/claude-agent-acp'], // pre-pin, unpinned (→ npx-cached 0.37)
  ['@agentclientprotocol/claude-agent-acp@^0.57.0'], // first pin (still 200k on resume)
]

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
// double-insert (atomicity-tests learning). Also self-heals stale defaults: rows
// whose claudeArgs still equals any superseded seed default get migrated to
// DEFAULT_CLAUDE_ARGS — see the block comment above the constants for the
// underlying bug this migration exists to close.
export function getOrSeedConfig(db: Db): ConfigRow {
  return db.transaction(
    () => {
      const existing = db.select().from(config).get()
      if (existing) {
        const isSupersededDefault = SUPERSEDED_DEFAULT_CLAUDE_ARGS.some(
          legacy => claudeArgsMatch(existing.claudeArgs, legacy),
        )
        if (isSupersededDefault) {
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
          autoPostDiffs: false,
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
