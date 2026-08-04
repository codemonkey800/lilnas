---
title: 'U1 spike findings: ForwardAuth and SSE contract'
plan: docs/plans/2026-07-31-001-feat-lilnas-auth-forward-auth-plan.md
date: 2026-08-01
status: resolved
---

# U1 spike findings

Empirical proof of the four assumptions the `lilnas-auth` design rests on, per the plan's U1. All four
confirmed. No re-plan needed.

## Method

Dev Traefik (`infra/proxy.dev.yml`, temporarily modified, fully reverted after) plus a throwaway Node stub
(`/tmp/lilnas-auth-spike/stub.mjs`, never committed) standing in for `/verify`. The stub captured the headers
it received on `/inspect` and returned controllable responses (`?mode=allow|redirect-relative|redirect-absolute|
teapot`) via per-route middleware/router pairs, backed by `traefik/whoami` as the "protected" upstream. A fifth
router pointed directly at the stub's own SSE endpoint.

**Environment note:** host port 80 was intercepted by something ahead of Docker's port-publishing on this
machine (returned an nginx-branded 502 without ever reaching the Traefik container — confirmed via Traefik's
DEBUG-level logs showing zero incoming requests). Worked around by also publishing Traefik's port 80 to host
port 8090 and testing through that instead; confirmed via Traefik's own debug config dump that this was a
host-side quirk, not a Traefik or ForwardAuth behavior. Irrelevant to production, where Traefik owns 80/443
directly.

## (a) Cookie arrives on the ForwardAuth subrequest — CONFIRMED

Request: `curl http://stub-allow.localhost/some/path?query=1 -H "Cookie: session=abc123; other=xyz"`

Stub received on `/verify-stub`:
```json
"cookie": "session=abc123; other=xyz"
```

Byte-identical to what was sent. `authRequestHeaders` unset on the middleware forwards all request headers,
confirming R1/R2's foundation.

## (b) X-Forwarded-* headers arrive with expected values — CONFIRMED

Same request, full header set the stub observed:

```json
{
  "x-forwarded-for": "192.168.65.1",
  "x-forwarded-host": "stub-allow.localhost",
  "x-forwarded-method": "GET",
  "x-forwarded-port": "80",
  "x-forwarded-proto": "http",
  "x-forwarded-server": "becf8c3aa2ab",
  "x-forwarded-uri": "/some/path?query=1"
}
```

- `x-forwarded-host` is the **original request's** host (`stub-allow.localhost`), not the auth container's own
  host — required for R2's per-service keying.
- `x-forwarded-proto` + `x-forwarded-host` + `x-forwarded-uri` reconstruct `http://stub-allow.localhost/some/path?query=1`
  — byte-for-byte the original URL (`https://` in production, since TLS terminates at Traefik there). Confirms
  R3's redirect-back mechanism.
- `x-forwarded-for` and `x-forwarded-server` are present but unused by the design; noted for completeness.

## (c) Location header behavior — CONFIRMED, matches the plan's central risk exactly

Three cases, same stub, only the `Location` value and `preserveLocationHeader` setting varied:

| Case | Stub sent | `preserveLocationHeader` | Client received |
|---|---|---|---|
| 1 | `Location: /relative-target` | unset (default `false`) | `Location: http://verify-stub:9999/relative-target` |
| 2 | `Location: /relative-target` | `true` | `Location: /relative-target` (unmodified) |
| 3 | `Location: https://stub.localhost/absolute-target` | unset (default `false`) | `Location: https://stub.localhost/absolute-target` (unmodified) |

Case 1 is the exact failure mode the plan predicted: Traefik prefixed the relative Location with the **auth
server's own** scheme+host (`http://verify-stub:9999`), producing a URL that only resolves inside the Docker
network — a browser following it gets a connection failure. This is not a hypothetical; it reproduced on the
first try.

Case 2 is a nuance worth recording precisely because it complicates the "just set `preserveLocationHeader=true`"
instinct: with the flag on, Traefik stops rewriting the Location, but a **relative** Location is then resolved
by the browser against the *original request's origin* (`stub-redirect-rel-preserve.localhost` here) — not
against the auth host. For `/verify`, redirect targets are always the auth host's own login/pending pages, a
**different** origin than whatever service is being verified. So even with `preserveLocationHeader=true`, a bare
relative Location would silently redirect to the wrong host rather than fail loudly. This reinforces rather than
weakens the plan's rule: **`/verify` must emit absolute `https://<AUTH_HOST>/...` URLs unconditionally**;
`preserveLocationHeader=true` is correctly scoped as defense in depth, not a substitute.

Case 3 confirms the plan's chosen approach works exactly as needed: absolute URLs pass through untouched
regardless of the flag.

## (d) SSE through Traefik streams without buffering — CONFIRMED

16-second connection to an SSE endpoint emitting one tick every 3 seconds, through Traefik, with per-line
receive timestamps:

```
02:25:55 | id: 1 / data: tick 1
02:25:58 | id: 2 / data: tick 2
02:25:61 | id: 3 / data: tick 3
02:26:04 | id: 4 / data: tick 4
02:26:07 | id: 5 / data: tick 5
```

Ticks arrived in real time at the source interval — not batched or delayed until connection close — and the
connection survived multiple intervals without Traefik dropping it. Confirms there is no buffering middleware
in the dev chain and nothing in Traefik's default entrypoint config holds SSE responses. No nginx sits in this
chain (unlike `apps/tdr-code`'s deployment), so the `apps/tdr-code/deploy/sse-locations.conf` buffering
workarounds do not apply here — NestJS's own `X-Accel-Buffering: no` / `Cache-Control: no-transform` on `@Sse()`
remain correct defensive headers to keep, but there is no proxy-layer buffering to defeat in this topology.

## Non-2xx relay — CONFIRMED (supporting finding, not one of the four numbered assumptions)

A `418` with body `I'm a teapot` from the stub was relayed to the client with status and body intact. Confirms
the plan's assumption that non-2xx responses (redirects included) pass through rather than being replaced by a
generic Traefik error page.

## `addAuthCookiesToResponse` — not needed

Deferred-to-implementation question, resolved by design inspection rather than a new empirical test:
`/verify`'s three response shapes are 200-allow (no cookie — `X-Forwarded-User` only), a redirect to login or
pending (no cookie — the OAuth cookie exchange happens at `/api/auth/callback/google`, served through the
**router** path on :8080, never through the ForwardAuth subrequest to :8081), and a fail-closed 5xx (no cookie).
`/verify` never originates a `Set-Cookie`, so `addAuthCookiesToResponse` has nothing to carry. Consistent with
the "no rolling session refresh from `/verify`" decision.

## Conclusion

All four assumptions hold as documented. No shape in the plan changes as a result of this spike. The one
addition this findings doc makes to the plan's own text is the Case 2 nuance above, which sharpens *why*
absolute-URL discipline is non-negotiable rather than merely convenient.

`infra/proxy.dev.yml` was reverted to its original content; the throwaway stub and its container were removed.
The proven assertions are carried into
`apps/lilnas-auth/src/verify/__tests__/forwardauth-contract.spec.ts`, written against an in-process harness that
encodes this same contract so it runs in CI without Docker or a live Traefik. That spec activates once U2 lands
`apps/lilnas-auth`'s Jest config.
