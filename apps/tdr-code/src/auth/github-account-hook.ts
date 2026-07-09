// GitHub account-link hook (R5-R8) — fail-closed encrypt-and-null-out
// pipeline shared by BOTH `databaseHooks.account.create.before` (first-time
// link) and `databaseHooks.account.update.before` (re-link of an
// already-linked GitHub account). Mirrors guild-gate.ts's extraction
// pattern: plain exported functions, no class, non-DI.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY BOTH HOOK SITES MUST CALL THIS SAME FUNCTION
// ─────────────────────────────────────────────────────────────────────────────
//
// Confirmed by reading the installed better-auth@1.6.23 source directly
// (not assumed from docs): `authClient.linkSocial({ provider: 'github', ... })`
// -> `POST /link-social` only builds the GitHub authorize URL and redirects;
// the actual `account` row write happens later, when the browser lands back
// on `GET /callback/github`. `better-auth/dist/api/routes/callback.mjs`'s
// `callbackOAuth` destructures `link` off `parseState(c)` — present only for
// a linkSocial-originated callback — and, when `link` is truthy, takes a
// SEPARATE branch that never calls `handleOAuthUserInfo` at all:
//
//   const existingAccount = await internalAdapter.findAccountByProviderId(providerAccountId, provider.id)
//   if (existingAccount) {
//     if (existingAccount.userId !== link.userId) redirectOnError(..., 'account_already_linked_to_different_user')
//     const updateData = { accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope }  // NO userId/providerId/accountId
//     await internalAdapter.updateAccount(existingAccount.id, updateData)   // -> account.update.before
//   } else {
//     await internalAdapter.createAccount({ userId: link.userId, providerId, accountId, ...tokens })  // -> account.create.before
//   }
//
// So a first-time link reaches `create.before` with a full `Account` payload
// (providerId/accountId/userId/accessToken all present); a re-link reaches
// `update.before` instead — a COMPLETELY different code path, not gated by
// `account.updateAccountOnSignIn` (that flag only guards the sign-in
// `handleOAuthUserInfo` path, which `linkSocial` never uses). A create-only
// hook would silently miss every re-link and let a fresh plaintext token land
// straight in Better Auth's own `account.accessToken` column — the exact
// outcome this whole unit exists to prevent.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY update.before's PAYLOAD LACKS userId/accountId/providerId (verified
// against source, not assumed — this is the load-bearing deviation from the
// plan's Approach text, which describes both hook sites as if they shared one
// full-Account shape)
// ─────────────────────────────────────────────────────────────────────────────
//
// `better-auth/dist/db/internal-adapter.mjs`: `updateAccount: async (id, data)
// => updateWithHooks(data, [{field: "id", value: id}], "account", void 0)` —
// `id` (the row's own PK) is a SEPARATE positional argument, never merged
// into `data`. `better-auth/dist/db/with-hooks.mjs`'s `updateWithHooks(data,
// where, model, customUpdateFn)` calls `toRun(data, context)` for the
// `update.before` hook — `where` (which carries that `id`) is NEVER passed to
// the hook. Combined with callback.mjs's `updateData` literal above (built
// with no `userId`/`providerId`/`accountId` keys at all for the re-link
// path), the ONLY reliable per-request identity signal at this hook site is
// `context.params.id` — better-call's `EndpointContext.params` for the
// `/callback/:id` route template resolves to `{ id: 'github' }` for this
// exact request (confirmed via `dispatch.mjs`'s `internalContext = {
// ...input, ... }`, which is what flows into `getCurrentAuthContext()` and
// is passed as this hook's second argument — `params` is a sibling of
// `context`, not nested under it, per `GenericEndpointContext = EndpointContext
// & { context: AuthContext }`). There is no reachable path from
// `update.before`'s own two parameters back to `link.userId` (it's a plain
// local variable inside `callbackOAuth`'s closure, never attached to
// `c.context` or otherwise threaded through to a database hook) or to
// `existingAccount.id`/`accountId` (never merged into `updateData` before the
// hook fires). This function therefore resolves `accountId`/`userId` itself
// from the DB (see step 3 below) rather than trusting the hook payload to
// carry them on the update path.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { Account, GenericEndpointContext } from 'better-auth'
import { APIError } from 'better-auth'
import { and, eq, ne } from 'drizzle-orm'

import { encryptKey } from 'src/crypto/key-cipher'
import type { Db } from 'src/db/database.module'
import { upsertGithubCredential } from 'src/db/github-credential.repo'
import { account } from 'src/db/schema'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// GitHub's `GET /user` response shape relevant to this hook — only the
// fields actually used (id/login/name). Deliberately loose (`unknown` at the
// validation boundary, narrowed below) since GitHub's real payload carries
// many more fields this hook never touches.
interface GithubProfile {
  id: number
  login: string
  name: string | null
}

