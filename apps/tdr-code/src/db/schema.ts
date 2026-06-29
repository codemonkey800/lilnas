import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

// ──────────────────────────────────────────────────────────────────────────────
// Phase A: bot_generation · commands · claude_process
//
// Cross-phase schema map (create only A-phase tables now):
//
// Phase A:
//   bot_generation — supervisor-stamped lifecycle rows (write-once terminal)
//   commands       — polled control→bot transport (at-most-once)
//   claude_process — per-channel claude PGID tracking (child table)
//
// Phase B: sessions, turns, turn_content, events, live_status
// Phase C: config, git_identity
// Phase D: user, session, account, verification (Better Auth)
// ──────────────────────────────────────────────────────────────────────────────

export const BOT_GENERATION_STATUSES = [
  'starting',
  'running',
  'stopping',
  'stopped',
  'crashed',
  'failed',
] as const
export type BotGenerationStatus = (typeof BOT_GENERATION_STATUSES)[number]

export const botGeneration = sqliteTable(
  'bot_generation',
  {
    id: integer().primaryKey(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    status: text({ enum: BOT_GENERATION_STATUSES }).notNull(),
    pid: integer(),
    lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    exitCode: integer('exit_code'),
  },
  t => [
    check(
      'bot_generation_status_check',
      sql`${t.status} IN ('starting','running','stopping','stopped','crashed','failed')`,
    ),
  ],
)

export type BotGenerationRow = typeof botGeneration.$inferSelect

// Discriminated subtypes — callers use type guards; never `row.pid!`.
export type RunningGeneration = BotGenerationRow & {
  status: 'running'
  pid: number
  lastHeartbeatAt: Date
  endedAt: null
  exitCode: null
}

export type EndedGeneration = BotGenerationRow & {
  endedAt: Date
  exitCode: number | null
}

export function isRunningGeneration(
  row: BotGenerationRow,
): row is RunningGeneration {
  return (
    row.status === 'running' &&
    row.pid !== null &&
    row.lastHeartbeatAt !== null &&
    row.endedAt === null
  )
}

export function isEndedGeneration(
  row: BotGenerationRow,
): row is EndedGeneration {
  return row.endedAt !== null
}

// ──────────────────────────────────────────────────────────────────────────────

export const COMMAND_TYPES = ['teardown_channel'] as const
export type CommandType = (typeof COMMAND_TYPES)[number]

export const COMMAND_STATUSES = ['pending', 'consumed'] as const
export type CommandStatus = (typeof COMMAND_STATUSES)[number]

export const commands = sqliteTable(
  'commands',
  {
    id: integer().primaryKey(),
    // FK allows NULL so a finalized generation's commands are still readable,
    // but any enqueued row must reference a real generation (enforced in repo).
    generationId: integer('generation_id')
      .notNull()
      .references(() => botGeneration.id, { onDelete: 'cascade' }),
    type: text({ enum: COMMAND_TYPES }).notNull(),
    // target is type-specific; for teardown_channel it is a Discord snowflake.
    target: text(),
    status: text({ enum: COMMAND_STATUSES }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
  },
  t => [
    check('commands_type_check', sql`${t.type} IN ('teardown_channel')`),
    check('commands_status_check', sql`${t.status} IN ('pending','consumed')`),
    index('commands_generation_status_idx').on(t.generationId, t.status),
  ],
)

export type CommandRow = typeof commands.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────

export const claudeProcess = sqliteTable(
  'claude_process',
  {
    id: integer().primaryKey(),
    generationId: integer('generation_id')
      .notNull()
      .references(() => botGeneration.id, { onDelete: 'cascade' }),
    pgid: integer().notNull(),
    channelId: text('channel_id'),
    spawnedAt: integer('spawned_at', { mode: 'timestamp_ms' }).notNull(),
    exitedAt: integer('exited_at', { mode: 'timestamp_ms' }),
  },
  t => [
    // Partial index for the reaper's live-PGIDs query.
    index('claude_process_live_idx').on(t.generationId),
  ],
)

export type ClaudeProcessRow = typeof claudeProcess.$inferSelect
