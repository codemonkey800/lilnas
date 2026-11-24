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

### 2026-11-23 · T2 · done
Removed job `idkwiw`; added job `minio-bucket` (metrics_path /minio/v2/metrics/bucket, target storage:9000) after `minio`. Not deployed; it goes live when this reaches main.
Observed in the live endpoint (docker exec lilnas-prometheus-1 wget http://storage:9000/minio/v2/metrics/bucket). Labels: all series carry `server="127.0.0.1:9000"`. Bucket-labelled series have `bucket`; request series also have `api`.
Buckets in usage series: build, equations, files, images, videos.
Values at observation time:
- minio_bucket_usage_total_bytes: build 8.37e9, files 5.22e6, images 28324, equations 0, videos 0.
- minio_bucket_usage_object_total: build 628, files 3, images 1, equations 0, videos 0.
Usage families (one series per bucket, 5 each): minio_bucket_usage_total_bytes, minio_bucket_usage_object_total, minio_bucket_usage_version_total, minio_bucket_usage_deletemarker_total.
Note: minio_bucket_usage_last_activity_nano_seconds has a single series with no bucket label.
Traffic and request families, per bucket (only buckets with activity appear; observed for build and videos): minio_bucket_traffic_received_bytes, minio_bucket_traffic_sent_bytes, minio_bucket_requests_total{api,bucket}, minio_bucket_requests_4xx_errors_total{api,bucket}, minio_bucket_requests_inflight_total, minio_bucket_requests_ttfb_seconds_distribution.
Distribution families: minio_bucket_objects_size_distribution, minio_bucket_objects_version_distribution.
Replication families (all essentially zero, likely not worth panels): minio_bucket_replication_received_bytes, minio_bucket_replication_received_count, minio_bucket_replication_proxied_{get,head,get_tagging,put_tagging,delete_tagging}_requests_{total,failures}.
The minio_bucket_* series are not in Prometheus yet. The dashboard task should treat them as observed in the endpoint but not yet scraped, and depends on this scrape job being deployed.
check-dashboards.mjs does not exist in this branch, and no dashboards were touched.

### 2026-11-23 · T8 · done
Service `smartctl-exporter` (prometheuscommunity/smartctl-exporter:v0.15.0, privileged, user root) and scrape job `smartctl` (smartctl-exporter:9633, scrape_interval 60s) added. Not deployed.
Deliberate difference from the task body: added `/dev:/dev:ro`. Without it a privileged container's /dev is a start-time tmpfs snapshot (mountinfo: tmpfs), so a device that appears or re-enumerates later would not be seen by the 10-minute rescan; with it /dev is the live host devtmpfs. Inferred from the mount type, not tested with a real hot-plug. With the mount the exporter still sees 13 devices with the same sdd-only warnings.
Throwaway observations: smartctl_devices 13 (sda-sdh, nvme0-nvme4). Only log warning is sdd: exit status 64, "device error log contains records of errors". sdd error_log_count{error_log_type="summary"} 392, smartctl_exit_status 64. Everything else exit 0, smart_status 1. 8 HDDs at 7200 rpm, 5 Samsung 990 PRO 4TB.
Families (non go_/process_): smartctl_devices, smartctl_device, smartctl_device_attribute, available_spare, available_spare_threshold, block_size, bytes_read, bytes_written, capacity_blocks, capacity_bytes, critical_warning, error_log_count, interface_speed, media_errors, num_err_log_entries, nvme_capacity_bytes, percentage_used, power_cycle_count, power_on_seconds, rotation_rate, smart_status, smartctl_exit_status, temperature (temperature_type=current|op_limit_max|critical_limit_max), smartctl_exporter_build_info, smartctl_version.
smartctl_device labels: ata_additional_product_id, ata_version, device, firmware_version, form_factor, interface, model_family, model_name, protocol, sata_version, scsi_product, scsi_revision, scsi_vendor, scsi_version, serial_number.
smartctl_device_attribute labels: attribute_flags_long, attribute_flags_short, attribute_id, attribute_name, attribute_value_type (raw etc.), device. HDD-only (608 series). attribute_name values: Raw_Read_Error_Rate, Throughput_Performance, Spin_Up_Time, Start_Stop_Count, Reallocated_Sector_Ct, Seek_Error_Rate, Seek_Time_Performance, Power_On_Hours, Spin_Retry_Count, Power_Cycle_Count, Power-Off_Retract_Count, Load_Cycle_Count, Temperature_Celsius, Reallocated_Event_Count, Current_Pending_Sector, Offline_Uncorrectable, UDMA_CRC_Error_Count, Unknown_Attribute (all 8 HDDs); Helium_Level (6 HDDs); NAND_Master (2 HDDs). NVMe health comes via the dedicated smartctl_device_* families, not smartctl_device_attribute.
Powermode-check left at default standby. Throwaway containers mon-rig-smartctl and mon-rig-smartctl-dev removed (docker ps -a --filter name=mon-rig- => 0). No dashboards touched, so no live summary; check-dashboards.mjs does not exist yet in this worktree. All five checks pass.

### 2026-11-23 · T1 · done
Usage: `node infra/monitoring/scripts/check-dashboards.mjs lint|live [--range 24h] [--var name=value ...] [files]`. With no files it uses every json in infra/monitoring/grafana/provisioning/dashboards/json/. Exit 0 ok, 1 problems/EMPTY/ERROR, 2 usage error.
Output per panel: `OK <n> series`, `EMPTY`, `EMPTY (event-driven)`, `ERROR <msg>`, followed by indented `target X empty: <expr>` lines; each dashboard ends with a one-line count summary. Query-variable checks print as `variable <name>`.
Deliberate differences from the task text: (1) `type: text` panels are exempt from the title/datasource/expr lint rules; (2) a textbox with an empty-string current.value substitutes "" (what Grafana does), `.*` only if no current is set; (3) a query variable that returns no values counts as plain EMPTY and fails the run.
Base-state findings for later tasks: lint passes on all 9; live fails on base with EMPTY panels in download (6), equations (10), service-detail (1), services-overview (1), storage (5, the MinIO bucket panels #45-#49), tdr-bot (7), traefik (2), plus one ERROR: equations.json #42 "Errors and Warnings" uses an invalid LogQL `... or {service=...}` (Loki returns 400). Equations OK panels are mostly `or vector(0)` or the equations_active_jobs gauge.
Tests: `node --test infra/monitoring/scripts/` (59 tests, fake runner, no docker). Runner signature is `run(cmd, argsArray) => Promise<stdoutString>`, passed as `{ run }` to checkLive/main.
No throwaway containers or temp files were created (the /tmp output file I used was removed).

### 2026-11-23 · T9 · done
Services/ports: exportarr-sonarr:9707, exportarr-radarr:9708, exportarr-sabnzbd:9709 (compose network only). Prometheus jobs are named sonarr, radarr, sabnzbd (60s interval) and do not exist live until deployed, so dashboards using them will be empty until then.
Env var for v2.3.0 is APIKEY (confirmed: missing => "ApiKey is required to not be empty"). No Dockerfile/shell in the image, so only env_file + literal URL/PORT.
Deliberate differences: (1) ENABLE_ADDITIONAL_METRICS is NOT set on Sonarr or Radarr. Sonarr: adds sonarr_episode_{monitored,unmonitored,quality}_total (labels quality, weight) but scrape went 163 ms -> 1291 ms (per-series requests, scales with library). Radarr: adds no new families (143 ms either way). A comment in monitoring.yml records this. (2) `pnpm lilnas secrets verify` has no --keys flag; ran it without; it passed with ok for all three exportarr files.
`secrets decrypt` only discovers git-tracked files, so I `git add`ed the new env files before decrypting.
.env.keys at /home/jeremy/lilnas/.env.keys gained DOTENV_PRIVATE_KEY_EXPORTARR-SONARR / -RADARR / -SABNZBD; the deploy host needs the updated key file before this deploys (deploy decrypts before compose config).
Metric families observed in throwaway scrapes (lilnas_default, read via lilnas-prometheus-1):
sonarr_{series,season,episode}_*, sonarr_history_total, sonarr_rootfolder_freespace_bytes{path}, sonarr_system_health_issues{message,source,type,wikiurl}, sonarr_system_status, sonarr_scrape_duration_seconds;
radarr_movie_{total,monitored,unmonitored,downloaded,missing,wanted,cutoff_unmet,editions,filesize_total}, radarr_movie_quality_total{quality,weight}, radarr_movie_tag_total{tag}, radarr_history_total, radarr_rootfolder_freespace_bytes{path}, radarr_system_health_issues, radarr_system_status;
sabnzbd_{queue_length,speed_bps,remaining_bytes,total_bytes,paused,paused_all,status,quota_bytes,remaining_quota_bytes,time_estimate_seconds,pause_duration_seconds,queue_warnings,article_cache_*,disk_total_bytes{folder},disk_used_bytes{folder},downloaded_bytes,info{status,version},server_articles_success{server},server_articles_total{server},server_downloaded_bytes{server},*_query_duration_seconds}; all carry `url`; exportarr_app_info{app_name,build_time,revision,version}. Counters: sabnzbd_downloaded_bytes, sabnzbd_server_*.
Throwaway cleanup: 5 containers mon-rig-exportarr-{sonarr,radarr,sabnzbd,sonarr-extra,radarr-extra} removed; `docker ps -a --filter name=mon-rig-` shows 0; temp files in /tmp removed.
Checks: dashboard uid/tag jq loop OK; promtool check config SUCCESS; compose config -q for monitoring.yml, immich.yml and docker-compose.yml OK; prettier -c passes; jest 3 suites / 99 tests pass (--maxWorkers=2).

### 2026-11-23 · T4 · done
Panel count before -> after: 39 non-row panels in 9 rows (48 entries including rows) -> 13 panels in 5 rows (18 entries). Default range now-7d, refresh 5m. uid lilnas-tdr-bot, requestId textbox, id null kept; added the single lilnas dashboards link (asDropdown).
lint: ok. live --range 7d: lilnas-tdr-bot: 12 OK, 0 EMPTY, 1 EMPTY (event-driven), 0 ERROR. The only EMPTY panel is #17 Errors and Warnings (Event-driven: description).
Metrics: tdr_bot_llm_schema_failures_total exists live only as a registered family in tdr-bot:8081/metrics (HELP/TYPE), no series yet, so its target uses `or vector(0)`. llm_retries_total and image_generations_total had series historically (400d series query) but none in the last 30d; their targets are empty live, in panels that also carry non-empty targets. All other families have live series.
Deliberate differences: (1) Errors and Warnings now filters level=~"40|50|60|warn|warning|error|fatal" because tdr-bot's Loki level label is pino numeric (live value "30"); the old error|warn filter could never match. (2) Recent Logs excludes /metrics scrape lines. (3) Success rate falls back to 100 (not 0) when no requests.
Checks: uid/tags loop, promtool, compose config, prettier and jest (3 suites, 99 tests) all pass. No throwaway containers; the /tmp generator was removed.