function isValidGithubProfile(body: unknown): body is GithubProfile {
  if (typeof body !== 'object' || body === null) return false
  const candidate = body as Record<string, unknown>
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.login === 'string' &&
    candidate.login.length > 0
  )
}

// Fetches and validates the GitHub profile for the just-exchanged access
// token. Fail-closed: a network failure, non-200, non-JSON body, or a body
// missing a numeric `id`/non-empty `login` all throw the SAME distinct
// APIError — mirrors guild-gate.ts's doLookupGuildMembership's own
// never-partially-trust-the-response posture, just with a throw instead of a
// discriminated-union return (this hook's callers, both Better Auth
// databaseHooks sites, only ever want "succeeded with a profile" or
// "rejected the link" — there's no fail-open branch to fold into, unlike the
// Discord sign-in gate).
//
// AbortSignal.timeout(10_000): same bound and same justification as
// guild-gate.ts's identical guard on its own Discord HTTP call — Node's
// global fetch has no default total-request timeout (only a 300s per-phase
// headersTimeout/bodyTimeout), so an unbounded call here could hang this
// OAuth callback request for minutes if GitHub's API accepts the connection
// and then stalls.
async function fetchGithubProfile(accessToken: string): Promise<GithubProfile> {
  let response: Response
  try {
    response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    getBackendLogger().warn(
      {
        event: LOG_EVENTS.githubProfileFetchFailed,
        errName:
          error instanceof Error
            ? error.name
            : (error as object)?.constructor?.name,
      },
      'GitHub profile fetch failed (network error)',
    )
    throw new APIError('FORBIDDEN', { message: 'github profile fetch failed' })
  }

  if (response.status !== 200) {
    getBackendLogger().warn(
      {
        event: LOG_EVENTS.githubProfileFetchFailed,
        status: response.status,
      },
      'GitHub profile fetch failed (non-200 response)',
    )
    throw new APIError('FORBIDDEN', { message: 'github profile fetch failed' })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    getBackendLogger().warn(
      {
        event: LOG_EVENTS.githubProfileFetchFailed,
        errName:
          error instanceof Error
            ? error.name
            : (error as object)?.constructor?.name,
      },
      'GitHub profile fetch failed (malformed JSON body)',
    )
    throw new APIError('FORBIDDEN', { message: 'github profile fetch failed' })
  }

  if (!isValidGithubProfile(body)) {
    getBackendLogger().warn(
      { event: LOG_EVENTS.githubProfileFetchFailed },
      'GitHub profile fetch failed (unexpected response shape)',
    )
    throw new APIError('FORBIDDEN', { message: 'github profile fetch failed' })
  }

  return body
}

// Pre-flight duplicate-link check (R8-adjacent, see the plan's "pre-flight
// SELECT, not catch" decision): does an `account` row already exist for
// (providerId: 'github', accountId: githubAccountId) belonging to a
// DIFFERENT tdr-code user than `expectedUserId`? If so, this is a genuine
// conflict — the same GitHub account cannot be linked to two tdr-code users
// (mirrors `account_provider_account_unique_idx`'s own enforcement, checked
// here BEFORE any encrypt/upsert work so the hook can throw a friendly,
// APIError-carried message itself instead of letting an uncaught unique-
// constraint violation surface with no reachable catch point in this call
// path — confirmed via document review that `createWithHooks`/
// `updateWithHooks` run this hook and return BEFORE the adapter's actual
// create()/update() call, with no surrounding try/catch in the `linkSocial`
// callback route).
//
// Uses Drizzle's query builder against the imported `account` table (never
// raw SQL), matching every other read in this codebase.
function findConflictingAccountUserId(
  db: Db,
  githubAccountId: string,
  expectedUserId: string,
): string | undefined {
  const row = db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, 'github'),
        eq(account.accountId, githubAccountId),
        ne(account.userId, expectedUserId),
      ),
    )
    .get()
  return row?.userId
}

// Resolves the tdr-code `userId` a re-link's `github_credential` write must
// target, for the `update.before` call site where `account.userId` is not on
// the hook payload (see this file's header comment). By construction, this
// row MUST already exist: `callback.mjs`'s `link` branch only calls
// `internalAdapter.updateAccount` when `findAccountByProviderId` already
// matched an existing `(providerId: 'github', accountId)` row for the SAME
// user — so "no matching row" here is a should-never-happen state (a
// same-request TOCTOU on the account row, or this hook somehow firing outside
// that exact call path), and is treated as fail-closed rather than silently
// falling back to some other user.
function resolveExistingAccountUserId(
  db: Db,
  githubAccountId: string,
): string | undefined {
  const row = db
    .select({ userId: account.userId })
    .from(account)
    .where(
      and(
        eq(account.providerId, 'github'),
        eq(account.accountId, githubAccountId),
      ),
    )
    .get()
  return row?.userId
}

