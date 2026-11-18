# cookie-rig

Verification kit for the lilnas-auth cookie strip: `/verify` and `/strip-cookie`
return the request's `Cookie` header minus lilnas-auth's own cookies, and
Traefik's `authResponseHeaders=...,Cookie` copies that onto the request it
forwards. Plain Node and bash, no dependencies.

| File                                      | What it is                                                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `echo.mjs`                                | HTTP and WebSocket echo server (`PORT`). `GET /json` reports cookie names, `authCookiePresent`, `X-Forwarded-User[-Id]`, `cookieHeaderCount`; `GET /` is a PASS/FAIL page; `/ws` echoes the upgrade request. Cookie values only with `ECHO_VALUES=1`. |
| `mint-session.mjs`                        | Inserts a user and session into a throwaway database and prints a signed session cookie the backend accepts. Refuses `DATABASE_PATH` under `/data` or `/storage`.                                                                                     |
| `rig.sh`                                  | Builds and starts everything on one isolated docker network, runs the matrix, always tears down. Exit 1 on any mismatch.                                                                                                                              |
| `traefik-dynamic.yml`                     | File-provider config for the rig: routes `gated`, `open`, `baseline` on `web` (cleartext) and `websecure` (TLS, default self-signed certificate, HTTP/1.1 and h2).                                                                                    |
| `client.mjs`                              | Matrix client (`ready`, `matrix`, `down`) run in a container on the rig network. Prints a markdown table; masks the session value.                                                                                                                    |
| `canary.private.yml`, `canary.shared.yml` | Compose files for a canary on the **production** Traefik. Not used by `rig.sh`; run later by hand (below).                                                                                                                                            |

## Run the rig

```bash
apps/auth/scripts/cookie-rig/rig.sh              # build, run, tear down
SKIP_BUILD=1 apps/auth/scripts/cookie-rig/rig.sh # reuse apps/auth/dist
```

Needs local images `traefik:v3.7.15` and a `node:<host node version>` (the
backend's native `better-sqlite3` is built for the host's Node major). Override
with `TRAEFIK_IMAGE`, `NODE_IMAGE`. `TRAEFIK_DYNAMIC=<file>` swaps the Traefik
config, e.g. one without `Cookie` in `authResponseHeaders` to see the matrix
fail.

What it does: builds the backend (`pnpm --filter @lilnas/auth build:backend`),
runs `node dist/main` from this checkout (mounted read-only) with a throwaway
SQLite file under `/tmp`, an https `AUTH_HOST`, and the minted user's email in
`ADMIN_EMAILS` (so `/verify` allows it on any host); mints a session; starts the
echo server (`ECHO_VALUES=1`), `traefik:v3.7.15` and a client container; checks
`/verify` and `/strip-cookie` directly; runs the matrix over HTTP/1.1
cleartext, HTTP/1.1 TLS and HTTP/2 TLS (asserting the negotiated protocol);
stops the echo backend for case 15. No ports are published, and the network,
containers and temp directory are removed on exit.

## Matrix

| #   | Route       | Case                                                                                  | Expect                                                           |
| --- | ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | baseline    | session + another cookie                                                              | session cookie reaches the backend (control)                     |
| 2   | gated       | session + others                                                                      | only the others, same order and bytes; minted `X-Forwarded-User` |
| 3   | gated       | session only                                                                          | no `Cookie` header                                               |
| 4   | gated       | no cookie                                                                             | 302 to the login page                                            |
| 5   | gated       | session value under `__Secure-better-auth.session_token` only                         | 302                                                              |
| 6   | gated       | session + `lilnas-auth.session_data` + `__Secure-lilnas-auth.dont_remember` + another | only the other                                                   |
| 7   | gated       | forged `X-Forwarded-User` and `-Id`                                                   | overwritten                                                      |
| 8   | gated       | cookies split over two headers (h1) or fields (h2)                                    | merged, session stripped                                         |
| 9   | gated       | POST with a 1 MB body                                                                 | arrives intact                                                   |
| 10  | open        | no cookie                                                                             | 200, no `Cookie` header                                          |
| 11  | open        | session + other                                                                       | only the other                                                   |
| 12  | open        | session only                                                                          | none                                                             |
| 13  | open        | another app's `__Secure-better-auth.session_token=keep`                               | arrives unchanged                                                |
| 14  | gated, open | WebSocket upgrade with session + other                                                | 101, backend saw only the other (ws and wss, HTTP/1.1)           |
| 15  | open        | echo backend stopped                                                                  | status Traefik returns (502 observed)                            |

Rows 1-13 run on all three transports. Case 14 runs on HTTP/1.1 only (the
upgrade is an HTTP/1.1 mechanism and what browsers use for `ws`/`wss`).

## Canary on production Traefik

Both canary files define one `cookie-canary-echo` container (`node:22-alpine`,
`echo.mjs` read-only, no `ECHO_VALUES`) on `lilnas-proxy` only, and two routers
on `websecure` with `tls=true`:

- `dev-cookie-canary` — `https://cookie-canary.dev.lilnas.io`, gated
- `dev-cookie-canary-open` — `https://cookie-canary-open.dev.lilnas.io`, ungated

`canary.private.yml` carries its own middlewares (`dev-cookie-canary-auth`,
`dev-cookie-canary-strip`) and works before `infra/proxy.yml` has the strip.
`canary.shared.yml` uses `lilnas-auth` and `lilnas-cookie-strip` from
`infra/proxy.yml` and defines none. They share a project name, so run one at a
time:

```bash
docker compose -f apps/auth/scripts/cookie-rig/canary.private.yml up -d
docker compose -f apps/auth/scripts/cookie-rig/canary.private.yml down
```

Open the hosts in a signed-in browser: the page shows PASS when neither the
HTTP request nor the WebSocket upgrade carried a `lilnas-auth` cookie, plus the
cookie names, `X-Forwarded-User` and the negotiated `nextHopProtocol`.

Never bring the canary up in the `lilnas` compose project and never use
`apps/auth/deploy.yml` for tests (it mounts the production database).
