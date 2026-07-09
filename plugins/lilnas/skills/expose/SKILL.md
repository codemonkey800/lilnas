---
name: expose
description: >
  Expose an external Docker Compose project at https://<name>.dev.lilnas.io via
  the shared lilnas-proxy network and Traefik. Use when an operator wants to
  reach a dev server on the NAS from another device or share a link to a project
  running outside the lilnas monorepo. Guides the operator from "I have a compose
  project" to "it's live at https://<name>.dev.lilnas.io" with the safety guards
  (gate-by-default, reserved-name rejection, HMR config) built in.
disable-model-invocation: true
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Bash
---

# /lilnas:expose — Guided Dev Expose Workflow

> **Security notice:** Every route you expose is reachable from anywhere on the internet at `https://<name>.dev.lilnas.io` with **no authentication** unless gated. Dev servers are typically unhardened. The guided workflow ships `forward-auth` active by default; the operator removes it deliberately to go public.

This skill walks an operator through exposing a Docker Compose service on the NAS host via the shared `lilnas-proxy` network and Traefik. It operates on **external projects** only — never on the lilnas monorepo's own `infra/proxy.yml` or `apps/*/deploy.yml`.

Read the reference files as needed:
- `reference/convention.md` — platform setup, canonical label set, lifecycle
- `reference/naming-safety.md` — reserved names, RFC 1123, collision risks
- `reference/hmr-config.md` — Vite and Next.js HMR config snippets
- `reference/caveats.md` — gotchas and known limitations

---

## Stage 1: Locate the target project

Ask the operator: **"What is the path to the compose project you want to expose?"**

Once provided:
1. Search for a compose file at the path: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, or `compose.yaml`.
2. If no compose file is found, **refuse** with a clear message:
   > No Docker Compose file found at `<path>`. This skill works only with Docker Compose projects. Check the path and try again.
3. Read the compose file.
4. If the compose file defines **more than one service**, ask: **"Which service do you want to expose?"** Wait for an answer before proceeding.
5. Verify the target service exists in the compose file. If not, refuse with:
   > Service `<service>` not found in `<path>/docker-compose.yml`.

---

## Stage 2: Choose the exposed name `<name>`

Default: the service name from Stage 1.

Validate `<name>`:
- Must match RFC 1123: `^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$` or a single `[a-z0-9]` character
- Must not be in the reserved list (read `reference/naming-safety.md` for the full list):
  `traefik`, `auth`, `portal`, `equations`, `me-token-tracker`, `download`, `yoink`, `dashcam`, `macros`, `tdr-bot`, `prometheus`, `grafana`

If the default name is invalid or reserved, tell the operator:
> `<name>` is reserved or not a valid DNS label. Choose a different name for `<name>.dev.lilnas.io`.

Ask the operator to confirm or change the name before continuing.

---

## Stage 3: Check platform readiness

Run:
```bash
docker network inspect lilnas-proxy --format '{{.Name}}' 2>&1
```

If the network does not exist:
> The `lilnas-proxy` network does not exist yet. This is a one-time platform setup step.
> Run: `docker network create lilnas-proxy`
>
> Once done, re-run this skill.

Ask for confirmation before running the command. If the operator confirms, run it.

If the network exists, confirm:
> ✅ `lilnas-proxy` network exists.

---

## Stage 4: Detect port

Check whether the target service declares an internal port. Look for:
- A `ports:` entry in the compose file (e.g. `"3000:3000"` → internal port `3000`)
- An `expose:` entry
- A `PORT` or similar environment variable

If detected, show the operator: **"Detected internal port: `<port>`. Is this correct?"**

If no port is found, ask: **"What port does `<service>` listen on inside the container?"**

---

## Stage 5: Detect HMR framework

Check for `package.json` files in the project directory. Look for:
- `"vite"` in `dependencies` or `devDependencies` → Vite dev server
- `"next"` in `dependencies` or `devDependencies` → Next.js dev server

