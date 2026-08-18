import { AdminCheckResponse } from './types'

// Mirrors packages/utils/src/download/client.ts's local/docker shape, with
// ONE deliberate deviation: no remoteInstance. auth.lilnas.io (deploy.yml)
// routes to port 8080 (the Next.js frontend) — a completely different
// process from the Nest backend on 8081 that GET /admin/check lives on.
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
    return response.json()
  }
}
