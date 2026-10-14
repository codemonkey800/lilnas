// Detects that /login was reached from /oauth2/authorize rather than from
// forward-auth. The provider redirects a session-less authorize to
// `${AUTH_HOST}/login?client_id=…&redirect_uri=…&state=…&exp=…&sig=…`
// (node_modules/@better-auth/oauth-provider/dist/index.mjs); both
// `client_id` and `sig` must be present, so a hand-typed `?client_id=<id>`
// doesn't make the page claim an OIDC sign-in. Next collapses a repeated
// key into string[]; those are treated as absent rather than guessing which
// element was meant. Pure, so the Server Component page can use it freely.
export type OidcPrompt = { clientId: string }

export function detectOidcPrompt(
  searchParams: Record<string, string | string[] | undefined>,
): OidcPrompt | null {
  const { client_id: clientId, sig } = searchParams
  if (typeof clientId !== 'string' || clientId === '') return null
  if (typeof sig !== 'string' || sig === '') return null
  return { clientId }
}
