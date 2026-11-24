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

### 2026-11-23 · T5 · done
Edited storage.json and infrastructure.json only, uids unchanged. lint ok on both. Live: lilnas-storage 24 OK, 5 EMPTY, 0 EMPTY (event-driven), 0 ERROR; lilnas-infrastructure 18 OK, 0 EMPTY, 0 EMPTY (event-driven), 0 ERROR.
Panels waiting for the not-yet-deployed `minio-bucket` scrape job (deliberately not marked Event-driven): storage #45 Total Objects, #46 Total Bucket Usage, #47 Usage by Bucket, #48 Objects by Bucket, #49 Bucket Usage Over Time. Their queries carry job="minio-bucket", legend {{bucket}}; label names (bucket, server) checked against the live /minio/v2/metrics/bucket endpoint.
Storage: HDD (mountpoint=~"/mnt/hdd.*") and SSD (mountpoint=~"/mnt/ssd.*|/") groups, each Capacity/Used/Free/Used %, new panel ids 2,3,4,5 (HDD) and 7,8,9,11 (SSD) at y=1 and y=5 (w5 each); Mount Points Monitored (id 6) kept, now h8 w4 at x20. Everything below shifted down 4 rows. Inode Usage removed as the task replaced it. Per-mount panels and lilnas_storage_volume labelling untouched.
Infrastructure: gauge #4 renamed "Root disk usage"; new stat #11 "Fullest mount" (instant topk(1, ...) over fstype="btrfs", legend {{mountpoint}}, currently /mnt/hdd6 at 32.7%). CPU, Memory, Root disk gauges shrunk w4 to w3 to make room.
Metrics observed: node_filesystem_size_bytes/avail_bytes in live Prometheus; minio_bucket_usage_* in the MinIO bucket endpoint (not yet in Prometheus). Checks (uid/tag, promtool, compose config, prettier, jest 99 tests) all pass. No throwaway containers or temp files created.

### 2026-11-23 · T3 · done
Created app-detail.json (uid lilnas-app-detail, tags lilnas+apps, id null); deleted download, equations, service-detail, services-overview. Variables: app (query label_values(nodejs_heap_size_used_bytes, job), default tdr-bot), search (textbox). Rows: Summary (6 stats), Node.js runtime (5), HTTP real traffic (5, route!="/metrics", only 5xx = error), collapsed Download (7) and Equations (6), Logs (volume + logs). Links: one `dashboards` dropdown on tag lilnas plus a `link` to /d/lilnas-tdr-bot.
Deliberate differences: default time range now-24h (not 1h) so $__range stats are meaningful; Up uses sum(up{job="$app"}) or vector(0) (bare `or vector(0)` yields a second series); tdr-bot link is type `link` since `dashboards` type is tag-based.
Live summary (check-dashboards.mjs live --var app=X): tdr-bot 23 OK / 0 EMPTY / 9 event-driven / 0 ERROR; equations 23/0/9/0; download 25/0/7/0; me-token-tracker 23/0/9/0. Summary and Node.js runtime rows OK for all four apps. Every EMPTY panel has an `Event-driven:` description.
Metric provenance: live in Prometheus: up, process_*, nodejs_*, http_requests_total, http_request_duration_seconds_bucket, download_jobs_in_progress/queued, equations_active_jobs, equations_rate_limited_total. 30-day history: download_jobs_created_total, download_jobs_completed_total, download_job_phase_duration_seconds_*, download_ytdlp_updates_total. Never recorded: equations_compilations_total, equations_validation_failures_total, equations_compilation_duration_seconds; observed as HELP/TYPE lines on live http://equations:8080/metrics, labels (status/reason/phase) from labelNames in apps/equations/src/equations-metrics.service.ts. Those panels wait for the first compilation.
All five plan checks pass (jest 99 tests). No stale references to the deleted uids outside docs/plans and docs/archive. No containers created; temp generator dir /tmp/mon-gen-t3 removed.

