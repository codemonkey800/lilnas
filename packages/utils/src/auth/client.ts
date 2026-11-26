import {
  AdminCheckResponse,
  DiscordLinkLookupParams,
  DiscordLinkLookupResponse,
} from './types'

/** `typeof null === 'object'`, so this accepts a plain object or `null`. */
function isObjectOrNull(value: unknown): boolean {
  return (typeof value === 'object' && !Array.isArray(value)) || value === null
}

function discordLinkQuery(params: DiscordLinkLookupParams): string {
  if ('discordUserId' in params) {
    return `discordUserId=${encodeURIComponent(params.discordUserId)}`
  }

  if ('userId' in params) {
    return `userId=${encodeURIComponent(params.userId)}`
  }

  return `email=${encodeURIComponent(params.email)}`
}

/** The `Authorization` value for a token, or `undefined` when it is blank. */
function bearerFor(token: string | undefined): string | undefined {
  const trimmed = token?.trim()
  return trimmed ? `Bearer ${trimmed}` : undefined
}

/** Reads `AUTH_INTERNAL_TOKEN` when called (per instance), never at import. */
function envToken(): string | undefined {
  return typeof process === 'undefined'
    ? undefined
    : process.env.AUTH_INTERNAL_TOKEN
}

// Client for auth's container-internal routes (GET /admin/check,
// GET /internal/discord-link, POST /internal/discord-identity) on the Nest
// backend, port 8081. Port 8081 has no Traefik router: it is reached only
// container-to-container, the same way Traefik's own
// forwardauth.address=http://auth:8081/verify does. auth.lilnas.io routes to
// the Next.js frontend on 8080 instead, so there is deliberately no
// remoteInstance (mirroring packages/utils/src/download/client.ts).
//
// These routes are not open to the whole network: auth authorizes each caller
// by a per-caller bearer token with scopes. The client sends
// `Authorization: Bearer <token>` from the constructor argument, or
// AUTH_INTERNAL_TOKEN when none is given. With no non-blank token it sends no
// Authorization header, which only works while auth is not enforcing tokens
// (e.g. a dev stack). A 401/403 surfaces as the usual "failed with <status>"
// error; the token never appears in an error, a log or a URL.
export class AuthClient {
  // A private field so the token stays out of util.inspect / console.log
  // output of the client.
  readonly #authorization: string | undefined

  constructor(
    private baseUrl = 'http://localhost:8081',
    token: string | undefined = envToken(),
  ) {
    this.#authorization = bearerFor(token)
  }

  static get localInstance() {
    return new AuthClient()
  }

  static get dockerInstance() {
    return new AuthClient('http://auth:8081')
  }

  private request(url: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${url}`, {
      signal: AbortSignal.timeout(2_000),
      ...options,

      headers: {
        'Content-Type': 'application/json',
        ...(this.#authorization ? { Authorization: this.#authorization } : {}),
        ...options.headers,
      },
    })
  }

  async checkIsAdmin(email: string): Promise<AdminCheckResponse> {
    const response = await this.request(
      `/admin/check?email=${encodeURIComponent(email)}`,
    )

    if (!response.ok) {
      throw new Error(
        `GET /admin/check failed with ${response.status} ${response.statusText}`,
      )
    }

    const body: unknown = await response.json()
    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { isAdmin?: unknown }).isAdmin !== 'boolean'
    ) {
      throw new Error('GET /admin/check returned an unexpected body shape')
    }

    return body as AdminCheckResponse
  }

  /**
   * Looks a Discord link up by exactly one of its keys. Always a 200 when auth
   * answers at all: an unseen snowflake comes back as `{ identity: null, user:
   * null }` rather than a 404, so a caller can tell a genuine "not linked"
   * apart from an auth deploy that predates this route. Throws on a non-ok
   * status, a timeout, or a body that is not the two-part envelope - callers
   * that want to fail open catch and degrade to "unlinked".
   */
  async getDiscordLink(
    params: DiscordLinkLookupParams,
  ): Promise<DiscordLinkLookupResponse> {
    const response = await this.request(
      `/internal/discord-link?${discordLinkQuery(params)}`,
    )

    if (!response.ok) {
      throw new Error(
        `GET /internal/discord-link failed with ${response.status} ${response.statusText}`,
      )
    }

    const body: unknown = await response.json()
    if (
      typeof body !== 'object' ||
      body === null ||
      !isObjectOrNull((body as { identity?: unknown }).identity) ||
      !isObjectOrNull((body as { user?: unknown }).user)
    ) {
      throw new Error(
        'GET /internal/discord-link returned an unexpected body shape',
      )
    }

    return body as DiscordLinkLookupResponse
  }

  /**
   * Records the Discord account behind a snowflake so auth can render it (and
   * offer it for linking) before any link exists. Upsert semantics on auth's
   * side; the response body is ignored. Throws on a non-ok status or a
   * timeout - callers that treat registration as best-effort swallow it.
   */
  async registerDiscordIdentity(identity: {
    discordUserId: string
    username: string
    displayName?: string | null
  }): Promise<void> {
    const response = await this.request('/internal/discord-identity', {
      method: 'POST',
      body: JSON.stringify(identity),
    })

    if (!response.ok) {
      throw new Error(
        `POST /internal/discord-identity failed with ${response.status} ${response.statusText}`,
      )
    }
  }
}