// Runtime-safe read of the `/callback/:id` route's resolved `:id` param off
// the hook's `context` argument — the ONLY reliable per-request "is this
// GitHub" signal available at the `update.before` call site (see this file's
// header comment). `GenericEndpointContext`'s `params` field is typed
// generically (`InferParam<Path>` with no concrete `Path`), so this reads it
// defensively rather than asserting a shape the type system can't itself
// guarantee here.
function contextProviderId(
  context: GenericEndpointContext | null,
): string | undefined {
  const params = (context as { params?: Record<string, unknown> } | null)
    ?.params
  const id = params?.id
  return typeof id === 'string' ? id : undefined
}

// The one function BOTH `databaseHooks.account.create.before` and
// `databaseHooks.account.update.before` call for `providerId === 'github'`
// (see this file's header comment for why one function, not two). Returns
// `undefined` when this isn't a GitHub account event at all (the caller is
// expected to have already narrowed to that case before calling in, but this
// function re-checks defensively since the `update.before` call site cannot
// always tell from `account.providerId` alone).
//
// Steps (R5-R8):
//   1. Resolve `accountId`/`userId` for this event (full payload on create;
//      DB lookup on update — see resolveExistingAccountUserId above).
//   2. Pre-flight duplicate-link check (BEFORE any HTTP call or encryption).
//   3. GitHub profile fetch (fail-closed).
//   4. Derive commit identity (R8) — computable entirely from the public
//      GET /user fields, no `/user/emails` call or `user:email` scope
//      dependency.
//   5. Encrypt the access token and upsert `github_credential`.
//   6. Return `{ data: { accessToken: null, refreshToken: null } }` — the
//      SAME `{ data: {...} }` wrapper shape `create.before` AND
//      `update.before` both expect, confirmed by reading
//      `better-auth/dist/db/with-hooks.mjs`'s `createWithHooks` AND
//      `updateWithHooks` directly: both apply the identical merge, `if
//      (typeof result === "object" && "data" in result) actualData = {
//      ...actualData, ...result.data }`. This MERGES onto the original
//      payload (never replacing it), so every other field the adapter's
//      create()/update() call still needs (providerId, scope, ...) survives
//      unchanged; only accessToken/refreshToken are overwritten to null —
//      the same technique the existing Discord create.before branch already
//      uses for its own token-nulling.
export async function handleGithubAccountUpsert(
  account: Partial<Account> & Record<string, unknown>,
  context: GenericEndpointContext | null,
  db: Db,
  getMasterKey: () => Buffer,
): Promise<{ data: Partial<Account> } | undefined> {
  const isGithubEvent =
    account.providerId === 'github' || contextProviderId(context) === 'github'
  if (!isGithubEvent) return undefined

  // Deferred to here (past the no-op early-return above) so a NON-GitHub
  // account event (every Discord create/update, which reaches this
  // function's call sites unconditionally — see auth.ts's own comment on
  // why) never pays for loadMasterKey()'s file-stat/read/permission checks
  // at all. This was a real, caught-in-testing bug: an earlier version
  // called getMasterKey() as an EAGER argument expression at the call site
  // in auth.ts (`handleGithubAccountUpsert(account, context, db,
  // getMasterKey())`), which — because JavaScript evaluates arguments
  // before a function body ever runs — threw on EVERY Discord sign-in in
  // any environment without TDR_CODE_MASTER_KEY_FILE set (e.g.
  // guild-gate.spec.ts), long before this function's own isGithubEvent
  // check could ever short-circuit it. Accepting a thunk here instead
  // keeps the master-key file access scoped to genuine GitHub events only.
  const masterKey = getMasterKey()

  if (!account.accessToken) {
    // Fail-closed, mirroring guild-gate.ts's identical posture for a missing
    // Discord token: no token means no way to fetch a profile or prove this
    // is a real GitHub account, so there is nothing safe to do but reject.
    throw new APIError('FORBIDDEN', { message: 'github profile fetch failed' })
  }
  const accessToken = account.accessToken

  // accountId/userId resolution — full payload on create.before (both
  // present), DB lookup on update.before (see header comment for why the
  // payload alone cannot answer this on the re-link path).
  let githubAccountId: string
  let userId: string
  if (account.accountId && account.userId) {
    githubAccountId = account.accountId
    userId = account.userId
  } else {
    // update.before path: fetch the profile FIRST (this is the one
    // documented, deliberate deviation from "pre-flight check before any
    // HTTP call" — see below), since accountId isn't known until GitHub's
    // own numeric id is resolved.
    const profile = await fetchGithubProfile(accessToken)
    githubAccountId = String(profile.id)
    const resolvedUserId = resolveExistingAccountUserId(db, githubAccountId)
    if (!resolvedUserId) {
      // Should-never-happen per this function's own contract (see
      // resolveExistingAccountUserId's header comment) — fail closed rather
      // than guessing a target user.
      throw new APIError('FORBIDDEN', {
        message: 'github profile fetch failed',
      })
    }
    userId = resolvedUserId

    // Pre-flight duplicate check, deferred to here (after the one HTTP call
    // this branch already needed to resolve githubAccountId) rather than
    // strictly before any HTTP call — the brief's ordering assumes accountId
    // is already known, which only holds on the create path. Still runs
    // BEFORE any encryption/upsert work, preserving the actual invariant
    // that matters: no partial credential state is written before this
    // check passes.
    const conflictingUserId = findConflictingAccountUserId(
      db,
      githubAccountId,
      userId,
    )
    if (conflictingUserId) {
      getBackendLogger().warn(
        {
          event: LOG_EVENTS.githubAccountAlreadyLinked,
          conflictingUserId,
        },
        'GitHub account already linked to a different tdr-code user',
      )
      throw new APIError('FORBIDDEN', {
        message: 'github account already linked',
      })
    }

    return finishGithubAccountUpsert({
      db,
      masterKey,
      userId,
      githubAccountId,
      accessToken,
      profile,
      scope: typeof account.scope === 'string' ? account.scope : '',
    })
  }

  // create.before path: accountId/userId are both already known from the
  // full payload, so the pre-flight duplicate check runs BEFORE any HTTP
  // call or encryption work, exactly as the plan's Key Technical Decisions
  // section specifies — side-effect-free up to this point.
  const conflictingUserId = findConflictingAccountUserId(
    db,
    githubAccountId,
    userId,
  )
  if (conflictingUserId) {
    getBackendLogger().warn(
      {
        event: LOG_EVENTS.githubAccountAlreadyLinked,
        conflictingUserId,
      },
      'GitHub account already linked to a different tdr-code user',
    )
    throw new APIError('FORBIDDEN', {
      message: 'github account already linked',
    })
  }

  const profile = await fetchGithubProfile(accessToken)

  // Defense-in-depth: the profile's own numeric id must match the
  // provider-reported accountId Better Auth already exchanged. A mismatch
  // here would mean the access token's true owner differs from the identity
  // Better Auth resolved before this hook ran — never expected in practice,
  // but treated as fail-closed rather than silently trusting whichever id
  // happens to be on the payload.
  if (String(profile.id) !== githubAccountId) {
    throw new APIError('FORBIDDEN', { message: 'github profile fetch failed' })
  }

  return finishGithubAccountUpsert({
    db,
    masterKey,
    userId,
    githubAccountId,
    accessToken,
    profile,
    scope: typeof account.scope === 'string' ? account.scope : '',
  })
}