### 2026-11-23 · T11 · done
Variable IMMICH_TELEMETRY_INCLUDE=all confirmed for v3.3.4 in the running container's server bundle (server/dist/dtos/env.dto.js and repositories/config.repository.js); the container was not changed. The docs site was not fetched. The container's current telemetry env count is 0. Ports are 8081 (api) and 8082 (microservices) by default.
Prometheus job `immich` has two targets, immich:8081 (component: api) and immich:8082 (component: microservices), default /metrics.
Expected metric prefix: `immich_` for the metrics Immich names itself (e.g. immich_<repo>_<method>_duration_milliseconds with the `repo` group). Immich also adds OpenTelemetry HTTP metrics (http_server_*) and `host` group metrics. Histograms are in ms.
Nothing was observed live: no immich_* series exist until the deploy restarts Immich. The Media Stack dashboard task must not use specific immich_* metric or label names until a scrape of both ports exists after deploy. Until then the `immich` job shows as down.
The machine-learning container exposes no metrics endpoint and has no telemetry variables; telemetry was not enabled there.
All five plan checks pass, including the Jest run (99 tests passed). Nothing deployed or pushed. No throwaway containers or temp files were created.

### 2026-11-23 · T7 · done
Overview dashboard: uid lilnas-overview, tags lilnas+overview, 19 panels, no rows, about 17 grid units tall so it fits 1080p. Every panel has panel links and data links by uid only (/d/<uid>) to lilnas-infrastructure, -storage, -traefik, -security, -app-detail, -tdr-bot and -logs. Nothing links to disk-health, media or postgres; a later task adds those.
Home page: GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH added to the grafana service in infra/monitoring.yml, name confirmed against the Grafana v13.2.4 docs ([dashboards] default_home_dashboard_path). Nothing else changed in that file. An org or user home-dashboard preference would override it.
Live summary: lilnas-overview: 18 OK, 0 EMPTY, 1 EMPTY (event-driven), 0 ERROR. The event-driven panel is "Container restarts in 24h" (no restarts in the last 24h) and its description starts with "Event-driven:". The "Targets that are down" table shows a real row today (idkwiw:8080 is down) and uses noValue "none" for the empty state.
Deliberate differences: (1) "Scrape targets up / total" is one stat with two named values (up, total) rather than a single "9 / 10" string. (2) Host load is shown per core (node_load5 / on() count(count by (cpu)(node_cpu_seconds_total)); thresholds 1 and 2) because the host has 32 cores. (3) SSH failed attempts count "Failed (password|publickey)|Invalid user"; plain "Failed" matched 0 lines in the last 24h. (4) Top-5xx-services is also an event-driven bar gauge, with an Event-driven: description, besides the restarts gauge and the down-targets table.
Metrics observed live (none new): up, node_btrfs_device_errors_total, lilnas_storage_volume, node_filesystem_*{fstype="btrfs"}, traefik_tls_certs_not_after, traefik_service_requests_total, container_last_seen, container_start_time_seconds, tdr_bot_llm_cost_usd_total, node_cpu/memory/load, Loki {service="host", identifier="sshd-session"}.
Checks: all 5 pass (uid/tag/title jq, promtool, compose config for monitoring and immich, prettier, jest 3 suites/99 tests); node --test infra/monitoring/scripts/ also passes. No containers or temp files left (the /tmp generator script was removed).

