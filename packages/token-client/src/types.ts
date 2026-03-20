export interface TokenClientOptions {
  /** Base URL of the token service, e.g. 'https://token.lilnas.io' */
  baseUrl: string
}

export interface ValidateTokenRequest {
  appSlug: string
  value: string
}

export interface ValidateTokenResponse {
  valid: boolean
}
