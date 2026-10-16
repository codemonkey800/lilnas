/** Model for emoji descriptions. Must be in the catalog with vision. Switch to 'gpt-6.1-sol' here. */
export const EMOJI_DESCRIBER_MODEL = 'gpt-6-luna'
export const EMOJI_DESCRIBER_REASONING_EFFORT = 'low'
/** Reasoning tokens count against this cap, so keep headroom. */
export const EMOJI_DESCRIBE_MAX_TOKENS = 400
export const EMOJI_DESCRIPTION_MAX_CHARS = 120
/** Emojis described per LLM call when re-describing everything. */
export const EMOJI_BATCH_SIZE = 20
/** Extra output budget per emoji in a batched call, on top of the base cap. */
export const EMOJI_BATCH_TOKENS_PER_EMOJI = 80
export const EMOJI_EXAMPLE_COUNT = 10
export const EMOJI_DESCRIBE_CONCURRENCY = 4
export const EMOJI_RECONCILE_CRON = '30 4 * * *'
