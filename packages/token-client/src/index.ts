export type {
  TokenClientOptions,
  ValidateTokenRequest,
  ValidateTokenResponse,
} from './types'

import type {
  TokenClientOptions,
  ValidateTokenRequest,
  ValidateTokenResponse,
} from './types'

/**
 * Client for validating API tokens against the Token service's public API.
 *
 * Usage:
 * ```ts
 * const client = new TokenClient({ baseUrl: 'https://token.lilnas.io' })
 * const isValid = await client.validate('my-app', tokenValue)
 * ```
 */
export class TokenClient {
  private readonly baseUrl: string

  constructor(options: TokenClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
  }

  /**
   * Validates an API token for a given application.
   *
   * @param appSlug - The slug of the application (directory name in apps/)
   * @param value - The full token value to validate
   * @returns `true` if the token is valid, `false` otherwise
   */
  async validate(appSlug: string, value: string): Promise<boolean> {
    const body: ValidateTokenRequest = { appSlug, value }

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}/public/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      return false
    }

    if (!res.ok) return false

    const data = (await res.json()) as ValidateTokenResponse
    return data.valid === true
  }
}
