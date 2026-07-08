import { sql } from 'drizzle-orm'
import {
  blob,
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ──────────────────────────────────────────────────────────────────────────────
// Cross-phase schema map:
//
// Phase A (locked):
//   bot_generation — supervisor-stamped lifecycle rows (write-once terminal)
//   commands       — polled control→bot transport (at-most-once)
//   claude_process — per-channel claude PGID tracking (child table)
//
// Phase B (locked — B1):
//   sessions     — per-channel agent session records (R6/R7)
//   turns        — per-session turn records (R6)
//   turn_content — ordered per-turn content blocks (R6: prompts, agent text, tool calls, diffs)
//   events       — structured event/error feed (R9/R10)
//   live_status  — poll-fresh channel activity snapshot (R5)
//
// Phase C (locked — C1):
//   config       — global operator config (single-row, seeded from env)
//   git_identity — Discord snowflake → git author mapping
//
// Phase D (U1 — Better Auth, schema only; no auth behavior wired yet):
//   user         — Better Auth identity row
//   session      — Better Auth session row (DB-backed opaque session, not a JWT)
//   account      — Better Auth provider-linked credential row (Discord OAuth)
//   verification — Better Auth OAuth state / verification token row
//
// Forward-compatibility notes:
//   sessions.triggering_user_id and turns.user_id are raw Discord snowflakes (no FK) so
//   Phase C git_identity and Phase D account can attach without migration churn.
//
// Identity invariant (Phase D): account.accountId (providerId 'discord') ===
// git_identity.discordUserId === the bot's message.author.id — all three are
// the same raw Discord snowflake string, just reached via different tables.
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

export const COMMAND_TYPES = ['teardown_channel', 'reread_config'] as const
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
    check(
      'commands_type_check',
      sql`${t.type} IN ('teardown_channel','reread_config')`,
    ),
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

// ──────────────────────────────────────────────────────────────────────────────
// Phase B — U1: sessions · turns · turn_content
// ──────────────────────────────────────────────────────────────────────────────

export const SESSION_END_REASONS = [
  'evicted',
  'teardown',
  'interrupted',
] as const
export type SessionEndReason = (typeof SESSION_END_REASONS)[number]

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer().primaryKey(),
    channelId: text('channel_id').notNull(),
    generationId: integer('generation_id')
      .notNull()
      .references(() => botGeneration.id, { onDelete: 'restrict' }),
    // Raw Discord snowflake — no FK; Phase D account attaches without migration churn.
    triggeringUserId: text('triggering_user_id').notNull(),
    // R8 linkage columns: nullable acp_session_id + cwd for future JSONL reconciliation.
    acpSessionId: text('acp_session_id'),
    cwd: text('cwd').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    endReason: text('end_reason', { enum: SESSION_END_REASONS }),
  },
  t => [
    check(
      'sessions_end_reason_check',
      sql`${t.endReason} IN ('evicted','teardown','interrupted')`,
    ),
    // Correlation: ended_at and end_reason must both be null or both be set.
    check(
      'sessions_ended_correlation_check',
      sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
    // Browse by channel + time (R7 affordance).
    index('sessions_channel_created_idx').on(t.channelId, t.createdAt),
    // Reconciliation sweep: find sessions from a prior generation.
    index('sessions_generation_idx').on(t.generationId),
    // Active-session lookup: newest-open session per channel. Non-unique so a crash
    // doesn't wedge the channel (Decision 8 — unique hardening deferred to reconciliation unit).
    index('sessions_active_lookup_idx')
      .on(t.channelId, t.createdAt)
      .where(sql`${t.endedAt} IS NULL`),
  ],
)

export type SessionRow = typeof sessions.$inferSelect

export type ActiveSession = SessionRow & { endedAt: null; endReason: null }
export type EndedSession = SessionRow & {
  endedAt: Date
  endReason: SessionEndReason
}

export function isActiveSession(row: SessionRow): row is ActiveSession {
  return row.endedAt === null
}

export function isEndedSession(row: SessionRow): row is EndedSession {
  return row.endedAt !== null
}

// ──────────────────────────────────────────────────────────────────────────────

export const TURN_STATUSES = [
  'running',
  'completed',
  'cancelled',
  'errored',
  'interrupted',
] as const
export type TurnStatus = (typeof TURN_STATUSES)[number]

