import { DownloadApiError } from '@lilnas/utils/download/client'
import { getErrorMessage } from '@lilnas/utils/error'

/**
 * Why a `DownloadClient` call failed, in words a reply can carry.
 *
 * A `DownloadApiError`'s own message is only the status line ("Download API
 * request failed with 400 Bad Request"); the reason is in Nest's
 * `{ statusCode, message, error }` body, whose `message` is a string or a
 * list of validation messages - so that wins when there is one. Anything
 * else (a non-JSON 502, the app being unreachable) falls back to the error's
 * own message.
 */
export function downloadApiErrorMessage(error: unknown): string {
  if (error instanceof DownloadApiError) {
    const reason = serverMessage(error.body)
    if (reason) return reason
  }

  return getErrorMessage(error)
}

function serverMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return undefined
  }

  const { message } = body

  if (typeof message === 'string') {
    return message.trim() || undefined
  }

  if (Array.isArray(message)) {
    const parts = message.filter(
      (part): part is string => typeof part === 'string' && part.trim() !== '',
    )
    return parts.length > 0 ? parts.join('; ') : undefined
  }

  return undefined
}
