---
nexus-plan: 2
title: 'Grafana overhaul: clean up the dashboards, add exporters, build five new dashboards'
branch: feat/grafana-dashboard-overhaul
base: main
setup:
  - pnpm install --frozen-lockfile
checks:
  - d=infra/monitoring/grafana/provisioning/dashboards/json; for f in $d/*.json; do jq -e '(.uid|startswith("lilnas-")) and ((.tags//[])|index("lilnas")!=null) and ((.title//"")|length>0)' "$f" >/dev/null || { echo "bad $f"; exit 1; }; done; test -z "$(jq -r .uid $d/*.json | sort | uniq -d)"
  - docker run --rm -v "$PWD/infra/monitoring/prometheus.yml:/p.yml:ro" --entrypoint promtool prom/prometheus:v3.15.0 check config /p.yml
  - docker compose -f infra/monitoring.yml config -q --no-env-resolution && docker compose -f infra/immich.yml config -q --no-env-resolution
  - pnpm exec prettier -c infra/monitoring infra/monitoring.yml CLAUDE.md docs/logging.md docs/deploy.md
  - pnpm --filter @lilnas/cli exec jest src/utils/__tests__/compose-include-env.spec.ts src/utils/__tests__/ci-detect.spec.ts src/utils/__tests__/secrets.spec.ts --maxWorkers=2
parallel: 3
review: per-phase
commit-style: 'conventional, scope required, e.g. feat(monitoring): …, chore(monitoring): …, docs(monitoring): …'
---

# Grafana overhaul: clean up the dashboards, add exporters, build five new dashboards

## Goal
Grafana at `https://grafana.lilnas.io` has 9 file-provisioned dashboards. An audit on 2026-11-23
found about half of them empty or measuring the wrong thing (Prometheus scraping the apps counted
as user traffic, MinIO bucket panels with no series, totals that add HDDs, SSDs and `/boot`
together), one dead scrape target, and no view of disk health, security events, the media stack
or Postgres.

After this run there are 11 dashboards, each panel checked against live data:

| Dashboard | File | uid | Change |
|---|---|---|---|
| Overview (Grafana home) | `overview.json` | `lilnas-overview` | new |
| Infrastructure | `infrastructure.json` | `lilnas-infrastructure` | small fix |
| Storage | `storage.json` | `lilnas-storage` | fixed |
| Disk Health | `disk-health.json` | `lilnas-disk-health` | new |
| Traefik | `traefik.json` | `lilnas-traefik` | kept |
| Security | `security.json` | `lilnas-security` | new |
| App Detail | `app-detail.json` | `lilnas-app-detail` | replaces Download, Equations, Service Detail |
| TDR Bot | `tdr-bot.json` | `lilnas-tdr-bot` | trimmed |
| Media Stack | `media.json` | `lilnas-media` | new |
| Postgres | `postgres.json` | `lilnas-postgres` | new |
| Logs | `logs.json` | `lilnas-logs` | kept |

Services Overview is deleted. New exporters: smartctl_exporter, exportarr for Sonarr, Radarr and
SABnzbd, postgres_exporter for the three Postgres servers, Immich's built-in telemetry, and a
second MinIO scrape job for bucket metrics.

The run ships in two pushes to `main`, each behind a human go/no-go. Alerting is out of scope.

## Decisions
- **Cleanup as audited** (Jeremy, 2026-11-23): delete Services Overview; merge Download, Equations
  and Service Detail into App Detail with an `$app` variable; trim TDR Bot to cost, errors,
  latency and logs; fix Storage; remove the dead `idkwiw` job. Infrastructure, Traefik and Logs
  stay.
- **Five new dashboards**: Security (Loki only), Disk Health, Media Stack, Postgres, Overview as
  the Grafana home.
- **Two pushes** (Jeremy, 2026-11-23). Push 1: cleanup, Security, Overview and every exporter.
  Push 2: Disk Health, Media Stack, Postgres, the Overview additions and docs. Chosen over three
  pushes; the cleanup can only be reviewed in the deployed Grafana anyway.
- **An agent pushes after a human approves**, as in plan 018. Rollbacks are done by a human (the
  agent has no sudo).
- **The agent creates the Postgres monitoring roles** after the push-1 go/no-go (Jeremy,
  2026-11-23): role `lilnas_monitor`, member of `pg_monitor`, one shared password, in tdr-bot-db,
  icloud-backup-db and immich-database. Download and auth use SQLite, so there is no fourth
  server.
- **Immich telemetry on** (Jeremy, 2026-11-23). If the setting can't be confirmed for v3.3.4 the
  task leaves Immich alone and Media Stack uses Traefik and cAdvisor only.
- **Secrets in four new dotenvx files**: `infra/.env.exportarr-{sonarr,radarr,sabnzbd}` (one
  `APIKEY` each) and `infra/.env.postgres-exporter`. One file for all would need a shell wrapper
  to rename variables, and the exportarr image has no shell. A `${VAR}` in the compose file would
  need an `env_file` on the include in the root `docker-compose.yml`, and touching that file
  redeploys everything. Mounting Sonarr's `config.xml` was ruled out: keys go in encrypted files.
- **All exporters live in `infra/monitoring.yml`**, so `infra/media.yml` is untouched and the
  media containers are not restarted.
- **Custom provisioned JSON**, not community dashboard imports. No Alertmanager, no change to the
  Prometheus/Loki stack.

## Context
- Monitoring config: services in `infra/monitoring.yml` (included by the root
  `docker-compose.yml`), scrape jobs in `infra/monitoring/prometheus.yml`, dashboards in
  `infra/monitoring/grafana/provisioning/dashboards/json/*.json` (classic JSON model,
  `schemaVersion` 39, Grafana 13.2.4). Datasource uids: `prometheus`, `loki`. Log labels and
  queries: `docs/logging.md`.
- Dashboard rules: `uid` `lilnas-<name>`, tag `lilnas`, top-level `id: null`, one dashboard link
  of type `dashboards` with tag `lilnas` (`asDropdown: true`). Copy panel JSON style from
  `storage.json`. A panel that can be empty for a legitimate reason has a `description` starting
  `Event-driven:` that says what makes data appear.
- This machine is production. Read-only access to live data:
  `docker exec lilnas-prometheus-1 wget -qO- 'http://localhost:9090/api/v1/query?query=<urlencoded>'`
  and, for Loki and the Grafana API,
  `docker exec lilnas-grafana-1 wget -qO- --header 'X-Forwarded-User: admin@local' 'http://localhost:3000/api/datasources/proxy/uid/loki/loki/api/v1/query_range?query=<urlencoded>&since=24h&limit=5'`.
  Once it exists, `node infra/monitoring/scripts/check-dashboards.mjs lint|live <files>` does
  this for every panel; put its `live` summary in your result.
- Production is compose project `lilnas`, run from `/opt/lilnas`, deployed only by pushing to
  `main` (`docs/deploy.md`). A change under a bind-mounted path (`prometheus.yml`, the
  `grafana/provisioning` tree) force-recreates that service; a changed `infra/<name>.yml` runs
  `up -d` for its services. Never run `docker compose up/down/restart/pull` against project
  `lilnas`, never push unless your task says to. Allowed: `docker compose -p lilnas ps|logs`,
  `docker inspect`, `docker logs`, the read-only queries above, and what your task names.
- Throwaway containers: name prefix `mon-rig-`, no published ports, removed before you finish;
  show the cleanup in your result.
- Never write `${VAR}` in `infra/*.yml`: Compose would interpolate it from the encrypted
  `infra/.env` (`compose-include-env.spec.ts` fails). Secrets reach a container through
  `env_file: .env.<name>.decrypted` only. Pin every image to a version tag.
- Secrets: the key file is `/home/jeremy/lilnas/.env.keys`; pass it as `-fk` to dotenvx and
  `--keys` to `pnpm lilnas secrets decrypt|verify`. Never print or commit a key, password, API key
  or `*.decrypted` file; never pass one on a command line.
- Prettier covers `infra/monitoring/**`, `infra/monitoring.yml` and the docs; run
  `pnpm exec prettier -w <file>` on what you edit. `infra/immich.yml` fails Prettier at base: match
  its style, don't reformat it.
- Jest only with `--maxWorkers=2`, one run at a time. Report what you can't fix as `defects:`.

## Done means
- The task's files, names (uids, job names, service names, ports, labels) and edge cases are as
  its body says; a deliberate difference is stated in the result with the reason.
- All `checks:` pass.
- Every dashboard the task created or edited passes
  `node infra/monitoring/scripts/check-dashboards.mjs lint`, and the result includes the `live`
  summary for it. Every panel `live` reports empty has an `Event-driven:` description, or the
  result names the not-yet-deployed scrape job it waits for.
- No panel query uses a metric or label that was not observed in live data or in a scrape of a
  throwaway exporter; the result says where each new metric family was observed.
- Every new image is pinned to a version tag; no `${...}` appears in `infra/*.yml`; no new
  Traefik router or published port is added.
- No secret value appears in the diff, the result or a command line. Committed env files hold
  only `encrypted:` values and pass `pnpm lilnas secrets verify`.
- A task with `files: []` commits nothing. A task that pushes reports the pushed sha, the
  rollback sha, the CI run URL and each check with its observed value.
- Throwaway containers and temp files are shown removed.
- No alert rule, contact point or Alertmanager config is added.

## Planner notes
Research on 2026-11-23 at `main` e5d9cdae (equal to `origin/main`). Audit chat: Nexus session
`021ef286-27f3-4f26-9732-bcc3e25ea670`.

- **Checks at base**: all five exit 0 in the main checkout. The compose check was also run in a
  temp dir with no `.decrypted` files: `--no-env-resolution` makes a missing `env_file` pass
  (without it compose exits 1). The Jest check runs 3 suites; `compose-include-env.spec.ts` reads
  the real compose files. `infra/media.yml`, `infra/immich.yml` and `infra/shared.yml` fail
  Prettier at base, so they are not in the Prettier check.
- **Live facts**: 10 scrape targets, `idkwiw` down (no such host). `http://storage:9000/minio/v2/metrics/bucket`
  answers without auth and has `minio_bucket_usage_total_bytes` and
  `minio_bucket_usage_object_total` for 5 buckets (build, equations, files, images, videos).
  node-exporter has `node_btrfs_device_errors_total` (labels `device`, `type`, `uuid`),
  `node_hwmon_temp_celsius` with `node_hwmon_chip_names` (`nvme`, `k10temp`, `amdgpu`,
  `gigabyte_wmi`), `node_disk_info{rotational}`, `node_nvme_info`, and the textfile metric
  `lilnas_storage_volume{name,mountpoint,volume}`. cAdvisor has `container_start_time_seconds`
  and `container_oom_events_total` for 47 named containers. Mounts: `/mnt/hdd1`–`8`, `/mnt/ssd1`–`4`,
  `/`, `/boot` (vfat).
- **smartctl_exporter v0.15.0** was run once as a throwaway (`--privileged --user root`, no
  volumes): 13 devices, `smartctl_device_smart_status`, `smartctl_device_temperature`,
  `smartctl_device_attribute` (Reallocated_Sector_Ct, Current_Pending_Sector,
  Offline_Uncorrectable, UDMA_CRC_Error_Count, …), NVMe `percentage_used`, `media_errors`,
  `available_spare`, `critical_warning`. It logged that `sdd` (hdd2) has records in its device
  error log and exits smartctl with status 64: worth a look on the Disk Health dashboard.
- **Images** (latest releases on 2026-11-23, all pulled on this host):
  `prometheuscommunity/smartctl-exporter:v0.15.0`, `ghcr.io/onedr0p/exportarr:v2.3.0` (entrypoint
  `/tini -- /exportarr`, user nonroot, no shell), `quay.io/prometheuscommunity/postgres-exporter:v0.21.1`
  (has `/bin/sh`).
- **Postgres**: `lilnas-tdr-bot-db-1` (PG 18.4, db `tdr_bot`, superuser from `POSTGRES_USER`),
  `lilnas-icloud-backup-db-1` (PG 18.4, db `icloud_backup`), `lilnas-immich-database-1` (PG 14 +
  VectorChord, db `immich`, user `postgres`, preloads `vchord.so, vectors.so`, so no
  `pg_stat_statements`).
- **Existing keys**: `apps/download/.env.prod` holds `SONARR_API_KEY`, `RADARR_API_KEY` and
  `SABNZBD_API_KEY`; the exportarr task copies them.
- **Loki**: `identifier` values include `sshd-session`, `sshd`, `sshguard`, `sudo`, `kernel`.
  sshd lines: `Accepted publickey for <user> from <ip>`, `Invalid user <name> from <ip>`,
  `Connection closed by invalid user …`. sshguard: `Attack from "<ip>" on service SSH with danger N.`
  sudo failures are logged at level `alert` with `a password is required`. The `auth` service
  logs pino JSON (numeric `level`).
- **Deploy mapping** (`packages/cli/src/utils/ci-detect.ts`): `infra/monitoring/scripts/**` is not
  under any bind mount, so scripts there recreate nothing. `/opt/lilnas/.env.keys` is readable by
  `deploy` only; `stat` works for a size comparison. The backup copy is
  `/storage/backups/lilnas-secrets/.env.keys`, writable by jeremy.
- **Not planned**: a Traefik "errors count 4xx" fix (Traefik is kept as is), valkey/redis metrics,
  Emby's own API metrics, alerting.
- No run model is set; tasks use the Start screen's choice. The planner ran on Fable at the
  user's request.

## Log
<!-- Written by Nexus: findings, review cycles, checkpoint verdicts, the final report,
     the rollout record. Humans may add notes here too. -->
