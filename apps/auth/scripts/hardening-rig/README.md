# hardening-rig

Live check for plan 022's auth router hardening. It runs the two pieces the specs
fake: Traefik reading Docker labels, and the Next rewrite proxy between
the browser and the backend. It also checks the cookie-drop label that a
later phase puts on turbo and emby. Everything runs in throwaway
containers on one new network, and the rig always tears down.

| File         | What it is                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rig.sh`     | Builds the auth image once (or reuses `RIG_IMAGE`), starts the rig, runs the matrix, checks the production Traefik log, prints the table and always tears down. Exit 1 on any failed row. |
| `labels.mjs` | Prints the rig copy of auth-frontend's Traefik labels, generated from `apps/auth/deploy.yml`. It fails if an expected line is missing.                                                    |
| `client.mjs` | Matrix client, run inside client containers A and B. Prints markdown rows `case \| expected \| observed \| result`. Prints cookie names, never values.                                    |

Reused from `../cookie-rig/`: `mint-session.mjs` (signed sessions in the
throwaway database, mounted into the backend container), `echo.mjs` (the
cookie-drop backend; it also reports `Authorization` and `X-Emby-Token`)
and `http1.mjs` (hand-written HTTP/1.1, so a request can carry two `Cookie:`
lines).

## Run it

```bash
apps/auth/scripts/hardening-rig/rig.sh                    # build, run, tear down (image removed)
RIG_IMAGE=hardening-rig-auth:abcd apps/auth/scripts/hardening-rig/rig.sh
                                                          # reuse an image; you remove it
```

This host is the production server. `rig.sh` refuses to build while another
`docker build` or jest run is going. Run it alone. It needs local images:
`traefik:v3.7.15`, plus the `ghcr.io/codemonkey800/lilnas-*` base images the
Dockerfile names. If the build fails on a base image, `docker pull` that
image.

## What runs

All containers are named `hardening-rig-<hex>-*`, sit on network
`hardening-rig-<hex>-net` and publish no ports.

| Container        | What                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | The image's `node dist/main`. Test values for every secret, a throwaway SQLite file under `/tmp`, `SSE_KEEPALIVE_MS=1000`, network alias `auth` (the build's rewrites proxy to `http://auth:8081`).        |
| `frontend`       | The image's `node frontend/apps/auth/server.js` with deploy.yml's literal env (rig values) and `AUTH_BACKEND_URL=http://auth:8081`. It carries the labels from `labels.mjs`.                               |
| `echo`           | `echo.mjs` behind routers `rig-drop-web`/`rig-drop-tls` (middleware `rig-drop-cookies`: `headers.customrequestheaders.Cookie=` with an empty value) and the control routers `rig-keep-web`/`rig-keep-tls`. |
| `traefik`        | `traefik:v3.7.15`, Docker provider (socket read-only), `exposedByDefault=true`, constraint ``Label(`hardening-rig`,`1`)``, `web` + `websecure` with the default self-signed certificate.                   |
| `client-a`, `-b` | Run `client.mjs`. They have two addresses, for the per-IP in-flight case.                                                                                                                                  |

What `labels.mjs` changes, and nothing else:

- drops `traefik.enable=true`
- adds the `rig-` prefix to every router, service and middleware name
- changes `auth.lilnas.io` to `auth.rig.test`
- changes `tls.certresolver=le` to `tls=true`
- adds `hardening-rig=1`
- case 3 only: lowers `amount` to 3, and the control also removes the `ipstrategy` line

## Production safety

The production Traefik watches the same Docker daemon, so:

- No rig container has `traefik.enable=true`. Production runs with
  `exposedByDefault=false` and ignores them.
- Only `frontend` and `echo` carry `hardening-rig=1`. The rig Traefik sees
  nothing else.
- Every name starts with `rig-` and every host is under `rig.test`.
- After the rig is up, and again after the matrix, `rig.sh` checks
  `docker logs lilnas-traefik-1 --since 5m` for any line that mentions
  `rig-`, and checks for errors since the rig started. On a hit it tears down
  at once and exits 3.
- It never uses `apps/auth/deploy.yml` (that file mounts the production
  database) or the `lilnas` compose project.

## Matrix

| #   | Case                                                                                                                                 | Expect                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/login` and a 404 over TLS through Traefik                                                                                          | HSTS `max-age=31536000` (no `includeSubDomains`/`preload`), `DENY`, `nosniff`, `frame-ancestors 'none'` on both                                                       |
| 2   | `/login` straight from the frontend and through Traefik                                                                              | no `x-powered-by`                                                                                                                                                     |
| 3   | `amount` 3, `ipstrategy` kept: A holds 3 SSE streams, then sends a 4th request; B sends one at the same moment                       | A's 4th is 429 and carries the headers; B is 200                                                                                                                      |
| 3c  | same, `ipstrategy` line removed (control)                                                                                            | B is 429 too                                                                                                                                                          |
| 4   | `/api/sse/pending` through Traefik, the Next rewrite and the backend                                                                 | no cookie: 401 in under 1 s; session: 200 with a keepalive; 7th stream 429; a slot freed within 5 s of a close; `/api/sse/admin` 200 for an admin, 401 with no cookie |
| 5   | `drop` and `keep` routers over HTTP/1.1 cleartext, HTTP/1.1 TLS and HTTP/2 TLS, cookies in one header and in two; ws and wss upgrade | drop: no `Cookie` header at all, while `Authorization` and `X-Emby-Token` arrive unchanged; keep: the cookies arrive                                                  |
| 6   | `POST /api/auth/sign-in/social` with a matching `Origin`                                                                             | 200 with an `accounts.google.com` URL; only the cookie names are printed                                                                                              |

Case 3 holds open SSE streams because an open stream counts as an in-flight
request until it closes. This also means that in production, every open
stream counts against the 64-per-IP limit.
