# tdr-code Phase D — pre-cutover manual auth verification checklist

**Why this document exists, and why it's not part of the automated suite:** Phase D's plan
(`docs/plans/2026-07-02-001-feat-tdr-code-phase-d-auth-plan.md`, Implementation Unit U5) requires
proving the whole app-owned Discord-OAuth auth boundary works **before** U7 removes the Traefik
`forward-auth` middleware. The automated suite
(`apps/tdr-code/src/auth/__tests__/auth-e2e.spec.ts`) proves everything that can run headlessly —
every route's 401/200 behavior, session minting and revocation, tampered-cookie handling — by
driving a real NestJS app with Discord's HTTP endpoints mocked via `msw`. It deliberately does
**not** and **cannot** prove one thing: that a **real human**, using a **real Discord account**,
clicking through Discord's **actual consent screen** against the **real Discord OAuth
application**, gets the right outcome. That gap is what this checklist closes.

**Relationship to the automated suite:** the automated suite is what CI (and this repo's own
`pnpm --filter @lilnas/tdr-code test`) can prove on every commit, with no external dependency and
no human in the loop. This checklist is what a **human operator must additionally confirm**, once,
against the real Discord application and a real deployment, before U7 proceeds. Treat a green
automated suite as necessary but not sufficient — this checklist is the other half of the U5 gate.
Both must be green before U7 removes `forward-auth`.

**Do not skip straight to U7 on the strength of the automated suite alone.** The automated suite
cannot detect a misconfigured Discord OAuth application (wrong redirect URI, wrong client
secret, wrong guild ID in the deployed environment), because `msw` intercepts before any of that
configuration is ever exercised for real.

---

## Prerequisites (confirm before starting)

- [ ] A Discord OAuth application is registered (or the bot's existing application is reused for
      OAuth), with a client id + client secret distinct from `DISCORD_API_TOKEN` (the bot token).
- [ ] The registered redirect URI is **byte-identical** to
      `https://tdr-code.lilnas.io/api/auth/callback/discord` (or the equivalent for the environment
      under test, if this checklist is being run against a non-production deployment first).
- [ ] `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and the public base URL
      are populated in the deployment's env file (per the plan's "Deploy secrets in `infra/.env.*`
      env files" decision).
- [ ] You have (or can arrange) **two** real Discord accounts to test with:
  1. An account that **is** a member of the configured `DISCORD_GUILD_ID`.
  2. An account that is **not** a member of that guild.
- [ ] `forward-auth` is still attached to `tdr-code` (this checklist runs **before** U7 removes it
      — the edge gate stays in place as a safety net while you validate the app-owned gate
      underneath it).

---

## Checklist

Run these in order. Record the outcome of each step (pass/fail + any notes) in the **Run Log**
section at the bottom, not just a mental checkmark — this is what makes the checklist evidence
rather than folklore.

### 1. `/api/health` returns 200 before touching auth at all

- [ ] `curl -i https://tdr-code.lilnas.io/api/health` (or open it in a browser) returns `200` with
      no cookies set and no redirect. This is the baseline: if this fails, stop — nothing else in
      this checklist can be trusted until the health probe itself is healthy.

### 2. Sign in as a real guild member

- [ ] In a fresh/incognito browser session (no stale cookies from a prior test), navigate to
      `https://tdr-code.lilnas.io/login`.
- [ ] Confirm the login page renders **outside** the app's nav shell — a centered card only, not
      the full app chrome with links that would 401/bounce.
- [ ] Click "Login with Discord."
- [ ] Confirm you land on Discord's **real** consent screen (not an error page, not a redirect
      loop) — this is the step the automated suite cannot exercise at all, since Discord's own UI
      is never mocked there.
- [ ] Approve the consent screen using the **guild-member** account.
- [ ] Confirm you are redirected back to the app and land on an authenticated page (not
      `/login?error=...`).
- [ ] Open browser dev tools → Application/Storage → Cookies, and confirm a session cookie is
      present (name matches Better Auth's `__Secure-<prefix>.session_token` pattern — the exact
      prefix is configurable, so match on the `.session_token` suffix, not a hardcoded full name).
