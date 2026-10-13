import type { EnvKeys } from 'src/env'

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
  // Env var holding the PLAINTEXT secret; only its hash is stored.
  secretEnvKey: keyof typeof EnvKeys
}

export const OIDC_CLIENTS: readonly OidcClientDefinition[] = [
  {
    clientId: 'penpot',
    name: 'Penpot',
    host: 'penpot.lilnas.io',
    // Penpot 2.18.3 backend/src/app/auth/oidc.clj fixes the callback here.
    redirectUris: ['https://penpot.lilnas.io/api/auth/oidc/callback'],
    secretEnvKey: 'OIDC_PENPOT_CLIENT_SECRET',
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
