# Caveats and Known Gotchas

## Same-host only

`lilnas-proxy` spans a **single Docker host** — the NAS machine where Traefik runs. External compose projects must run on the same host. This is not a tunnel for laptops or remote machines.

---

## Container must bind `0.0.0.0`

The exposed service must listen on `0.0.0.0` (all interfaces) at the declared internal port, not just `127.0.0.1`/`localhost`. Traefik reaches the container over the `lilnas-proxy` network bridge, which only works if the service is bound to a routable interface.

Verify with:
```bash
docker inspect <container> --format '{{json .NetworkSettings.Networks}}'
```

For dev servers, check the framework's `host` config:
- Vite: `server.host: '0.0.0.0'`
- Next.js: binds `0.0.0.0` by default
- Express / Fastify: `app.listen(port, '0.0.0.0', ...)`

---

## No automatic collision detection

Traefik silently resolves `Host()` conflicts — no warning is emitted. See `naming-safety.md` for the full reserved-name list and the `dev-` prefix convention. The operator owns this; there is no runtime enforcement.

---

## Use `tls=true`, not `tls.certresolver=le`

All `*.dev.lilnas.io` routes share the wildcard certificate managed by the production Traefik. Router labels must use `tls=true` — do **not** set `tls.certresolver=le`.

Setting `certresolver` causes Traefik to issue a new per-host cert for the exact subdomain instead of using the wildcard, which wastes Let's Encrypt quota (~50 new certs/week per registered domain) and bypasses the wildcard entirely.

---

## Routes are public by default

Every exposed route is reachable at `https://<name>.dev.lilnas.io` from **anywhere on the internet** — no IP allowlist, no VPN, no authentication — unless the `forward-auth` middleware label is present.

Dev servers are typically **unhardened**: debug endpoints, seed data, source maps, no rate limiting, no input validation designed for adversarial traffic. Recommend gating any route that has data or debug surfaces behind `forward-auth`.

The `examples/docker-compose.yml` bundled with this skill ships with `forward-auth` active by default; removal is the deliberate opt-out.

---

## DNS record interaction

`*.dev.lilnas.io` resolves via the existing `*.lilnas.io` wildcard. If any **explicit DNS record** is added under `dev` (e.g. a direct `A` record for `dev.lilnas.io`), the wildcard stops covering `*.dev.lilnas.io`. An explicit `*.dev` wildcard CNAME must then be added to restore coverage.

---

## Traefik restart during production re-deploy

When the production Traefik container is restarted (e.g. during a lilnas deploy), all routes are briefly interrupted — including `*.lilnas.io` production routes and active `*.dev.lilnas.io` dev routes. This is expected and transient (~seconds). In-flight ACME challenges retry automatically.
