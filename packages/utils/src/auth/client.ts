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

// Mirrors packages/utils/src/download/client.ts's local/docker shape,
// including its lack of a remoteInstance — that started here as a deliberate
// deviation, and DownloadClient has since dropped its own broken one for the
// same reason. auth.lilnas.io (deploy.yml) routes to port 8080 (the Next.js
// frontend) — a completely different process from the Nest backend on 8081
// that GET /admin/check lives on.
// Port 8081 has no Traefik router at all (confirmed: it's reached only
// container-to-container, the same mechanism Traefik's own
// forwardauth.address=http://auth:8081/verify uses). A remoteInstance
// pointed at https://auth.lilnas.io/admin/check would hit the wrong
// process and likely 404 — omitted rather than shipped broken.
export class AuthClient {
  constructor(private baseUrl = 'http://localhost:8081') {}

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