### 2026-11-23 · T6 · done
Dashboard uid lilnas-security (Security), Loki only, default range 24h, textbox var `ip` (default empty). 35 panels in rows SSH, sshguard, sudo, Web, Auth logins, Investigate an IP.
lint: "lint ok: 1 dashboards". live --range 24h summary: "lilnas-security: 19 OK, 0 EMPTY, 10 EMPTY (event-driven), 0 ERROR". Every empty panel has an Event-driven: description.
Timing through the Grafana proxy (instant for stats/top-N, query_range for time series and logs): all targets succeed at 24h and 7d; slowest at 7d is "Probes that did not get an error back" 5.0 s (one cold run of "Sign-in callbacks" took 4.4 s). Nothing over 10 s.
One query failed at 7d and was simplified: "Top paths by 4xx/5xx" hit Loki's 500-series limit with full paths (and with two path segments). It now groups by the first path segment only and only counts requests that matched a router (|~ "\"RouterName\":"); titled "(first segment)", description explains it. Unknown-host scans appear in "Errors by hostname".
Auth logins choice: completed = access-log GET /api/auth/callback/* at auth.lilnas.io with DownstreamStatus=302; rejected = access-log request to /login?error=<code> at auth.lilnas.io (failed OAuth callbacks redirect there, so the callback status alone cannot tell them apart; one real state_not_found seen). Also an OIDC gate denial stat from the auth service's OidcGate warnings ("authorize denied" / "token/userinfo denied", none in live data) and a warn/error (level 40/50) stat and logs panel from {service="auth"}. Callback paths are shown without query strings (no code/state); the auth service panel shows only level/context/msg/response status.
Extra over spec: "User not in AllowUsers" series and a "not allowed because" term in the failed-attempts stat/top IPs/top usernames (a dominant real pattern). Top usernames excludes jeremy; top IPs excludes ::1.
The scanner-probe query from docs/logging.md is used unchanged; it matches ".git" inside nexus-code's "gitStatus" tRPC calls, so those appear under "Probes that did not get an error back" (noise, not a bug).
The Investigate an IP panel uses three targets (access log by ClientHost, sshd lines by " $ip port ", sshguard lines by "\"$ip\""); with ip empty all three match nothing.
Dashboard has the dashboards link (tag lilnas, asDropdown). No metrics were used (Loki only). No throwaway containers or temp files left; mon-rig-pg* containers listed by docker ps belong to other tasks.

### 2026-11-23 · T10 · done
Script: `infra/monitoring/scripts/postgres-monitor-roles.sh [--dry-run] [--drop] <decrypted env file>`. NOT run against production. The later task must run `pnpm lilnas secrets decrypt` (keys at /home/jeremy/lilnas/.env.keys) to get `infra/.env.postgres-exporter.decrypted`, then run it with the file path, and check `pg_up` for job=postgres afterwards. `--drop` is the rollback.
Deliberate difference: the script also does `ALTER ROLE lilnas_monitor SET default_transaction_read_only = on`, because on PG14 (immich) PUBLIC can CREATE in schema public, so the role could create a table otherwise. Verified CREATE TABLE fails on PG14 and PG18 and the exporter works with it.
`pnpm lilnas secrets verify` takes no `--keys` flag and only checks git-tracked files; it reported `ok infra/.env.postgres-exporter` after the commit.
Exporter (quay.io/prometheuscommunity/postgres-exporter:v0.21.1) observed on throwaway PG14.19 (immich image) and PG18.4: pg_up 1; default-enabled collectors database, locks, replication, replication_slots, roles, settings, stat_activity, stat_archiver, stat_bgwriter, stat_database, stat_progress_vacuum, stat_replication, stat_user_tables, statio_user_tables, wal, all success=1 on both. Enabled via `command:` on all three services: --collector.long_running_transactions (adds pg_long_running_transactions, pg_long_running_transactions_oldest_timestamp_seconds; verified non-zero with a held transaction on both) and --collector.stat_activity_autovacuum (collector succeeds on both but emitted no samples in my run, so its metric names were NOT observed: do not use them in a panel until seen live). stat_statements collector left off.
Observed metric families usable in panels (rig scrape): pg_up, pg_database_size_bytes, pg_stat_database_{numbackends,xact_commit,xact_rollback,blks_hit,blks_read,tup_*,deadlocks,temp_bytes,temp_files,conflicts}, pg_stat_activity_count, pg_stat_activity_max_tx_duration, pg_locks_count, pg_wal_size_bytes, pg_wal_segments, pg_settings_max_connections, pg_stat_bgwriter_* (differs between PG14 and PG18), pg_stat_archiver_*, pg_replication_*, pg_roles_connection_limit. Not live-observed: production returns pg_up 0 until the role exists.
Rig cleanup: 7 mon-rig containers, mon-rig-net, 3 anonymous volumes created by the rig (identified by creation time + anonymous label), /tmp/mon-rig-t10 all removed; verified none left.
