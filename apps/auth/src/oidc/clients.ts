// The OIDC clients lilnas-auth serves. Pure data, no I/O, so Next server
// components (e.g. the login page naming the app being signed into) can
// import it as freely as the Nest side. `host` is the key /verify uses for
// grants: signing in to a client requires the user to be granted that host,
// exactly like visiting it behind forward-auth. Hosts are written in the
// already-normalized lowercase form src/services/normalize-host.ts produces.
export type OidcClientDefinition = {
  clientId: string
  // Shown on the login page.
  name: string
  host: string
  redirectUris: string[]
  // Name of the env var holding the PLAINTEXT secret; only its hash is
  // stored. Read at boot by OidcClientsService, which throws if it is unset.
  secretEnvKey: string
}

// To add a client: list it here, put its plaintext secret in
// apps/auth/.env.prod (and .env.example) under `secretEnvKey`, and add the
// host to src/app/service-meta.ts. OidcClientsService seeds it on the next
// boot and deletes any stored client not listed here.
export const OIDC_CLIENTS: readonly OidcClientDefinition[] = [
  {
    clientId: 'immich',
    name: 'Immich',
    host: 'immich.lilnas.io',
    redirectUris: [
      // The web app sends the page it started on: /auth/login to sign in,
      // /user-settings to link an existing account.
      'https://immich.lilnas.io/auth/login',
      'https://immich.lilnas.io/user-settings',
      // The mobile app's app.immich:///oauth-callback, rewritten by Immich's
      // "mobile redirect URI override" (must be enabled in its OAuth settings).
      'https://immich.lilnas.io/api/oauth/mobile-redirect',
    ],
    secretEnvKey: 'OIDC_IMMICH_CLIENT_SECRET',
  },
]

export function findOidcClient(
  clientId: string,
): OidcClientDefinition | undefined {
  return OIDC_CLIENTS.find(c => c.clientId === clientId)
}

export function hostForOidcClient(clientId: string): string | undefined {
  return findOidcClient(clientId)?.host
}