- [ ] Navigate to a guarded read route in the UI (e.g. the Sessions or Live view) and confirm it
      loads real data (or an empty-state, if there's genuinely nothing to show) rather than
      redirecting to `/login` or showing a 401 error.
- [ ] Confirm the nav shows your Discord display name/avatar (not a generic/anonymous state).

### 3. Attempt sign-in as a real non-member Discord account

- [ ] In a **separate** fresh/incognito session (do not reuse the member session's cookies),
      navigate to `https://tdr-code.lilnas.io/login` again.
- [ ] Click "Login with Discord."
- [ ] Approve the consent screen using the **non-member** account.
- [ ] Confirm you are redirected to `/login?error=not_guild_member` (or the equivalent stable error
      code the app uses) — **not** to an authenticated page, and **not** a raw 500 error page.
- [ ] Confirm the login page renders a clear "you don't have access" message, not a blank error or
      a stack trace.
- [ ] Open dev tools → Cookies and confirm **no working session cookie** resulted — a transient
      OAuth-state cookie may briefly exist mid-flow, but nothing that survives as a
      `.session_token` cookie after landing on the error page.
- [ ] Attempt to directly navigate to a guarded route (e.g. `/sessions`) in this same non-member
      browser session. Confirm it redirects to `/login` (does **not** show real data).

  > **Note:** this step should redirect to `/login?error=not_guild_member`, not surface a raw 500.
  > A 500 here regressed a fixed defect (see "Resolved issue" below) — if you observe one, this is
  > new information and should be reported/investigated, not assumed to be the old, already-fixed
  > bug.

### 4. Confirm `/api/health` still returns 200 throughout

- [ ] Re-run step 1's health check now, after both sign-in attempts above. Confirm it is still a
      clean `200` with no cookies/redirects — sanity-checking that neither sign-in attempt (member
      or non-member) left the server in a state where the health probe itself regressed.

### 5. (Optional but recommended) Confirm logout end-to-end for a real session

- [ ] From the guild-member session established in step 2, use the nav's logout control.
- [ ] Confirm you land on a bare `/login` (no error banner — distinct from the involuntary
      `session_expired` state).
- [ ] Confirm the session cookie is cleared (dev tools → Cookies) or expired.
- [ ] Attempt to navigate back to a guarded route using the browser's back button / a bookmarked
      URL. Confirm it redirects to `/login` rather than showing cached authenticated content.

---

## Resolved issue (fixed — recorded for history, not a live caveat)

While building this checklist's automated counterpart, U5's suite discovered — and U3's own
Discord-OAuth-mocked test suite had not caught — a defect in the guild-membership rejection path:
a **non-member** completing OAuth surfaced a raw `500` server error on the callback instead of the
intended redirect to `/login?error=not_guild_member`. The **access boundary itself held throughout**
(no usable session/account row was ever created for a rejected sign-in — confirmed at the database
level even while this was broken), but the **HTTP experience** for that rejection was broken: the
guild-gate hook's `return false` stopped the `account` row from being created but did not stop
Better Auth's own subsequent `createSession` call for the `user` row the same hook's orphan-sweep
had already deleted, producing an unhandled foreign-key-constraint error. Fixed in `src/auth/auth.ts`
by throwing an `APIError('FORBIDDEN', ...)` instead of returning `false` — see that file's own
comment for the full mechanism — with regression coverage added to both
`guild-gate.spec.ts` and `auth-e2e.spec.ts` asserting the redirect (not the 500). Step 3 above
should not reproduce this; if it does, treat it as a new regression.

---

## Run Log

Fill in a new entry each time this checklist is executed. Do not overwrite prior entries — this
log is what makes "verified before cutover" a checkable historical fact, not a claim.

| Date/time (with timezone) | Commit SHA tested                  | Operator    | Step 1 (health, before) | Step 2 (member sign-in) | Step 3 (non-member rejected) | Step 4 (health, after) | Step 5 (logout) | Overall: Go / No-Go | Notes |
| ------------------------- | ---------------------------------- | ----------- | ----------------------- | ----------------------- | ---------------------------- | ---------------------- | --------------- | ------------------- | ----- |
| _(fill in)_               | _(fill in — `git rev-parse HEAD`)_ | _(fill in)_ |                         |                         |                              |                        |                 |                     |       |

**Getting the commit SHA to record:** run `git rev-parse HEAD` in the repo checked out at the
commit that produced the deployment under test, or read it from the deployment's own build/boot
log line if one is emitted. Record the **short** SHA at minimum (`git rev-parse --short HEAD`);
the full SHA is preferred if convenient.

---

## Relationship to U7

This checklist, together with a fully green `pnpm --filter @lilnas/tdr-code test -- auth-e2e`,
is the recorded precondition the plan's U5 requires before U7 removes the `forward-auth`
middleware. U7's own "Go/No-Go gate" (see the plan's Operational / Rollout Notes) re-states several
of the same checks (member sign-in works, non-member is rejected, `/api/health` stays 200) as a
**final** confirmation immediately before flipping the label — that is a repeat of this checklist
at cutover time, not a replacement for running it here first while `forward-auth` is still the
safety net.
