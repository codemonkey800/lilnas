# Expose Convention Reference

## One-Time Platform Setup (F1)

Before any project can be exposed, the shared network must exist:

```bash
docker network create lilnas-proxy
```

This is a **one-time host-level operation**. Because the network is declared `external: true` in every compose file that references it, `docker compose up` will fail with a self-explaining error ("network declared as external, but could not be found") if this step is skipped.

The lilnas production Traefik (`infra/proxy.yml`) is already attached to `lilnas-proxy` — no further platform setup is needed beyond creating the network once.

---

## Per-Project Convention (F2)

Add these two blocks to the external project's compose file. The service **must not** publish a host port — Traefik reaches it over `lilnas-proxy` at its internal container port.

```yaml
networks:
  lilnas-proxy:
    external: true  # do NOT create — must pre-exist from platform setup

services:
  <service>:
    # no `ports:` — Traefik routes via the shared network
    networks:
      - default        # keep access to sibling services in the project
      - lilnas-proxy   # join the shared proxy network

    labels:
      # Required: enable Traefik discovery
      - traefik.enable=true

      # Required: pin the routing network — without this, Traefik's
      # network pick is non-deterministic when the container is on 2+
      # networks (verified Traefik v3.7.5), causing intermittent 502s.
      - traefik.docker.network=lilnas-proxy

      # Router: unique name, host rule, entrypoint, TLS
      # Use a dev- prefix on the router name to avoid colliding with
      # production routers (see naming-safety.md).
      - traefik.http.routers.dev-<name>.rule=Host(`<name>.dev.lilnas.io`)
      - traefik.http.routers.dev-<name>.entrypoints=websecure
      - traefik.http.routers.dev-<name>.tls=true

      # Service: the container-internal port your app listens on
      - traefik.http.services.dev-<name>.loadbalancer.server.port=<port>

      # Access control: REMOVE this label to make the route public (R11)
      # Shipped active by default — removal is the deliberate opt-out.
      - traefik.http.routers.dev-<name>.middlewares=forward-auth
```

Replace `<name>` with your chosen subdomain label and `<port>` with the port your service listens on inside the container.

### Why `traefik.docker.network=lilnas-proxy` is required

When a container joins two networks (its own project `default` + `lilnas-proxy`), Traefik's Docker provider picks one network to route through. In Traefik v3.7.5 this pick is **non-deterministic** — Go map iteration order is random, so the chosen network flips between config reloads, producing intermittent 502s. The `traefik.docker.network` label forces a deterministic choice.

---

## Lifecycle (R8, R9)

- `docker compose up` makes the route live within **~1 second** via Traefik's Docker provider hot-reload — no Traefik restart needed.
- `docker compose down` removes the route automatically within ~1 second — no lingering routes.
- All active routes (including dev routes) are visible in the **Traefik dashboard** at `https://traefik.lilnas.io` (gated by OAuth).

---

## TLS / Certificates (R10)

Routes are served over **HTTPS** using the `*.dev.lilnas.io` wildcard certificate managed by the production Traefik. Use `tls=true` on the router — do **not** set `tls.certresolver=le`. Setting `certresolver` causes Traefik to request a new per-host certificate for the specific subdomain instead of using the wildcard, consuming Let's Encrypt quota unnecessarily.

**Let's Encrypt rate limits:** ~50 new certificates per week per registered domain. The wildcard cert is renewed once and shared across all `*.dev.lilnas.io` routes.
