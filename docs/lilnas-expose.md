# Exposing External Dev Services via lilnas-proxy

This document covers how to expose a Docker Compose project running on the NAS host at `https://<name>.dev.lilnas.io` using the shared `lilnas-proxy` network and the production Traefik proxy.

> **⚠️ Security:** Every exposed route is reachable from anywhere on the internet. Dev servers are typically unhardened — enable `forward-auth` gating for any route with data or debug surfaces. The example and skill both ship with gating active by default.

The guided path is the **`/lilnas:expose` skill** (recommended — includes safety guards, HMR config, and a live walkthrough). This document covers the manual path and install steps.

---

## Install the skill (one-time per machine)

```bash
# Register the lilnas repo as a local marketplace
/plugin marketplace add ~/dev/lilnas

# Install the lilnas plugin from that marketplace
/plugin install lilnas@lilnas-marketplace
```

After installing, `/lilnas:expose` is available from **any project** on this machine.

> **Note:** The install is a point-in-time snapshot. Changes made to the skill files in this repo do not propagate to your installed copy automatically — run `/plugin update lilnas@lilnas-marketplace` to pick up updates.

### Project-scope auto-enable (inside lilnas)

The plugin auto-enables when working inside the lilnas repo if `.claude/settings.json` is committed with an `enabledPlugins` entry. The per-machine `marketplace add` is still required first — project-scope activation is not zero-setup.

---

## One-time platform setup

```bash
docker network create lilnas-proxy
```

This creates the shared external network that Traefik uses to discover containers from other compose projects. Run this once; it persists across reboots. The production Traefik is already configured to join this network (`infra/proxy.yml`).

---

## Expose a project (manual path)

Add the following to your external project's `docker-compose.yml`:

```yaml
networks:
  lilnas-proxy:
    external: true   # must pre-exist: docker network create lilnas-proxy

services:
  <service>:
    # No `ports:` — Traefik routes via the shared network (no host port needed)
    networks:
      - default        # keep access to sibling services
      - lilnas-proxy   # join the shared proxy network
    labels:
      - traefik.enable=true
      - traefik.docker.network=lilnas-proxy          # REQUIRED — see note below
      - traefik.http.routers.dev-<name>.rule=Host(`<name>.dev.lilnas.io`)
      - traefik.http.routers.dev-<name>.entrypoints=websecure
      - traefik.http.routers.dev-<name>.tls.certresolver=le
      - traefik.http.services.dev-<name>.loadbalancer.server.port=<port>
      # Remove this label to make the route public:
      - traefik.http.routers.dev-<name>.middlewares=forward-auth
```

Replace `<name>` with your chosen subdomain and `<port>` with the container-internal port.

Then:
```bash
docker compose up -d
```

The route goes live within ~1 second. `docker compose down` removes it.

**Why `traefik.docker.network=lilnas-proxy` is required:** When a container joins two networks, Traefik v3 picks the routing network via non-deterministic Go map iteration — causing intermittent 502s. This label forces a deterministic choice.

---

## Naming rules

- `<name>` must be a valid RFC 1123 DNS label: lowercase alphanumeric + hyphens, no leading/trailing hyphen, ≤63 chars.
- **Reserved names** (will shadow production routes — do not use): `traefik`, `auth`, `portal`, `equations`, `me-token-tracker`, `download`, `yoink`, `dashcam`, `macros`, `tdr-bot`, `prometheus`, `grafana`.
- Use the `dev-<name>` prefix on router names (as shown above) to avoid silent conflicts with production router names.

Traefik does not warn on `Host()` conflicts — a careless `<name>` silently shadows a production route. **No runtime enforcement is provided in the manual path; the operator owns these rules.**

For the full reserved-name list and collision details, see `plugins/lilnas/skills/expose/reference/naming-safety.md`.

---

## HMR / WebSocket (dev servers behind TLS)

When running a Vite or Next.js dev server behind Traefik, HMR WebSockets require additional config. See `plugins/lilnas/skills/expose/reference/hmr-config.md` for per-framework snippets (Vite v7/v8, Next.js v15).

---

## Runnable example

A `traefik/whoami` fixture is bundled at `plugins/lilnas/skills/expose/examples/docker-compose.yml`. It ships with `forward-auth` active and demonstrates the full label set.

---

## Caveats

- **Same-host only.** The external project must run on the NAS Docker host.
- **Container must bind `0.0.0.0`.** Traefik cannot reach a service bound only to `localhost`.
- **Per-host TLS certs.** No wildcard `*.dev.lilnas.io` cert — each hostname gets its own cert on first request (~50 new certs/week Let's Encrypt rate limit; reusing a hostname reuses its cert).
- **DNS interaction.** `*.dev.lilnas.io` resolves via the existing `*.lilnas.io` wildcard. If any explicit DNS record is added under `dev`, the wildcard stops covering `*.dev.lilnas.io`.

See `plugins/lilnas/skills/expose/reference/caveats.md` for the full list.
