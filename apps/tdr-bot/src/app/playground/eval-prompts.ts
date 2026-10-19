/**
 * Fixed eval prompts: ten short messages a TDR member would send. Every ticked
 * model answers each one as a fresh one-message conversation, so the set is
 * deliberately plain (no emojis) to see what the model adds on its own.
 */
export const EVAL_PROMPTS: readonly string[] = [
  'yo whats up',
  "how's your day going",
  'rate my new keyboard, just got a keychron q1',
  'roast jack for me',
  'hype me up for the gym rn',
  'what should we play tonight',
  'man i feel like garbage today',
  "that's cap and you know it",
  'what should i get for dinner',
  'goodnight everyone',
]
