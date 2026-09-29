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
 * The error `checkSdkError`/`unwrapSdkResult` throw when an SDK call came
 * back with an error. The message is the same human-readable one as before;
 * the extra fields let a caller branch on what actually happened instead of
 * matching on the text:
 *
 * - `status`: the HTTP status of the response (404, 409, 500, ...), or
 *   `undefined` when there was no response at all - a network failure, or a
 *   client-side error thrown before the request left.
 * - `body`: the SDK's `error` as-is, usually the parsed JSON body
 *   Radarr/Sonarr sent back (validation failures, `{ message }`, ...).
 */
export class SdkHttpError extends Error {
  readonly status: number | undefined
  readonly body: unknown

  constructor(message: string, status: number | undefined, body: unknown) {
    super(message)
    this.name = 'SdkHttpError'
    this.status = status
    this.body = body
    // Keeps `instanceof` working even if this is ever compiled down to an
    // ES5 target, where extending a built-in loses the prototype chain.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/**
 * Throws a descriptive `SdkHttpError` if the SDK call returned one;
 * otherwise no-ops. Use for calls whose response body isn't needed
 * (deletes, commands).
 */
export function checkSdkError(result: SdkResult<unknown>, context: string) {
  if (result.error != null) {
    throw new SdkHttpError(
      `${context} failed: ${describeSdkError(result.error)}`,
      result.response?.status,
      result.error,
    )
  }
}

/**
 * Throws a descriptive `SdkHttpError` if the SDK call returned one, or if it
 * returned no data at all; otherwise returns the unwrapped data.
 */
export function unwrapSdkResult<T>(result: SdkResult<T>, context: string): T {
  checkSdkError(result, context)

  if (result.data === undefined) {
    throw new SdkHttpError(
      `${context} returned no data`,
      result.response?.status,
      undefined,
    )
  }

  return result.data
}

/**
 * `true` for the 400 Radarr/Sonarr answer an add with when the title is
 * already in the library - their `MovieExistsValidator`/`SeriesExistsValidator`
 * failure, "This movie/series has already been added". Seen when two adds
 * race (another process, or Radarr's own list import, got there between the
 * library read and the POST), and the right response is to re-read the
 * library and carry on, not to fail.
 *
 * Matched on the status plus the text, in the body or the message: the body
 * is a validation-failure array whose exact shape differs between versions,
 * and any other 400 (a bad root folder, a missing profile) is a real error.
 */
export function isAlreadyAddedError(error: unknown): boolean {
  if (!(error instanceof SdkHttpError) || error.status !== 400) {
    return false
  }

  const pattern = /already been added/i
  if (pattern.test(error.message)) {
    return true
  }

  try {
    return pattern.test(JSON.stringify(error.body) ?? '')
  } catch {
    return false
  }
}
