/** Context type key used to persist partial reminder state between turns. */
export const REMINDER_CONTEXT_TYPE = 'reminder'

/** Per-user cap on active reminders to prevent abuse. */
export const MAX_REMINDERS_PER_USER = 25

/** Discord's hard character limit for a single message. */
export const DISCORD_MAX_MESSAGE_LENGTH = 2000

/** Maximum allowed length for the user-provided `what` field after sanitisation. */
export const MAX_REMINDER_WHAT_LENGTH = 500

/** NestJS injection token for the Tavily web-search tool. */
export const TAVILY_SEARCH_TOKEN = 'TAVILY_SEARCH'

/** IANA timezone in which cron expressions and local times are interpreted. */
export const REMINDER_TIMEZONE = 'America/Los_Angeles'

/** Minimum allowed interval between two runs of a recurring reminder. */
export const MIN_CRON_INTERVAL_MS = 60_000

/** How often the scheduler looks for due reminders. */
export const REMINDER_TICK_MS = 30_000

/** A due reminder older than this is marked missed instead of delivered. */
export const MAX_LATE_DELIVERY_MS = 60 * 60 * 1000

/** Maximum reminders processed per scheduler tick. */
export const DUE_BATCH_SIZE = 50

/** Finished (completed, cancelled, missed) reminders are purged after this. */
export const FINISHED_RETENTION_DAYS = 90
