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

// No clients are registered right now. To add one: list it here, put its
// plaintext secret in apps/auth/.env.prod (and .env.example) under
// `secretEnvKey`, and add the host to src/app/service-meta.ts. OidcClientsService
// seeds it on the next boot and deletes any stored client not listed here.
export const OIDC_CLIENTS: readonly OidcClientDefinition[] = []

export function findOidcClient(
  clientId: string,
): OidcClientDefinition | undefined {
  return OIDC_CLIENTS.find(c => c.clientId === clientId)
}

export function hostForOidcClient(clientId: string): string | undefined {
  return findOidcClient(clientId)?.host
}
