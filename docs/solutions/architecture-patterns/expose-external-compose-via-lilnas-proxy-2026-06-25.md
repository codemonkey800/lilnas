---
title: Exposing External Docker Compose Projects via lilnas-proxy
date: 2026-06-25
category: docs/solutions/architecture-patterns
module: lilnas-expose
problem_type: architecture_pattern
component: development_workflow
severity: medium
applies_when:
  - An external Docker Compose project needs a *.dev.lilnas.io subdomain over HTTPS
  - A dev service needs to be behind forward-auth for authenticated testing
  - Integration with other lilnas services requires a *.lilnas.io origin (CORS, OAuth)
tags:
  - docker
  - traefik
  - reverse-proxy
  - dev-expose
  - external-network
  - hmr
  - forward-auth
---

# Exposing External Docker Compose Projects via lilnas-proxy

## Context

When developing services in separate repositories outside the lilnas monorepo, there was no established way to route them through the production Traefik instance at `*.dev.lilnas.io` with TLS, auth, and a real hostname.

Two alternatives were explored and rejected before settling on the shared-network pattern (session history):

- **Bash CLI + Traefik file provider:** Dynamically wrote YAML into `/storage/app-data/traefik-dynamic` to proxy host-bound ports. Abandoned because it required an extra `host.docker.internal` hop, couldn't work with Docker-internal services, and had a silent name-collision bug: `lilnas-expose start redirect 8080` would overwrite the production `redirect.yml` that routes all HTTP→HTTPS — no guard existed.
- **DNS-01 wildcard cert:** Would have issued a single `*.dev.lilnas.io` cert, but rejected because the domain is not on Cloudflare and Namecheap's API requires IP allowlisting.

The final design attaches external compose projects' containers directly to a shared Docker network (`lilnas-proxy`) that Traefik monitors. No host ports, no extra hops — pure container-to-container routing.

## Guidance

### One-time host setup

```bash
docker network create lilnas-proxy
```

Create once per machine. Traefik (`infra/proxy.yml`) is already attached. If skipped, `docker compose up` on any project using this pattern will fail with:
> network lilnas-proxy declared as external, but could not be found

### Canonical per-project compose pattern

```yaml
networks:
  lilnas-proxy:
    external: true  # must pre-exist: docker network create lilnas-proxy

services:
  my-service:
    image: my-image
    # No `ports:` — Traefik reaches the container directly via the shared network
    networks:
      - default        # keep for sibling service communication (DB, cache, etc.)
      - lilnas-proxy   # join the shared proxy so Traefik can route to this container

    labels:
      - traefik.enable=true

      # REQUIRED when container is on 2+ networks — see "Why This Matters"
      - traefik.docker.network=lilnas-proxy

      # Use dev- prefix to avoid silently shadowing a production router name
      - traefik.http.routers.dev-my-service.rule=Host(`my-service.dev.lilnas.io`)
      - traefik.http.routers.dev-my-service.entrypoints=websecure
      - traefik.http.routers.dev-my-service.tls.certresolver=le

      # Container-internal port (not a host port — no `ports:` mapping needed)
      - traefik.http.services.dev-my-service.loadbalancer.server.port=3000

      # Auth is active by default. Remove to make the route public.
      # Use `forward-auth` (Docker provider form), NOT `forward-auth@file` (file provider form).
      - traefik.http.routers.dev-my-service.middlewares=forward-auth
```

### Naming rules

- `<name>` must be RFC 1123: lowercase alphanumeric + hyphens, ≤63 chars, no leading/trailing hyphen
- Always prefix router and service names with `dev-` (e.g. `dev-my-service`) to prevent silent production route conflicts
- Reserved names (shadow production): `traefik`, `auth`, `portal`, `equations`, `me-token-tracker`, `download`, `yoink`, `dashcam`, `macros`, `tdr-bot`, `prometheus`, `grafana`

### HMR for dev servers behind TLS

Dev servers accessed via a reverse proxy need extra config to route WebSocket HMR connections.

**Vite v7 and earlier:**
```ts
// vite.config.ts
export default {
  server: {
    host: '0.0.0.0',  // bind all interfaces, not just 127.0.0.1
    hmr: { clientPort: 443, protocol: 'wss' },
  },
}
```

