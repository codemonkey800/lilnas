# HMR / WebSocket Configuration Reference

When a dev server runs behind a TLS-terminating reverse proxy (Traefik), Hot Module Replacement (HMR) WebSockets break by default because:
- The browser dials `wss://<host>:443`
- The dev server defaults to `ws://localhost:<internal-port>`
- The dev server also validates the `Host` header and may reject requests from non-localhost origins

These config snippets fix both issues for the relevant frameworks. Apply them to the **external project** — never to the lilnas monorepo.

---

## Vite (v7.x — tested against v7.1.9)

```js
// vite.config.ts (or .js)
export default {
  server: {
    host: '0.0.0.0',                         // bind all interfaces, not just localhost
    allowedHosts: ['.dev.lilnas.io'],         // permit requests from *.dev.lilnas.io (CVE-2025-24010)
    hmr: {
      protocol: 'wss',                        // use secure WebSocket
      host: '<name>.dev.lilnas.io',           // your exposed subdomain
      clientPort: 443,                        // Traefik's public HTTPS port
    },
  },
}
```

**Note for Vite v8+:** The `server.hmr` namespace moves to `server.ws`:

```js
// vite.config.ts — v8+
export default {
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.dev.lilnas.io'],
    ws: {
      protocol: 'wss',
      host: '<name>.dev.lilnas.io',
      clientPort: 443,
    },
  },
}
```

Check your installed Vite version (`cat package.json | grep '"vite"'`) to pick the right namespace. The `server.hmr` path works through at least v7.1.9; use `server.ws` for v8+.

---

## Next.js (v15.x — tested against v15.5.4)

```js
// next.config.ts (or .js)
const nextConfig = {
  allowedDevOrigins: ['dev.lilnas.io', '*.dev.lilnas.io'],
}

export default nextConfig
```

`allowedDevOrigins` was introduced in the 15.2.x line. HMR WebSocket coordinates are derived from the page origin automatically — no client-port knob needed. Using a real domain (`.dev.lilnas.io`) sidesteps the `*.localhost` pattern, which many browsers restrict.

---

## Sanity check

After applying the config and running `docker compose up`, open browser DevTools → Network → WS to confirm:
- The WebSocket connection URL shows `wss://<name>.dev.lilnas.io:443/...`
- The connection status is `101 Switching Protocols` (not failed/pending)
- HMR updates propagate without a full page reload
