/**
 * Error thrown when a media API (Radarr/Sonarr) returns a non-2xx response.
 *
 * Shaped to be compatible with ErrorClassificationService.classifyMediaApiError(),
 * which reads `response.status` and `response.headers` for classification.
 */
export class MediaApiError extends Error {
  readonly response: { status: number; headers?: Headers }

  constructor(status: number, body: unknown, headers?: Headers) {
    super(typeof body === 'string' ? body : JSON.stringify(body))
    this.name = 'MediaApiError'
    this.response = { status, headers }
  }
}