**Vite v8+:**
```ts
// vite.config.ts
export default {
  server: {
    host: '0.0.0.0',
    ws: { clientPort: 443, protocol: 'wss' },
  },
}
```

**Next.js:**
```ts
// next.config.ts
const nextConfig = {
  allowedDevOrigins: ['my-service.dev.lilnas.io'],
}
```

### Guided workflow

The `/lilnas:expose` skill handles all of the above interactively — name validation, HMR detection, compose file merge, and live verification:

```bash
/plugin marketplace add ~/dev/lilnas
/plugin install lilnas@lilnas-marketplace
# Then from any project:
/lilnas:expose
```

## Why This Matters

### Non-deterministic network pick (the critical gotcha)

When a container joins two or more Docker networks, Traefik v3's Docker provider must choose one to use as the routing network. In Traefik v3 (verified v3.7.5), this pick is performed by iterating a Go map — whose iteration order is explicitly randomized per the Go spec.

Without `traefik.docker.network=lilnas-proxy`, roughly half of Traefik restarts result in Traefik picking the container's project `default` network. Since Traefik is not on that network, every proxied request returns 502. The other half, it works. This intermittency mimics a flaky config or race condition rather than a deterministic label omission — making it very hard to diagnose.

**The `traefik.docker.network` label is not optional when a container is on multiple networks.**

### Why not use `--providers.docker.network` globally?

A global flag on the Traefik command was explicitly rejected (session history). The production stack has 11 apps only on the `default` network. A global flag would cause Traefik to look for those containers on `lilnas-proxy`, fail to find them, and silently drop their routes. Per-container labels are the correct scoping mechanism.

### Retaining existing networks in infra/proxy.yml (session history)

Before this feature, `infra/proxy.yml` had no explicit `networks:` key, which implicitly put Traefik on the compose `default` network. Adding a `networks:` block without re-listing `default` would silently detach Traefik from all 11 production routers. The `lilnas-proxy` network must be appended to the existing networks block, not replace it.

### Silent route shadowing

Traefik does not warn when two routers share the same `Host()` rule — it silently serves one and drops the other. An unprefixed router name like `traefik.http.routers.portal` could silently shadow the production portal for all users. The `dev-` prefix convention and the reserved-name list are the only guards; there is no runtime enforcement.

### Middleware name: `forward-auth`, not `forward-auth@file` (session history)

Production `apps/*/deploy.yml` files use `forward-auth` (Docker-provider middleware reference form), not `forward-auth@file` (file-provider form). The `@file` suffix is only needed when the middleware is defined in a Traefik file provider config. Always use the bare `forward-auth` in Docker Compose label configurations.

## When to Apply

**Use this pattern when:**
- An external project needs a real `*.dev.lilnas.io` HTTPS URL during development
- Testing OAuth flows or features that require real TLS (not localhost self-signed)
- The service needs to be behind `forward-auth` for authenticated testing
- Integrating with other lilnas services that use `*.lilnas.io` origins (CORS, cookies)

**Do not use when:**
- The service runs on a different machine from the NAS host (same-host only, no tunneling)
- The container binds only to `127.0.0.1` inside the container and cannot be changed to `0.0.0.0`
- More than ~50 new unique subdomains per week are needed (Let's Encrypt per-domain cert rate limit; reusing the same `<name>` reuses its existing cert and does not count against this limit)

## Examples

A complete runnable example (Traefik `whoami` service with `forward-auth` active):
`plugins/lilnas/skills/expose/examples/docker-compose.yml`

Reference docs for the full convention:
- `plugins/lilnas/skills/expose/reference/convention.md` — canonical label set and lifecycle
- `plugins/lilnas/skills/expose/reference/naming-safety.md` — reserved names, RFC 1123 rules, silent shadowing details
- `plugins/lilnas/skills/expose/reference/hmr-config.md` — per-framework HMR snippets
- `plugins/lilnas/skills/expose/reference/caveats.md` — same-host limitation, 0.0.0.0 binding, cert rate limit, DNS wildcard interaction

## Related

- `infra/proxy.yml` — Traefik deployment; `lilnas-proxy` is joined here; deliberately no `--providers.docker.network` global flag
- `docs/lilnas-expose.md` — Full manual documentation (procedural complement to this pattern doc)
- `plugins/lilnas/skills/expose/SKILL.md` — The guided `/lilnas:expose` skill
