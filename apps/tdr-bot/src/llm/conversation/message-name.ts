const INVALID_NAME_CHARS = /[\s<|\\/>]+/g
const MAX_NAME_LENGTH = 64

/**
 * OpenAI rejects a message `name` that does not match `^[^\s<|\\/>]+$`, so
 * Discord display names are sanitised before being stamped on a message.
 * Returns undefined when nothing usable remains.
 */
export function toMessageName(user: string): string | undefined {
  const name = user
    .trim()
    .replace(INVALID_NAME_CHARS, '_')
    .slice(0, MAX_NAME_LENGTH)
  return name || undefined
}