If Vite is detected:
- Read `reference/hmr-config.md` for the Vite section
- Check the installed Vite version: read `package.json` or run `cat node_modules/vite/package.json | grep '"version"'`
- Prepare the Vite HMR config snippet (v7 uses `server.hmr`, v8+ uses `server.ws`)

If Next.js is detected:
- Read `reference/hmr-config.md` for the Next.js section
- Prepare the `allowedDevOrigins` snippet for `next.config.ts`

---

## Stage 6: Show the diff and confirm

Construct the changes without writing them yet. Show the operator a preview:

**Compose file changes (`<path>/docker-compose.yml`):**

```yaml
# To add to top-level networks:
networks:
  lilnas-proxy:
    external: true

# To add to service <service>:
networks:
  - default
  - lilnas-proxy
labels:
  - traefik.enable=true
  - traefik.docker.network=lilnas-proxy
  - traefik.http.routers.dev-<name>.rule=Host(`<name>.dev.lilnas.io`)
  - traefik.http.routers.dev-<name>.entrypoints=websecure
  - traefik.http.routers.dev-<name>.tls=true
  - traefik.http.services.dev-<name>.loadbalancer.server.port=<port>
  - traefik.http.routers.dev-<name>.middlewares=forward-auth
```

If HMR config is needed, show the framework-specific snippet from `reference/hmr-config.md`.

Ask: **"Apply these changes and run `docker compose up`?"**

**Do not write any files or run any commands until the operator confirms.**

---

## Stage 7: Apply changes

Only after explicit operator confirmation:

### 7a. Merge compose file changes

**IMPORTANT — merge, do not clobber:**
- If the compose file already has a top-level `networks:` key, add `lilnas-proxy: {external: true}` to the existing block. Do not overwrite it.
- If the service already has a `networks:` key, add `- lilnas-proxy` to the existing list. Do not replace the existing list.
- If the service already has a `labels:` key, add the new labels to the existing list.
- Never remove existing networks from any service.

Write the updated compose file.

### 7b. Apply HMR config (if applicable)

Write the HMR configuration into the external project's config file (`vite.config.ts` or `next.config.ts`). Merge — do not overwrite unrelated config.

### 7c. Run `docker compose up`

```bash
cd <project-path> && docker compose up -d
```

Wait for completion. Report the result.

---

## Stage 8: Verify and close

After `docker compose up` succeeds:

1. Wait ~2 seconds for Traefik hot-reload.
2. Run:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" https://<name>.dev.lilnas.io
   ```
   - `200` or `302` → route is live (TLS cert may still be issuing on first hit — this is normal and resolves within seconds)
   - `502` → Traefik reached the container but it responded unexpectedly — check that the service is healthy
   - `404` → Traefik has no router for this host — check labels were applied correctly

3. Report to the operator:
   > ✅ `https://<name>.dev.lilnas.io` is live.
   >
   > - **Route:** gated by OAuth (`forward-auth`). To make it public, remove the `middlewares=forward-auth` label and run `docker compose up -d` again.
   > - **TLS cert:** shared `*.dev.lilnas.io` wildcard cert (DNS-01, managed by the production Traefik) — no per-host cert is issued. Router must use `tls=true`, not `tls.certresolver=le`, to use it.
   > - **Dashboard:** active routes are visible at `https://traefik.lilnas.io`.
   > - **Teardown:** `docker compose down` in `<project-path>` removes the route within ~1 second.

---

## Refusal conditions

Refuse and stop (before any file write or command) when:
- The target path contains `lilnas/infra/proxy.yml`, any `lilnas/apps/*/deploy.yml`, or any path under the lilnas monorepo root — **the production stack is never the target**.
- The runtime is not Docker Compose (no compose file found).
- The operator-chosen `<name>` is reserved or RFC-1123-invalid and the operator does not correct it.
- The compose file is structurally invalid (YAML parse error).
