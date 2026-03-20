export class LidarrApiError extends Error {
  readonly status: number
  readonly statusText: string

  constructor(status: number, statusText: string, message?: string) {
    super(message ?? `Lidarr API error: ${status} ${statusText}`)
    this.name = 'LidarrApiError'
    this.status = status
    this.statusText = statusText
  }

  static async fromResponse(res: Response): Promise<LidarrApiError> {
    let message: string | undefined
    try {
      const body = (await res.json()) as Record<string, unknown>
      if (typeof body['message'] === 'string') {
        message = body['message']
      } else if (typeof body['error'] === 'string') {
        message = body['error']
      }
    } catch {
      // fall through with no message
    }
    return new LidarrApiError(res.status, res.statusText, message)
  }
}