// Shared tail: derive identity (R8), encrypt (R7), upsert, and return the
// token-nulling merge patch. Extracted so both the create.before and
// update.before code paths above (which resolve accountId/userId/profile
// differently) converge on one implementation of the actual write.
function finishGithubAccountUpsert(input: {
  db: Db
  masterKey: Buffer
  userId: string
  githubAccountId: string
  accessToken: string
  profile: GithubProfile
  scope: string
}): { data: Partial<Account> } {
  const {
    db,
    masterKey,
    userId,
    githubAccountId,
    accessToken,
    profile,
    scope,
  } = input

  // R8: auto-derived commit identity. No `/user/emails` call and no
  // `user:email` scope dependency — both fields are computable entirely from
  // the public GET /user response.
  const derivedName = profile.name ?? profile.login
  const derivedEmail = `${profile.id}+${profile.login}@users.noreply.github.com`

  // AAD must exactly match github-token-resolution.ts's decrypt-side AAD:
  // `${userId}:github` — provider-scoped (unlike git_identity's plain
  // discordUserId AAD), confirmed against that module's own header comment.
  const encrypted = encryptKey(
    Buffer.from(accessToken, 'utf8'),
    `${userId}:github`,
    masterKey,
  )

  upsertGithubCredential(db, {
    userId,
    githubUserId: githubAccountId,
    githubLogin: profile.login,
    derivedName,
    derivedEmail,
    tokenCiphertext: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    scope,
  })

  // Merges onto the original payload per createWithHooks/updateWithHooks'
  // own merge semantics (see this file's header comment on the return
  // shape) — Better Auth's own `account` row for this event never carries a
  // plaintext token, on either the first link or a re-link.
  return { data: { accessToken: null, refreshToken: null } }
}