export const turns = sqliteTable(
  'turns',
  {
    id: integer().primaryKey(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // Stamped directly: the generation that RAN this turn (not the session's birth generation).
    generationId: integer('generation_id')
      .notNull()
      .references(() => botGeneration.id, { onDelete: 'restrict' }),
    // 1-based per-session display ordinal; supplied by the writer from an in-memory counter.
    turnIndex: integer('turn_index').notNull(),
    // Raw Discord snowflake; nullable — reconciliation-closed turns have no live driver.
    userId: text('user_id'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    // ACP-reported descriptive stop reason — free text, not CHECK-constrained (distinct from status).
    stopReason: text('stop_reason'),
    status: text('status', { enum: TURN_STATUSES }).notNull(),
  },
  t => [
    check(
      'turns_status_check',
      sql`${t.status} IN ('running','completed','cancelled','errored','interrupted')`,
    ),
    // Correlation: status='running' iff ended_at IS NULL (makes type guards sound).
    check(
      'turns_status_ended_correlation_check',
      sql`(${t.status} = 'running') = (${t.endedAt} IS NULL)`,
    ),
    check('turns_turn_index_positive_check', sql`${t.turnIndex} >= 1`),
    // One row per (session, ordinal).
    uniqueIndex('turns_session_turn_index_unique_idx').on(
      t.sessionId,
      t.turnIndex,
    ),
    // Dangling-turn sweep: find running turns from a prior generation (direct indexed predicate).
    index('turns_dangling_sweep_idx')
      .on(t.generationId)
      .where(sql`${t.endedAt} IS NULL`),
  ],
)

export type TurnRow = typeof turns.$inferSelect

export type RunningTurn = TurnRow & { status: 'running'; endedAt: null }
export type TerminalTurn = TurnRow & {
  endedAt: Date
  status: 'completed' | 'cancelled' | 'errored' | 'interrupted'
}

export function isRunningTurn(row: TurnRow): row is RunningTurn {
  return row.status === 'running'
}

export function isTerminalTurn(row: TurnRow): row is TerminalTurn {
  return row.endedAt !== null
}

// ──────────────────────────────────────────────────────────────────────────────

export const TURN_CONTENT_KINDS = [
  'prompt',
  'agent_text',
  'tool_call',
  'diff',
] as const
export type TurnContentKind = (typeof TURN_CONTENT_KINDS)[number]

// Per-kind payload shapes — exact fields for prompt/diff finalized in B3 from ACP event types.
export type PromptPayload = {
  kind: 'prompt'
  text: string
  images?: Array<{ data: string; mimeType: string }>
}

export type AgentTextPayload = {
  kind: 'agent_text'
  text: string
}

export type ToolCallPayload = {
  kind: 'tool_call'
  title: string
  toolKind: string
  status: string
}

export type DiffPayload = {
  kind: 'diff'
  path: string
  oldText?: string | null
  newText: string
}

export type TurnContentPayload =
  | PromptPayload
  | AgentTextPayload
  | ToolCallPayload
  | DiffPayload

// Compile-time exhaustiveness pin: bidirectional coverage check ties the TURN_CONTENT_KINDS
// tuple to TurnContentPayload discriminants. Adding a kind to one without the other fails here.
type _ExhaustiveTurnContentKinds = [TurnContentKind] extends [
  TurnContentPayload['kind'],
]
  ? [TurnContentPayload['kind']] extends [TurnContentKind]
    ? true
    : never
  : never
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _turnContentKindPin: _ExhaustiveTurnContentKinds = true

// A validating narrower keyed on kind — returns null for unrecognized/old shapes
// rather than throwing (one bad row must not break a transcript view).
// columnKind: when provided, rejects rows where payload.kind diverges from the column value.
export function narrowTurnContentPayload(
  payload: unknown,
  columnKind?: TurnContentKind,
): TurnContentPayload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const o = payload as Record<string, unknown>
  if (columnKind !== undefined && o.kind !== columnKind) return null
  switch (o.kind) {
    case 'prompt':
    case 'agent_text':
      return typeof o.text === 'string' ? (payload as TurnContentPayload) : null
    case 'tool_call':
      return typeof o.title === 'string' &&
        typeof o.toolKind === 'string' &&
        typeof o.status === 'string'
        ? (payload as ToolCallPayload)
        : null
    case 'diff':
      return typeof o.path === 'string' && typeof o.newText === 'string'
        ? (payload as DiffPayload)
        : null
    default:
      return null
  }
}

export const turnContent = sqliteTable(
  'turn_content',
  {
    id: integer().primaryKey(),
    turnId: integer('turn_id')
      .notNull()
      .references(() => turns.id, { onDelete: 'cascade' }),
    // ACP toolCallId — null for prompt/agent_text/diff; identifies the tool call for in-place update.
    ref: text('ref'),
    kind: text('kind', { enum: TURN_CONTENT_KINDS }).notNull(),
    payload: text('payload', { mode: 'json' })
      .$type<TurnContentPayload>()
      .notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    check(
      'turn_content_kind_check',
      sql`${t.kind} IN ('prompt','agent_text','tool_call','diff')`,
    ),
    // One row per tool call per turn — indexed for the create-then-update ACP stream (Decision 9).
    uniqueIndex('turn_content_ref_unique_idx')
      .on(t.turnId, t.ref)
      .where(sql`${t.ref} IS NOT NULL`),
    // Read all blocks for a turn in insertion (id) order.
    index('turn_content_turn_idx').on(t.turnId),
  ],
)

export type TurnContentRow = typeof turnContent.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// Phase B — U2: events · live_status
// ──────────────────────────────────────────────────────────────────────────────

// Closed enum — grows per phase. Add a value + migration each time. A sanctioned
// relaxation (drop the CHECK, keep the TS enum) applies if churn proves painful or
// a third phase must add types (Decision 6). Seed includes deferred Phase A producers
// (bot_restart, command_anomaly) and the reconciliation type (turn_interrupted) so
// wiring those sinks later needs no migration.
export const EVENT_TYPES = [
  'session_created',
  'session_evicted',
  'turn_started',
  'turn_completed',
  'turn_cancelled',
  'turn_errored',
  'turn_interrupted',
  'bot_restart',
  'command_anomaly',
  'transcript_write_failed',
  // Phase C: git-identity enforcement events (R17, R18).
  'git_push_blocked',
  'git_key_decrypt_failed',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_LEVELS = ['info', 'warn', 'error'] as const
export type EventLevel = (typeof EVENT_LEVELS)[number]

// Structured context bag — per-event-type field shapes finalized by the writer units.
export type EventContext = Record<string, unknown>

export const events = sqliteTable(
  'events',
  {
    id: integer().primaryKey(),
    generationId: integer('generation_id')
      .notNull()
      .references(() => botGeneration.id, { onDelete: 'restrict' }),
    // Nullable + SET NULL: an event outlives a pruned session, retaining channel_id for context.
    // A bot-global event (bot_restart, command_anomaly) has both session_id and channel_id null.
    sessionId: integer('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    // Denormalized from the session — writer invariant: when session_id is non-null,
    // channel_id must equal that session's channel_id. SQLite can't CHECK a subquery.
    channelId: text('channel_id'),
    type: text('type', { enum: EVENT_TYPES }).notNull(),
    level: text('level', { enum: EVENT_LEVELS }).notNull(),
    context: text('context', { mode: 'json' }).$type<EventContext>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    check(
      'events_type_check',
      sql`${t.type} IN ('session_created','session_evicted','turn_started','turn_completed','turn_cancelled','turn_errored','turn_interrupted','bot_restart','command_anomaly','transcript_write_failed','git_push_blocked','git_key_decrypt_failed')`,
    ),
    check('events_level_check', sql`${t.level} IN ('info','warn','error')`),
    // Feed filters (R10 affordance).
    index('events_created_at_idx').on(t.createdAt),
    index('events_channel_created_idx').on(t.channelId, t.createdAt),
    index('events_session_idx').on(t.sessionId),
    index('events_type_idx').on(t.type),
  ],
)

export type EventRow = typeof events.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────

export const liveStatus = sqliteTable(
  'live_status',
  {
    // PK is the channel snowflake — one row per active channel; upsert target for B5.
    channelId: text('channel_id').primaryKey(),
    generationId: integer('generation_id')
      .notNull()
      .references(() => botGeneration.id, { onDelete: 'restrict' }),
    triggeringUserId: text('triggering_user_id'),
    // Stored as integer 0/1; all mutations are generation-guarded (Decision 10).
    prompting: integer('prompting', { mode: 'boolean' }).notNull(),
    queueDepth: integer('queue_depth').notNull(),
    lastActivityAt: integer('last_activity_at', {
      mode: 'timestamp_ms',
    }).notNull(),
    lastHeartbeatAt: integer('last_heartbeat_at', {
      mode: 'timestamp_ms',
    }).notNull(),
  },
  t => [
    check('live_status_prompting_check', sql`${t.prompting} IN (0,1)`),
    check('live_status_queue_depth_check', sql`${t.queueDepth} >= 0`),
    // Reconciliation: clear stale prior-generation rows.
    index('live_status_generation_idx').on(t.generationId),
  ],
)

export type LiveStatusRow = typeof liveStatus.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// Phase C — global config (single-row, id=1 enforced by CHECK)
// ──────────────────────────────────────────────────────────────────────────────

export const config = sqliteTable(
  'config',
  {
    // Always id=1; CHECK prevents a second row being inserted.
    id: integer().primaryKey(),
    cwd: text('cwd').notNull(),
    claudeCommand: text('claude_command').notNull(),
    // JSON-serialised string[]; default ['--dangerously-skip-permissions'].
    claudeArgs: text('claude_args', { mode: 'json' })
      .$type<string[]>()
      .notNull(),
    idleTimeoutSec: integer('idle_timeout_sec').notNull(),
    maxConcurrentSessions: integer('max_concurrent_sessions').notNull(),
    // Operator-editable text appended after the hardcoded base system prompt
    // (see agent/system-prompt.constants.ts). Not env-seedable — there's no
    // sensible env-var default for free-form prompt text — so NOT NULL with
    // a literal '' default keeps "unset" and "empty" the same state.
    customSystemPrompt: text('custom_system_prompt').notNull().default(''),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    check('config_single_row_check', sql`${t.id} = 1`),
    check('config_idle_timeout_check', sql`${t.idleTimeoutSec} > 0`),
    check('config_max_sessions_check', sql`${t.maxConcurrentSessions} >= 1`),
  ],
)

export type ConfigRow = typeof config.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// Phase C — git_identity (Discord snowflake → encrypted git author)
// ──────────────────────────────────────────────────────────────────────────────

export const gitIdentity = sqliteTable('git_identity', {
  discordUserId: text('discord_user_id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  // AES-256-GCM blobs — all three required for decryption (Decision #8).
  keyCiphertext: blob('key_ciphertext', { mode: 'buffer' }).notNull(),
  keyIv: blob('key_iv', { mode: 'buffer' }).notNull(),
  keyAuthTag: blob('key_auth_tag', { mode: 'buffer' }).notNull(),
  keyFingerprint: text('key_fingerprint').notNull(),
  // Per-row overwrite counter (bumped on each upsert) — NOT a master-key
  // version identifier.
  keyVersion: integer('key_version').notNull().default(1),
  // Which master key encrypted this row; seeded to 1, never incremented this
  // phase — reserved for rotation tooling.
  masterKeyVersion: integer('master_key_version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ──────────────────────────────────────────────────────────────────────────────
// GitHub-linking plan — U1: github_credential (Better Auth `account` row
// linkage → encrypted GitHub OAuth token)
//
// Sibling to git_identity above, but for a GitHub OAuth token rather than an
// SSH private key: one row per Better Auth `user.id` (not a raw Discord
// snowflake — see the account table below for how the two connect), storing
// the encrypted token plus the profile fields derived from it at link time
// (R8). Keyed on userId as a PRIMARY KEY (not a unique index over a
// nullable/multi-row shape) is itself the "no multiple-GitHub-accounts per
// user" enforcement (Scope Boundaries) — a second `linkSocial` call for the
// same user overwrites this single row rather than creating a second one.
//
// CRITICAL READ-SIDE INVARIANT (see the plan's "Key Technical Decisions" —
// the write-side non-atomicity finding): the hook that writes this table and
// Better Auth's own `account` row insert are two independent, non-
// transactional operations (Better Auth's `linkSocial`/`linkAccount` path
// has no transaction wrapper, and this app's Drizzle adapter sets
// `transaction: false`). A failed/racing `account` insert after this
// table's write has already committed leaves an ORPHANED github_credential
// row with no matching `account` row. Exactly like the existing Discord
// guild-gate hook's mirror-image orphaned-`user`-row case (see
// `auth/guild-gate.ts`'s header comment and `db/auth-sweep.repo.ts`'s
// `sweepAccountlessUsers`), the fix is never trusting write-side atomicity
// across a Better Auth hook boundary: every read site
// (`github-credential.repo.ts`'s getGithubCredential /
// getGithubCredentialByDiscordUserId / listGithubCredentialStatuses) must
// INNER JOIN against `account` (providerId = 'github') before reporting a
// user as linked — a bare `SELECT * FROM github_credential` is never
// sufficient to answer "is this user linked?". An orphaned row is invisible
// everywhere that matters and self-heals on next observation; a periodic
// sweep is optional cleanup hygiene, not the correctness mechanism.
// ──────────────────────────────────────────────────────────────────────────────

export const githubCredential = sqliteTable('github_credential', {
  // Better Auth's user.id — NOT a raw Discord snowflake. One row per user;
  // this PK is what enforces "no multiple-GitHub-accounts per user."
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  // GitHub's numeric profile id (as a string) and login, captured at link
  // time from GET /user — used to compute derivedEmail's noreply address
  // and to detect a duplicate-account-link conflict (R8, see auth-account-
  // hook.ts in a later unit).
  githubUserId: text('github_user_id').notNull(),
  githubLogin: text('github_login').notNull(),
  // R8: auto-derived commit identity — name = GitHub name falling back to
  // login; email = the account's noreply address. Never manually entered.
  derivedName: text('derived_name').notNull(),
  derivedEmail: text('derived_email').notNull(),
  // AES-256-GCM blobs — all three required for decryption, same shape as
  // git_identity's key* columns above.
  tokenCiphertext: blob('token_ciphertext', { mode: 'buffer' }).notNull(),
  tokenIv: blob('token_iv', { mode: 'buffer' }).notNull(),
  tokenAuthTag: blob('token_auth_tag', { mode: 'buffer' }).notNull(),
  // The granted OAuth scope string (e.g. "repo,workflow,read:user,user:email"),
  // stored for future scope-narrowing audits (R6).
  scope: text('scope').notNull(),
  // Which master key encrypted this row; seeded to 1, never incremented this
  // phase — reserved for rotation tooling (mirrors git_identity's column).
  masterKeyVersion: integer('master_key_version').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type GithubCredentialRow = typeof githubCredential.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// Phase D — U1: user · session · account · verification (Better Auth)
//
// Canonical shape per `@better-auth/cli generate` (Better Auth 1.6.x Drizzle/
// SQLite output), hand-placed here (not machine-generated into this file) so
// `drizzle-kit generate` — not Better Auth's own Kysely-only `migrate` — owns
// these tables' migrations, per the reserved-tables note above. No auth
// behavior is wired yet; this unit is schema/deps only.
//
// The Better Auth `session` table (this export, SQL table `session`,
// singular) is unrelated to the Phase B `sessions` export (SQL table
// `sessions`, plural agent-session records) — same-ish name, different
// tables, no collision.
// ──────────────────────────────────────────────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type UserRow = typeof user.$inferSelect

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  t => [index('session_user_id_idx').on(t.userId)],
)

// Named AuthSessionRow (not SessionRow) to avoid colliding with the Phase B
// `sessions` table's SessionRow export above — same-ish name, different
// tables (see the note on the `session` sqliteTable above).
export type AuthSessionRow = typeof session.$inferSelect

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    // Provider-side account identifier. For providerId 'discord', this is the
    // raw Discord snowflake — same value as git_identity.discordUserId and
    // the bot's message.author.id (see the identity invariant note above).
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    index('account_user_id_idx').on(t.userId),
    // Paired defense for U3's fail-closed guild gate: even if a future code
    // path ever bypassed the guild check before provisioning an account row,
    // this backstops against two account rows aliasing the same provider
    // identity (e.g. the same Discord snowflake linked twice). Partial (not a
    // plain unique index) because Better Auth's credential provider can
    // insert accountId values that are not provider-scoped snowflakes for
    // non-social providers — scoping to providerId keeps the constraint
    // meaningful without assuming every row is a Discord row.
    uniqueIndex('account_provider_account_unique_idx')
      .on(t.providerId, t.accountId)
      .where(sql`${t.providerId} IS NOT NULL AND ${t.accountId} IS NOT NULL`),
  ],
)

export type AccountRow = typeof account.$inferSelect

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [index('verification_identifier_idx').on(t.identifier)],
)

export type VerificationRow = typeof verification.$inferSelect
