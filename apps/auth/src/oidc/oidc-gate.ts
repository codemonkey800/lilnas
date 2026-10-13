import type {
  HostAccessDecision,
  VerifyService,
} from 'src/verify/verify.service'

import { hostForOidcClient } from './clients'

export type OidcGateResult =
  | HostAccessDecision
  // Fail closed: the gate could not reach a decision (unknown client, or the
  // VerifyService is not resolvable). `reason` is for the log only — it is
  // never shown to the relying party.
  | { outcome: 'deny'; reason: string }

// Decides whether `session` may complete the OIDC flow for `clientId`, by
// asking VerifyService.authorizeHost() — the very method /verify runs after
// it has a session — about the client's lilnas host. "May sign in to Penpot"
// is therefore exactly "may reach penpot.lilnas.io through forward-auth":
// blocked, admin bypass, grant (literal or `*.suffix` pattern),
// pre-authorization bind, else pending, all with one implementation.
//
// `originalUrl` is `https://<host>/`: the pending/blocked pages only read the
// hostname out of `?redirect=` (see VerifyService.buildRedirectUrl).
//
// The service is injected as a thunk, resolved per call, because it cannot
// be a constructor dependency of buildAuth()'s factory — see
// auth.module.ts for the AuthModule <-> AccessCacheService cycle.
export function decideOidcAccess(
  resolveVerifyService: () => VerifyService | undefined,
  clientId: string,
  session: { userId: string; email: string },
): OidcGateResult {
  const host = hostForOidcClient(clientId)
  if (!host) {
    return { outcome: 'deny', reason: `unknown OIDC client "${clientId}"` }
  }
  const verifyService = resolveVerifyService()
  if (!verifyService) {
    return { outcome: 'deny', reason: 'VerifyService is not resolvable' }
  }
  return verifyService.authorizeHost(session, host, `https://${host}/`)
}

// Same decision for callers that already hold the client's host (the id
// token claims callback gets the client's stored metadata, not its id).
export function decideOidcAccessForHost(
  resolveVerifyService: () => VerifyService | undefined,
  host: string | undefined,
  session: { userId: string; email: string },
): OidcGateResult {
  if (!host) {
    return { outcome: 'deny', reason: 'client has no lilnasHost metadata' }
  }
  const verifyService = resolveVerifyService()
  if (!verifyService) {
    return { outcome: 'deny', reason: 'VerifyService is not resolvable' }
  }
  return verifyService.authorizeHost(session, host, `https://${host}/`)
}
