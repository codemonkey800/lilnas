/**
 * Shape shared by every generated @lilnas/media SDK call: `{ data, error,
 * response }`. Radarr and Sonarr each generate their own nominal types with
 * this same structure, so a single structural helper covers both clients
 * without pulling in tdr-bot's RetryService/circuit-breaker apparatus.
 */
export interface SdkResult<T> {
  data?: T
  error?: unknown
  response?: Response
}

function describeSdkError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Throws a descriptive error if the SDK call returned one; otherwise no-ops.
 * Use for calls whose response body isn't needed (deletes, commands).
 */
export function checkSdkError(result: SdkResult<unknown>, context: string) {
  if (result.error != null) {
    throw new Error(`${context} failed: ${describeSdkError(result.error)}`)
  }
}

/**
 * Throws a descriptive error if the SDK call returned one, or if it returned
 * no data at all; otherwise returns the unwrapped data.
 */
export function unwrapSdkResult<T>(result: SdkResult<T>, context: string): T {
  checkSdkError(result, context)

  if (result.data === undefined) {
    throw new Error(`${context} returned no data`)
  }

  return result.data
}
