import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const REMINDER_STATUSES = [
  'active',
  'completed',
  'cancelled',
  'missed',
] as const
export type ReminderStatus = (typeof REMINDER_STATUSES)[number]

export const REMINDER_SOURCES = ['discord', 'admin'] as const
export type ReminderSource = (typeof REMINDER_SOURCES)[number]

/** Postgres table storing both one-time and recurring reminders. */
export const reminders = pgTable(
  'reminder',
  {
    id: text('id').primaryKey(),
    /** Creator of the reminder. */
    userId: text('user_id').notNull(),
    /** Creator's Discord username at creation; 'admin' from the admin page. */
    userName: text('user_name').notNull().default(''),
    guildId: text('guild_id').notNull().default(''),
    what: text('what').notNull(),
    isRecurring: boolean('is_recurring').notNull().default(false),
    /** Recurring only. */
    cronExpression: text('cron_expression'),
    /** One-time only. */
    scheduledAt: timestamp('scheduled_at', { mode: 'date' }),
    /** Recurring only, optional. */
    endsAt: timestamp('ends_at', { mode: 'date' }),
    scheduleDescription: text('schedule_description').notNull().default(''),
    channelId: text('channel_id'),
    targetUserId: text('target_user_id'),
    actionType: text('action_type').notNull().default('default'),
    status: text('status').$type<ReminderStatus>().notNull().default('active'),
    source: text('source').$type<ReminderSource>().notNull().default('discord'),
    nextRunAt: timestamp('next_run_at', { mode: 'date' }),
    lastRunAt: timestamp('last_run_at', { mode: 'date' }),
    runCount: integer('run_count').notNull().default(0),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { mode: 'date' }),
  },
  table => [
    index('reminder_status_next_run_at_idx').on(table.status, table.nextRunAt),
    index('reminder_user_id_idx').on(table.userId),
  ],
)

/** Row type returned when selecting from the reminders table. */
export type Reminder = typeof reminders.$inferSelect

/** Insert payload accepted when creating a new reminder row. */
export type NewReminder = typeof reminders.$inferInsert

/** Single-row table (id = 'default') holding runtime LLM settings. */
export const botSettings = pgTable('bot_settings', {
  id: text('id').primaryKey().default('default'),
  models: jsonb('models').$type<Record<string, string>>(),
  temperature: real('temperature'),
  reasoningEffort: text('reasoning_effort'),
  systemPrompt: text('system_prompt'),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
})

/** Row type returned when selecting from the bot_settings table. */
export type BotSettingsRow = typeof botSettings.$inferSelect

/** One row per LLM call (text or image), for cost and debugging audits. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id'),
    channelId: text('channel_id'),
    userId: text('user_id'),
    skill: text('skill'),
    operation: text('operation').notNull(),
    model: text('model').notNull(),
    role: text('role'),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedTokens: integer('cached_tokens'),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
    durationMs: integer('duration_ms'),
    retries: integer('retries'),
    finishReason: text('finish_reason'),
    promptHash: text('prompt_hash'),
    prompt: jsonb('prompt'),
    output: jsonb('output'),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
  },
  table => [
    index('llm_calls_channel_id_created_at_idx').on(
      table.channelId,
      table.createdAt,
    ),
    index('llm_calls_created_at_idx').on(table.createdAt),
  ],
)

/** Row type returned when selecting from the llm_calls table. */
export type LlmCallRow = typeof llmCalls.$inferSelect

/** Insert payload accepted when recording an LLM call. */
export type NewLlmCallRow = typeof llmCalls.$inferInsert
