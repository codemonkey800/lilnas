# Naming Safety Reference

## Valid `<name>` Format (RFC 1123 DNS label)

`<name>` becomes the subdomain: `https://<name>.dev.lilnas.io`.

Requirements:
- Lowercase alphanumeric characters and hyphens only
- No leading or trailing hyphens
- Maximum 63 characters
- Must not be empty

Valid: `myapp`, `api-server`, `dev-backend`
Invalid: `-myapp`, `myapp-`, `My_App`, `a` × 64 chars, empty string

---

## Reserved Hostnames — NEVER use these as `<name>`

Any container on `lilnas-proxy` can register a Traefik router. **Traefik does not warn when two routers share the same `Host()` rule** — it silently picks the winner (longer rule wins; alphabetically-earlier router name wins on a tie). A careless `<name>` can silently shadow a production route.

**Forbidden `<name>` values** (would shadow existing production routers):

| Forbidden | Routes to |
|-----------|-----------|
| `traefik` | Traefik dashboard (`traefik.lilnas.io`) |
| `auth` | OAuth forward-auth service (`auth.lilnas.io`) |
| `portal` | Main portal app |
| `equations` | LaTeX rendering service |
| `me-token-tracker` | Crypto tracker |
| `download` | Download service |
| `yoink` | Media management |
| `dashcam` | Dashcam viewer |
| `macros` | Macros app |
| `tdr-bot` | TDR bot admin |
| `prometheus` | Prometheus metrics |
| `grafana` | Grafana dashboards |

Additionally, avoid names that look like other services or reserved subdomains (`admin`, `api`, `www`, `mail`, etc.) to prevent future conflicts.

---

## Router-Name Safety

All external routers **must use a unique prefix** in the router name to avoid conflicts with production routers. The convention is `dev-<name>`:

```yaml
# Good — prefixed, no conflict with production routers
- traefik.http.routers.dev-myapp.rule=Host(`myapp.dev.lilnas.io`)
- traefik.http.services.dev-myapp.loadbalancer.server.port=3000

# Bad — unprefixed, could silently conflict with a production router
- traefik.http.routers.myapp.rule=Host(`myapp.dev.lilnas.io`)
```

**Optional extra safety:** Pin a lower `priority` on external routers so any production router on the same hostname always wins:

```yaml
- traefik.http.routers.dev-myapp.priority=1
```

Production routers default to priority 0 in Traefik unless explicitly set; Traefik resolves ties by alphabetical router name. Using a very low priority (e.g. `1`) does not actually guarantee wins over default-priority production routers. The most reliable guard is **not using a reserved name**.

---

## DNS Note

`*.dev.lilnas.io` resolves to the NAS public IP via the existing `*.lilnas.io` wildcard DNS record — **no DNS change is needed**.

**Warning:** If any explicit DNS record is added under the `dev` subdomain (e.g. an `A` record for `dev.lilnas.io`), the `*.lilnas.io` wildcard **stops covering `*.dev.lilnas.io`**. In that case, an explicit `*.dev` wildcard CNAME must be added to restore coverage.
