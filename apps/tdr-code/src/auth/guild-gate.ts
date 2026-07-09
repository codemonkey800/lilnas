// Guild-membership gate (R18, AE5) — fail-closed sign-in restriction to
// members of `DISCORD_GUILD_ID`.
//
// ─────────────────────────────────────────────────────────────────────────────
// SEAM DECISION (Option B): why `hooks.before` (Option A) is impossible here
// ─────────────────────────────────────────────────────────────────────────────
//
// The plan's decision matrix asks one precise question: is the Discord
// access token (and the identity it unlocks) available at a request-level
// `hooks.before` seam, or does using that seam require re-implementing
// Discord's own code→token exchange? The answer, read directly from the
// installed `better-auth@1.6.23` source (not assumed from docs), is that
// `hooks.before` fires BEFORE Better Auth's own callback handler runs at
// all — so the token/identity do not exist yet at that seam. Option A is not
// merely costly, it is structurally impossible without a second, drift-prone
// OAuth exchange. Full trace:
//
// 1. `betterAuth/dist/api/dispatch.mjs` (`dispatchAuthEndpoint`, the ONE
//    place `hooks.before`/`hooks.after` are invoked for every route,
//    confirmed by grepping the full `dist` tree for `runBeforeHooks`/
//    `hooks?.before` — there is no other call site):
//      L205  runWithEndpointContext(internalContext, async () => {
//      L206    const { beforeHooks, afterHooks } = getHooks(...)
//      L207    const before = await runBeforeHooks(internalContext, beforeHooks, ...)
//      ...
//      L228    const result = await runWithEndpointContext(internalContext, () =>
//      L228-231  ... () => endpoint(internalContext)) ...
//    `runBeforeHooks` (L207) resolves and is fully handled (L208-224) BEFORE
//    `endpoint(internalContext)` — the actual route handler closure — is
//    ever invoked (L228-231). `hooks.before` is dispatch-layer middleware
//    that wraps the endpoint call; it cannot run "during" or "after" any
//    part of the endpoint's own body, only strictly before it starts.
//
// 2. `betterAuth/dist/api/dispatch.mjs` `getHooks()` (L135-146): a configured
//    `options.hooks.before` is wrapped as `{ matcher: () => true, handler:
//    beforeHookHandler }` — i.e. Better Auth itself does not scope
//    `hooks.before` to a route; any per-route filtering would have to be
//    self-implemented by inspecting `ctx.path` inside the handler, which
//    changes nothing about WHEN it fires relative to the callback body.
//
// 3. `betterAuth/dist/api/routes/callback.mjs` (`callbackOAuth`, the actual
//    `/callback/:id` endpoint that `dispatchAuthEndpoint` invokes as
//    `endpoint(internalContext)` at dispatch.mjs L228-231):
//      L68  tokens = await provider.validateAuthorizationCode({ code, ... })
//      L80  const userInfo = await provider.getUserInfo({ ...tokens, ... })
//    `tokens` and `userInfo` are LOCAL VARIABLES declared inside this
//    closure — the code→token exchange (L68) and the Discord profile fetch
//    (L80) both happen inside the endpoint body, i.e. strictly after
//    `hooks.before` has already returned control back to
//    `dispatchAuthEndpoint`. Neither value is ever assigned onto
//    `c.context` (the object `hooks.before` actually receives) — there is no
//    field on `internalContext`/`c.context` a `hooks.before` handler could
//    read to reach them. This is not an oversight to route around; it is the
//    literal reason the identity exists at all (the exchange is what
//    *produces* it) — matching the plan's third, mandatory-B outcome
//    ("the code→token exchange is what produces the identity").
//
// Conclusion: Option A would require a hand-rolled second call to Discord's
// `POST /api/oauth2/token` inside `hooks.before`, using the OAuth `code` off
// the query string — a second, independent implementation of exactly what
// `callbackOAuth` already does at L68, with its own bugs, its own state/PKCE
// handling, and a second place to drift from the library's behavior on any
// future better-auth upgrade. The plan explicitly rejects this
// ("a drift-prone second code path"). Per the pre-committed inversion rule,
// this is the "A is impossible" branch, not merely "A is costly" — so
// Option B is mandatory, not preferred.
//
// ─────────────────────────────────────────────────────────────────────────────
// SEAM DECISION (Option B): confirming the token IS available where we hook
// ─────────────────────────────────────────────────────────────────────────────
//
// `databaseHooks.account.create.before` is invoked from
// `betterAuth/dist/db/with-hooks.mjs` (`createWithHooks`, L6-22):
//      L8   let actualData = data
//      L9   for (const { source, hooks } of hooksEntries) {
//      L10    const toRun = hooks[model]?.create?.before
//      ...
//      L16    ... () => toRun(actualData, context)) ...
// — i.e. the hook receives exactly the `data` argument the CALLER passed to
// `createWithHooks(data, model, ...)`. For the `"account"` model, that caller
// is `createOAuthUser` in `betterAuth/dist/db/internal-adapter.mjs` (L59-77):
//      L61  const createdUser = await createWithHooks({ ... }, "user", ...)
//      L69  account: await createWithHooks({ ...account, userId:
//      L69    createdUser.id, ... }, "account", ...)
// and `account` there is the `accountData` object built in
// `@better-auth/core/dist/oauth2/link-account.mjs` (`handleOAuthUserInfo`,
// the sign-up branch, L84-97):
//      L88    accessToken: await setTokenUtil(account.accessToken, c.context),
//      L89    refreshToken: await setTokenUtil(account.refreshToken, c.context),
//      ...
//      L97    const { user: createdUser, account: createdAccount } =
//      L97      await c.context.internalAdapter.createOAuthUser({ ... },
//      L97      accountData)
// So by the time `databaseHooks.account.create.before` runs, `actualData`
// genuinely carries the just-exchanged Discord `accessToken` (confirmed:
// `link-account.mjs` L88 runs strictly before `internal-adapter.mjs` L69
// calls into `createWithHooks` at all) — this is the seam `isGuildMember`'s
// caller (auth.ts) uses to make the real Discord guild-membership HTTP call.
//
// IMPORTANT CAVEAT (the plan's "⚠ accountless `user` may persist"): note
// `internal-adapter.mjs` L61 (`createWithHooks({...}, "user", ...)`) already
// ran and its INSERT already committed before L69's `createWithHooks(...,
// "account", ...)` is even called — so by the time our hook can reject the
// account row via `return false` (with-hooks.mjs L17: `if (result === false)
// return null`), the `user` row already exists. This is exactly why U3 also
// ships the orphan sweep (`auth-sweep.repo.ts`) and relies on U1's partial
// unique index as paired defense — "zero rows" under Option B means "no
// USABLE (accountless) rows survive", not "the INSERT never happened."
//
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// Non-DI (plain exported functions, no class) — uses getBackendLogger()
// (src/logging/backend-logger.ts), fetched AT LOG TIME inside the function
// body below, never at module-eval time.

