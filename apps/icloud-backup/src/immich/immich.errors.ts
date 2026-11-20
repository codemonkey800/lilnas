export type ImmichErrorCode =
  // Provisioning refused a folder or path.
  | 'import_path_taken'
  | 'import_path_invalid'
  // Transport and protocol failures talking to Immich.
  | 'not_configured'
  | 'http_error'
  | 'timeout'
  | 'network'
  | 'bad_response'

/**
 * Anything that goes wrong talking to Immich. The message carries the verb,
 * path, status and Immich's own `message`, never a request body, a header or
 * the API key, so it is safe to log and to store.
 */
export class ImmichError extends Error {
  constructor(
    readonly code: ImmichErrorCode,
    message: string = code,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ImmichError'
  }
}
