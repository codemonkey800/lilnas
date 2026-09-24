# Prometheus secrets

Everything in this directory except this README is gitignored. The
`prometheus` service in `infra/monitoring.yml` mounts it read-only at
`/etc/prometheus/secrets`.

## `nexus-metrics-token`

Bearer token Prometheus sends when scraping the nexus-code daemon's
`/__nexus/metrics` endpoint (job `nexus-code` in `prometheus.yml`).

- Contents: the raw token and nothing else. A trailing newline is fine
  either way, since Prometheus trims it.
- Value: must match `NEXUS_METRICS_TOKEN` in nexus-code's `.env`.
- Permissions: mode `0600`, owned by uid/gid `65534` (`nobody`). The
  Prometheus container runs as `nobody`, so a `0600` file owned by your
  own user is unreadable to it and every scrape fails.

Generate and install it:

```sh
openssl rand -hex 32 > infra/monitoring/secrets/nexus-metrics-token
chmod 600 infra/monitoring/secrets/nexus-metrics-token
sudo chown 65534:65534 infra/monitoring/secrets/nexus-metrics-token
```

Then set `NEXUS_METRICS_TOKEN` to the same value in nexus-code's `.env`.
Prometheus reads the file on every scrape, so rotating the token only
needs the file rewritten, not a restart.