// The three Discord guild-member-lookup outcomes `isGuildMember` must
// distinguish. `ok: true` carries the raw fetch Response's status only
// because the predicate needs no more than that — Discord's 200 response
// body (nickname, roles, joined_at, ...) is irrelevant to a yes/no gate and
// is deliberately never parsed or retained (no reason to touch a member's
// role list for a flat-admin model).
export type MemberLookupResult =
  | { ok: true; status: 200 }
  | { ok: false; status: number }
  | { ok: false; status: 'network_error' }
  | { ok: false; status: 'malformed_body' }

// Pure predicate — the SINGLE source of truth for "is this a member" so the
// production seam (auth.ts's databaseHooks.account.create.before) and any
// test call the exact same rule (avoids the two-paths-diverge failure mode
// the plan's FSM-adjacent learnings warn about). Fail-closed: every branch
// other than a live HTTP 200 is `false`, including 5xx, timeouts, and
// malformed bodies — never "allow" on ambiguity.
export function isGuildMember(result: MemberLookupResult): boolean {
  return result.ok && result.status === 200
}

// Discord's "Get Guild Member" endpoint, called with the DISCORD OAUTH
// ACCESS TOKEN just obtained for the signing-in user (Bearer auth) — NOT the
// bot token (`DISCORD_API_TOKEN`). This is the `guilds.members.read` scope
// U2 already added to the Discord provider's `scope` array; without it this
// call 403s for every caller, member or not.
//
// Deliberately returns a `MemberLookupResult`, never throws — every failure
// mode (non-200, network error, timeout, malformed JSON) is folded into the
// discriminated union so `isGuildMember` never has to special-case "the
// fetch itself blew up" differently from "Discord said no." A caller that
// forgets to catch is not a way for this to accidentally fail open.
async function doLookupGuildMembership(
  accessToken: string,
): Promise<MemberLookupResult> {
  const guildId = env(EnvKeys.DISCORD_GUILD_ID)

  let response: Response
  try {
    response = await fetch(
      `https://discord.com/api/users/@me/guilds/${guildId}/member`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        // Node's global fetch (undici) has NO default total-request
        // timeout — only a per-phase `headersTimeout`/`bodyTimeout`, each
        // defaulting to 300_000ms, and a separate ~10s `connectTimeout`
        // that covers connection setup only (a prior version of this
        // comment claimed "undici's own request timeout throws", which is
        // false). A Discord endpoint that accepts the TCP connection and
        // then stalls — a realistic degraded-upstream mode, exactly what
        // this fail-closed gate exists to survive — would otherwise hang
        // this OAuth callback request for up to ~5 minutes. Bounding it
        // explicitly matches the same silently-hangs-forever hardening
        // this app applies elsewhere (session-manager's
        // LOAD_SESSION_TIMEOUT_MS, discord-handler's
        // THREAD_RENAME_TIMEOUT_MS). The resulting AbortError is caught
        // below like any other network failure — fail-closed still holds,
        // just bounded to seconds instead of minutes.
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch {
    // Network error, DNS failure, a timed-out AbortSignal above, TLS
    // failure, etc. — all fold into the same fail-closed "not a member"
    // outcome. Treated identically to a non-200, never as "allow" (the
    // plan's explicit fail-closed invariant for Discord being unreachable
    // at sign-in).
    return { ok: false, status: 'network_error' }
  }

  if (response.status !== 200) {
    return { ok: false, status: response.status }
  }

  // A 200 with a body that isn't valid JSON (or isn't an object at all) is
  // exactly as untrustworthy as a non-200 — Discord returning malformed
  // JSON is not evidence of membership, so this folds into fail-closed too
  // rather than trusting the status code alone.
  try {
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null) {
      return { ok: false, status: 'malformed_body' }
    }
  } catch {
    return { ok: false, status: 'malformed_body' }
  }

  return { ok: true, status: 200 }
}

// Thin outer wrapper around doLookupGuildMembership — adds duration/outcome
// logging at the one exit point every internal early-return funnels through,
// rather than instrumenting each of doLookupGuildMembership's five early
// returns individually. This is the single external HTTP call the entire
// sign-in flow depends on, and previously had no outcome/duration logging
// at all — never logs accessToken, only the resulting ok/status.
export async function lookupGuildMembership(
  accessToken: string,
): Promise<MemberLookupResult> {
  const startedAt = Date.now()
  const result = await doLookupGuildMembership(accessToken)
  getBackendLogger().info(
    {
      event: LOG_EVENTS.guildLookupComplete,
      durationMs: Date.now() - startedAt,
      ok: result.ok,
      status: result.status,
    },
    'Guild membership lookup complete',
  )
  return result
}

// Convenience wrapper combining the HTTP call + the pure predicate — this is
// what auth.ts's databaseHooks.account.create.before actually calls. Kept
// separate from lookupGuildMembership/isGuildMember (rather than inlining)
// so both halves stay independently unit-testable: the pure predicate against
// every MemberLookupResult variant with no HTTP mocking, and the HTTP call
// against a real (mocked) Discord endpoint.
export async function isCurrentUserGuildMember(
  accessToken: string,
): Promise<boolean> {
  const result = await lookupGuildMembership(accessToken)
  return isGuildMember(result)
}
