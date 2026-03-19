/** Context type key used to persist partial reminder state between turns. */
export const REMINDER_CONTEXT_TYPE = 'reminder'

/**
 * Node.js `setTimeout` max delay (~24.8 days).
 * Reminders scheduled further out use chained intermediate timeouts.
 */
export const MAX_TIMEOUT_MS = 2147483647

/** Per-user cap on active reminders to prevent abuse. */
export const MAX_REMINDERS_PER_USER = 25

/** Upper bound on reminders queued before the delivery function is registered. */
export const MAX_PENDING_DELIVERIES = 50

/** Discord's hard character limit for a single message. */
export const DISCORD_MAX_MESSAGE_LENGTH = 2000

/** Maximum allowed length for the user-provided `what` field after sanitisation. */
export const MAX_REMINDER_WHAT_LENGTH = 500

/** NestJS injection token for the Tavily web-search tool. */
export const TAVILY_SEARCH_TOKEN = 'TAVILY_SEARCH'

/** NestJS injection token for the DALL-E image generation wrapper. */
export const DALLE_WRAPPER_TOKEN = 'DALLE_WRAPPER'
