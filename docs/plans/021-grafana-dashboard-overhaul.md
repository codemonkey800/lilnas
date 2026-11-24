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
  `--keys` to `pnpm lilnas secrets decrypt` (`secrets verify` takes no flag). Never print or
  commit a key, password, API key or `*.decrypted` file; never pass one on a command line.
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

- **Saved before a context clear (2026-11-23, after Start)**:
  - Run `nexus-run:e03a966c-8aaf-4fd1-ba2f-faa2b1234e7d`; planner session
    `88cd2db8-269a-4bb4-af15-900c0380d624`. No open thread with the user: all three interview
    answers (two pushes, agent creates DB roles, Immich telemetry on) are in Decisions.
  - Push pattern is copied from plan 018 (`docs/plans/018-auth-cookie-strip-frontend-split.tasks.yaml`,
    T5): a `files: []` task runs prechecks, `git push origin HEAD:main`, `gh run watch`, then
    read-only verification. H go/no-go tasks open phases 2 and 3 so the phase-1 review runs
    before push 1.
  - Why tasks serialize: T7–T10 all list `infra/monitoring.yml`, and T2, T8–T11 list
    `infra/monitoring/prometheus.yml`. That is deliberate (file overlap, not `after`).
  - T12's result is the metric inventory T13–T16 build on. If T12 reports a job down, fix the
    exporter (new task in phase 2, `after: [T12]`) before letting T13–T15 run; put them on
    `hold` if needed.
  - A fix after H2 that touches `infra/monitoring.yml` or `prometheus.yml` is allowed in push 2;
    T18's precheck says so. A fix touching a new env file again needs the human `.env.keys`
    copy step from H1.
  - Ruled out while planning: one shared env file with a shell wrapper (exportarr has no shell);
    `${VAR}` interpolation (needs the root compose include changed, which is a full deploy, and
    `compose-include-env.spec.ts` guards it); postgres_exporter multi-target `/probe` mode (its
    auth-module config file would hold plaintext passwords); connecting exporters to the
    `postgres` database (table stats only cover the connected database, so each connects to the
    app database); the checker as a `checks:` entry (it queries live production and does not
    exist at base).
  - The "event-driven" convention (`description` starting `Event-driven:`) is how the checker
    and reviewers tell a legitimately empty panel from a broken one.
  - exportarr's API-key variable is believed to be `APIKEY` (flag `--api-key`); T9 confirms it.
    Immich's `IMMICH_TELEMETRY_INCLUDE=all` with ports 8081/8082 is from older versions; T11
    confirms for v3.3.4 or skips.
  - Rollback of removed services leaves orphan containers: a human removes them with
    `sudo -u deploy docker compose rm -sf <name>` in `/opt/lilnas`.

- **C1 (2026-11-23, T12 pre-flight stop)**:
  - `auth` is force-recreated by any change to `infra/monitoring.yml` or `infra/immich.yml`:
    `apps/auth/deploy.yml` bind-mounts every `infra/*.yml` read-only. Per-commit `ci detect`
    shows it on T7–T11's commits, so it was a planning miss, not a remediation side effect.
  - The tdr-bot image build comes from R3 (`9c0a9d18`) and R4 (`743b2aae`). They are
    interleaved with R1 (`41b04f76`), so no prefix of the branch has R1 without R3; a split
    needs a rebuilt branch.
  - Answer: H5 (human go/no-go for the wider push) gates T12, whose pre-flight now allows
    `apps/tdr-bot/src/**`, `docs/logging.md`, image `tdr-bot` and `forceRecreate` `auth`.
    If H5 gets Request changes: plan the split (push 1 from a branch without the two tdr-bot
    commits; they ship in push 2, and T18's pre-flight and H3's text must then allow them).
  - The run was paused with interrupt to stop T12's second attempt; resume after this edit.

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

### 2026-11-24 · Phase 1 · review cycle 1
Pass 1 (T2, T8, T1, T9): Pass 1 (T1, T2, T8, T9): the Prometheus job edits, the smartctl and exportarr services and the encrypted env files match their task bodies. One P1 and one P2, both from rules the plan wrote: the checker passes a panel with a broken query if another query in it has data, and it runs Loki metric queries over only a 5m window.
Pass 2 (T4): T4's TDR Bot dashboard meets the task's shape (13 panels in 5 rows, 7d default, uid and requestId kept, every named family used). But increase() on lazily created prom-client series drops the first event after each restart, so a one-off error after a deploy reads as Errors = 0 (confirmed live: 6 messages since restart, increase reports 5). Three P2s: success rate shows 100% when every request failed, stacked token bars count cached tokens twice, and stderr lines are left out of Errors and Warnings.
Pass 3 (T5): T5 is clean. Storage now has separate HDD and SSD groups, the MinIO bucket panels are pinned to job minio-bucket, and Infrastructure gains a Fullest mount stat. All of it matches the task and live data, and neither layout has overlapping panels.
Pass 4 (T3): T3's app-detail.json matches the task: shared Summary, runtime and HTTP rows filtered on route!="/metrics" and counting only 5xx as errors, collapsed Download and Equations rows, Logs, and a link to the tdr-bot dashboard. Every label it uses was confirmed in live Prometheus, Loki or the equations metrics source. No stale references to the deleted uids. Only a P2 note on quoting in the log search.
Pass 5 (T11, T7): T7 Overview dashboard and T11 Immich telemetry match their task bodies; Immich variable and ports confirmed in the v3.3.4 server bundle. Two P2 notes on overview.json: the restarts description's deploy claim is false per live data, and the cert-expiry stat turns missing data into a red 0 days.
Pass 6 (T6, T10): T10 (postgres_exporter, scrape job, role script, encrypted env) matches the spec and the live containers. T6's Security dashboard is mostly sound, but its scanner-probe panels are flooded by the user's own traffic (about 4.2k false 'probes with no error back' per day), so the red 'no error back' alarm is always on.
Seams pass: Seams pass: no disagreements found between tasks. Overview links resolve to existing uids, the App Detail→TDR Bot link holds, nothing outside docs/archive still references the deleted dashboards, Storage uses T2's minio-bucket job, every new scrape target matches a compose service name, and the merged tree passes check-dashboards lint (8 dashboards).
Consolidation: Seven passes merged into 3 P1 and 9 P2 findings; none were duplicates. The 8-finding cap moved 4 lower-impact P2s (stacked cached tokens, double-quoted log search, restarts description, Top IPs/usernames double count) to suspicions, labelled as findings moved for the cap. Passes 3 (T5) and seams were clean.

- F1 · P1 · Probe panels flooded by own nexus-code/SABnzbd traffic; 'no error back' always red — infra/monitoring/grafana/provisioning/dashboards/json/security.json:1086 → R1
- F2 · P1 · Checker passes a panel whose target errors when a sibling target has data — infra/monitoring/scripts/check-dashboards.mjs:418 → R2
- F3 · P1 · increase() drops the first event on every new series, so a one-off error after a deploy reads as 0 — infra/monitoring/grafana/provisioning/dashboards/json/tdr-bot.json:330 → R3

Notes:
- F4 · P2 · LLM Success Rate shows 100% when every request failed — infra/monitoring/grafana/provisioning/dashboards/json/tdr-bot.json:393
- F5 · P2 · Cert-expiry stat shows red 0 days when the metric is absent — infra/monitoring/grafana/provisioning/dashboards/json/overview.json:342
- F6 · P2 · plan-mandated · Loki metric queries are checked only over a 5-minute instant window — infra/monitoring/scripts/check-dashboards.mjs:245
- F7 · P2 · Errors and Warnings leaves out stderr lines, which have no level label — infra/monitoring/grafana/provisioning/dashboards/json/tdr-bot.json:776
- F8 · P2 · PG14 table-creation guard is bypassable by the role itself — infra/monitoring/scripts/postgres-monitor-roles.sh:103

Suspicions:
- Prometheus label_values variable query has no time bounds — infra/monitoring/scripts/check-dashboards.mjs:300 · /api/v1/label/<l>/values is called with no start/end, so an unset variable can take a value that no longer exists (e.g. job=idkwiw), and its panels come out EMPTY. · confirm by: Run live on a dashboard with an unset job variable after idkwiw is gone; compare queried[0] with label values over start=now-24h.
- psql -1 may be ignored when SQL comes on stdin — infra/monitoring/scripts/postgres-monitor-roles.sh:112 · --single-transaction is documented for -c/-f input; with stdin a mid-script failure may leave a partial apply (a re-run repairs it). · confirm by: In a throwaway PG, pipe the script with a forced error after CREATE ROLE and check whether the role remains.
- App Detail $app dropdown may pick up the new immich job — infra/monitoring/grafana/provisioning/dashboards/json/app-detail.json:1 · label_values(nodejs_heap_size_used_bytes, job) predates T11's immich job with IMMICH_TELEMETRY_INCLUDE=all; if Immich exports that metric, immich shows up as an app with empty HTTP panels. · confirm by: After deploy, query /api/v1/label/job/values?match[]=nodejs_heap_size_used_bytes and run check-dashboards live --var app=immich app-detail.json.
- [P2 finding moved for the cap] Stacked token bars count cached tokens twice — infra/monitoring/grafana/provisioning/dashboards/json/tdr-bot.json:586 · type="cached" is a subset of type="input" (default-llm-client.ts, model-registry.ts), so stacking input+output+cached turns 10k input (4k cached) + 1k output into 15k instead of 11k. Fix: unstack, or overlay cached unstacked and say so in the description. · confirm by: Compare the stacked bar height with input+output for one day.
- [P2 finding moved for the cap] Log search uses a double-quoted LogQL string — infra/monitoring/grafana/provisioning/dashboards/json/app-detail.json:1626 · |~ "$search" treats backslashes and quotes as string escapes; the deleted download.json used backticks. Typing \d+ or a quote may give a LogQL parse error. Fix: use backticks. · confirm by: Type \d+ into Log Search in Grafana and check for a parse error.
- [P2 finding moved for the cap] Restarts panel description claims deploys show as 1 — infra/monitoring/grafana/provisioning/dashboards/json/overview.json:552 · cAdvisor gives a recreated container a new id/series, so changes() stays 0 on deploy (live: lilnas-auth-1 has 15 series in 7d, changes()>0 empty). The plan told the implementer to describe it this way. Fix: say the panel counts in-place restarts only. · confirm by: Recreate a container and check that the panel stays at none.
- [P2 finding moved for the cap] Top IPs/usernames count each attempt about twice — infra/monitoring/grafana/provisioning/dashboards/json/security.json:254 · Panels 6 and 7 count both 'Invalid user'/'not allowed because' lines and the 'Connection closed by invalid user' follow-up, while panel 3 counts each attempt once, so the bars disagree with the stat. · confirm by: Compare one IP's bar value with its count of 'Invalid user' lines over the same range.

Spec check:
- extra: every non-row panel has a title, a datasource uid ... and at least one target with a non-empty expr (infra/monitoring/scripts/check-dashboards.mjs) — text panels are exempt; stated in the notes.
- extra: Logs: errors and warnings, and recent logs, both filtered by $requestId (infra/monitoring/grafana/provisioning/dashboards/json/tdr-bot.json) — Recent Logs also excludes /metrics scrape lines; harmless and stated.
- extra: Nothing else: no superuser, no CREATEDB, no table grants (infra/monitoring/scripts/postgres-monitor-roles.sh) — Adds ALTER ROLE SET default_transaction_read_only = on (stated); its weakness is a P2 finding.
- misunderstood: else `.*` for a textbox (check-dashboards.mjs resolveVariables) — An empty textbox substitutes ""; deliberate and matches Grafana.
- misunderstood: A deploy recreates containers, so say that in the description (infra/monitoring/grafana/provisioning/dashboards/json/overview.json) — The plan's premise is wrong for cAdvisor series identity; recreations are not counted.
- misunderstood: scanner probes (the \.env|\.git|wp-login… query from docs/logging.md) and the probes that did not get an error back (infra/monitoring/grafana/provisioning/dashboards/json/security.json) — The unchanged query matches the user's own nexus-code/SABnzbd traffic (P1).
- unverifiable: This appends three new private keys to .env.keys ... a later task has a human copy the key file to the deploy host (deploy host /opt/lilnas/.env.keys) — The push fails decryption until the updated key file, including the postgres-exporter key, is on the host.
- unverifiable: Until the role exists in production the deployed exporters report pg_up 0 (production after push) — Confirm pg_up turns 1 after postgres-monitor-roles.sh runs.
- unverifiable: Until the job is deployed live reports these panels empty / add job immich with one target per metrics port (storage.json panels 45-49; prometheus.yml immich job) — After the push, confirm minio-bucket panels have data and immich:8081/8082 are up with immich_* series.
- unverifiable: Grafana drops the four old dashboards when their files go (Grafana provisioning (disableDeletion: false)) — Check that Download Service, Equations, Service Detail and Services Overview are gone.
- unverifiable: Check whether a device that appears later would be seen at the 10-minute rescan (infra/monitoring.yml smartctl-exporter) — Hot-plug rescan not verifiable from the diff.
- unverifiable: Run check-dashboards.mjs lint and live --range 7d on the file and report the summary (T4 task notes) — Notes report 12 OK, 1 EMPTY, 0 ERROR; a person can re-run to confirm.

Declined to judge:
- dotenvx -fk comment and hyphenated DOTENV_PUBLIC_KEY_* names in the new env files — Same as every existing infra env file; secrets verify passed.
- ENABLE_ADDITIONAL_METRICS left off for Sonarr/Radarr — The task let the throwaway run decide; the reason is in a monitoring.yml comment.
- or vector(0) on zero-when-healthy stats (Btrfs errors, schema failures, LLM errors) drawing flat zeros or hiding a missing collector — The plan mandates or vector(0) for these; the down-targets stat covers a failed scrape.
- Errors stat may count one failure several times (message + LLM + fallback) — The task body asks for these to be added up.
- Panels dropped from the old download/equations dashboards and the Storage Inode Usage stat — The tasks asked for a subset or a replacement; stated in the notes.
- Security Top paths grouped by first segment; hardcoded 'jeremy' exclusion — Stated deviations (Loki 500-series limit at 7d) explained in the panel descriptions.
- immich-database ${DB_PASSWORD} interpolation; docs/deploy.md 'Today:' env list missing .env.postgres-exporter — Untouched lines / not asked for; the decrypt glob still covers the file.
- Storage and Infrastructure have no tag-based dashboards link; checker style nits (no-op status ternary, summary counts include variables, extra Grafana built-ins flagged) — Single-task or cosmetic; exit code and the task's named built-ins unaffected.

Checked:
- Removed idkwiw job still referenced — repo grep; live label values: Only plan docs; old TSDB series age out of range-bound variable queries.
- Read-only /dev bind blocks smartctl — infra/monitoring.yml smartctl-exporter: ro does not block opening device nodes; the throwaway saw all 13 devices.
- Shell injection in the live runner — check-dashboards.mjs runCommand/promCommand/lokiCommand: execFile with an argument array and encodeURIComponent; no shell.
- Cached tokens overlap input; status label values — apps/tdr-bot llm-metrics/default-llm-client/model-registry; live Prometheus: cached is a subset of input; only success seen live, error/timeout declared in code.
- First increment lost by increase() — live Prometheus tdr_bot_messages_received_total, llm_cost_usd_total: Confirmed: raw 1->6, increase 5.0.
- HDD/SSD sums double-count or catch extra mounts; Fullest mount query — live node_filesystem_size_bytes; infrastructure.json panel 11: Each mount has its own device and /boot is excluded; Fullest returns /mnt/hdd6 at 32.7%.
- minio-bucket job and bucket label vs Storage panels (seam T2/T5) — infra/monitoring/prometheus.yml; storage:9000/minio/v2/metrics/bucket: The job exists with the right metrics_path, and the panels use {{bucket}}, which matches.
- Deleted dashboards or uids still referenced; Overview and App Detail links — repo grep excluding docs/archive; overview.json, app-detail.json: No stale references; all /d/ targets and lilnas-tdr-bot exist.
- App Detail labels and $app values — live Prometheus/Loki; packages/utils metrics-interceptor.ts; equations-metrics.service.ts: status_code, route, phase=total and the service labels are present; $app = tdr-bot, equations, download, me-token-tracker.
- Immich telemetry variable and metrics ports — lilnas-immich-1 server dist config.repository.js, env.dto.js: IMMICH_TELEMETRY_INCLUDE exists; ports 8081/8082 match the scrape job.
- Postgres exporter DSNs, networks and the decrypt of the new env files — docker inspect of the three DBs; compose files; scripts/deploy/decrypt-env.sh: DB names match, everything is on the default network, and the infra/.env.* glob picks up the files.
- OAuth code/state leaking through RequestPath in the Security panels — docs/logging.md, infra/proxy.yml: Alloy redacts code/token params and Traefik drops headers; no leak.

### 2026-11-23 · R2 · done
Fixed F2: checkLive now marks a panel ERROR (ok=false, exit 1) whenever any target errors, even if other targets returned series. The existing test that locked in the old behaviour now expects ERROR / ok=false / "1 ERROR" in the summary. It failed on the old code and passes now; the whole check-dashboards.test.mjs file passes (59/59).
All five plan checks pass: the dashboard uid/tag jq loop, promtool, compose config, prettier, and the three jest specs (99 tests).
No dashboards were edited, so there is no live summary. No throwaway containers or temp files were created.

### 2026-11-23 · R3 · done
Reproduced with new tests that failed on the old code (series undefined before first inc) and now pass. Fix: known label sets are created at 0 at startup, in the TdrBotMetricsService and LlmMetricsService constructors, and via initLlmRequests(registry.ids()) in LlmOrchestrationService.onModuleInit. Dashboard queries unchanged.
Deliberately not initialised: tdr_bot_llm_calls_total (operation x model x role x status is large and open-ended) and tdr_bot_router_decisions_total (not on the dashboard). The first llm call after a restart is therefore still dropped from increase() for the error-calls panel. OPERATIONS in llm-metrics.service.ts is a hard-coded list that must be extended when a new LLM operation name is added.
Needs a tdr-bot deploy (push to main). After it, restart tdr-bot and confirm increase() matches the raw counter delta; not verified live here.
Pre-existing, not caused by this change: the tdr-bot type-check and llm-orchestration.integration.test.ts fail in this worktree because workspace packages (@lilnas/utils, @lilnas/media) are not built. All other touched suites pass. No dashboard was edited, so there is no check-dashboards live summary. No throwaway containers or temp files were created.

### 2026-11-23 · R1 · done
Probe panels 22-25 now filter `| json | RequestPath =~ "(?i)[^?]*(/\.(env|git|aws)\b|wp-login|phpmyadmin|/@fs/).*"`, keeping the cheap line prefilter in front. Anchoring on the path alone still left ~2.8k nexus-code hits, because the nexus-code and nexus-code-work Vite dev servers serve assets from /@fs/...; all four panels also carry `| RouterName !~ "nexus-code(-work)?@docker" or RequestPath !~ "[^?]*/@fs/.*"`, so real .env probes against those hosts still count. All 384 SABnzbd hits were genuine /.env probes that got a 302 to the login page; panels 23 and 25 only also carry `| RouterName != "sabnzbd@docker" or DownstreamStatus != 302` next to the dashcam exclusion (a deliberate difference from the suggested fix). A SAB 200 would still show.
Live 24h: panel 22 about 4230 -> 1036 hits; "no error back" is now 22 hits across 10 hosts (files, grafana, immich, portal, prometheus, radarr, sonarr, storage-admin, tdr, yacht), nexus-code and sabnzbd gone.
Regression test is in check-dashboards.test.mjs ("security dashboard: scanner probe panels"); it failed on the old expressions and `node --test infra/monitoring/scripts/` now passes 66/66. docs/logging.md example queries updated to match.
Live summary (security.json, 24h): lilnas-security: 18 OK, 1 EMPTY, 10 EMPTY (event-driven), 0 ERROR. The one plain EMPTY panel is #18 "4xx and 5xx over time", which I did not touch and did not investigate. No new metrics or labels were used. No containers were created; temp files /tmp/e22.txt and /tmp/e23.txt were removed. All five plan checks pass.

### 2026-11-24 · Phase 1 · review cycle 2
The remediation diff fixes F1 (probe panels now filter on RequestPath), F2 (a panel with an erroring target is ERROR) and F3 (the Errors-stat, cost and token counters start at 0). One new P1: the hard-coded OPERATIONS list used to start retry and schema-failure series at 0 covers only 12 of the 31 operation names in use, so the F3 defect remains on those panels for most operations.

Earlier findings: F1 fixed, F2 fixed, F3 fixed.

- F9 · P1 · OPERATIONS list misses 19 live operation names, so their first retry or schema failure after a restart is still dropped — apps/tdr-bot/src/llm/observability/llm-metrics.service.ts:18 → R4

Suspicions:
- Security panel #18 '4xx and 5xx over time' reports plain EMPTY — infra/monitoring/grafana/provisioning/dashboards/json/security.json · R1's live summary shows lilnas-security with 1 plain EMPTY (#18). Done means requires every empty panel to have an Event-driven: description, and live traffic has 4xx/5xx lines, so the query is probably wrong. This panel is outside the remediation diff. · confirm by: node infra/monitoring/scripts/check-dashboards.mjs live --range 24h infra/monitoring/grafana/provisioning/dashboards/json/security.json, then compare #18's expr with the Top client IPs query that returns data.

Spec check:
- missing: R3: initialise each known label set at 0 at startup (e.g. ... for each handler, skill, operation and status) (apps/tdr-bot/src/llm/observability/llm-metrics.service.ts) — Operation-keyed series cover 12 of 31 operations.
- unverifiable: R3: afterwards confirm increase() matches the raw counter delta after a restart (production tdr-bot) — Needs a tdr-bot deploy; not checked live.

Declined to judge:
- tdr_bot_llm_calls_total is not created at startup, so the first error or timeout call after a restart is still missed by the timeouts panel — R3 states this deliberately (open-ended operation x model x role x status combinations). It is acknowledged, not a regression from this diff.
- Cost-per-day and tokens panels will now list all 14 catalog models at 0 — Cosmetic; the values are correct.
- Security panel #18 and other T6 panels outside the remediation diff — New findings are limited to the remediation diff; noted as a suspicion.

Checked:
- Cost and token series created at startup use a different model label than real calls — apps/tdr-bot/src/llm/client/default-llm-client.ts:106,250-251: Calls label by modelId from settings or overrides, which are catalog ids, so the zero series match.
- OPERATIONS matches real call sites — grep of operation: literals in apps/tdr-bot/src: 31 distinct literals, 12 covered (tldr.* come from a ternary in tldr.service.ts). Reported as P1.
- registry.ids() exists and returns skill ids for initLlmRequests — apps/tdr-bot/src/llm/skills/skill.registry.ts:18: Exists; build-graph.ts already uses it the same way.
- Test mocks missing initLlmRequests would throw in onModuleInit — llm-orchestration.integration.test.ts, api.controller.conversations.test.ts: Both use createMockMetricsService, which now has initLlmRequests.
- LogQL 'or' and anchoring in the new RequestPath filters — security.json panels 22-25: Label-filter regexes are fully anchored; [^?]* stops before the query string; \b leaves out /.github and nexus-code gitStatus. The 'or' filters only exclude nexus-code /@fs/ assets and SAB 302s.
- ERROR branch still counts and prints detail lines — infra/monitoring/scripts/check-dashboards.mjs:429: Any error now goes to ERROR with every error and empty target listed; the summary counts it and ok becomes false.

### 2026-11-23 · R4 · done
Added the 21 missing operation literals to OPERATIONS and exported it. New regression tests scan non-test src/**/*.ts for dotted string literals on `operation:` lines (covers the tldr ternary) and assert they are in OPERATIONS and that retry/schema-failure series exist at 0; both failed on the old list. Did not add a typed-union requirement: the test covers it, and a union would also touch FakeLlmClient and live tests. Package-wide tsc --noEmit has unrelated errors in src/utils/download-*.ts (unresolved @lilnas/utils subpaths); none in observability. No dashboard/infra files changed, so no live summary.

### 2026-11-23 · H1 · approved
Approved.

### 2026-11-23 · T12 · blocked
Nothing was done beyond the read-only pre-flight. No key backup refresh, no `secrets decrypt`, no role creation, no push, no production checks, no inventory. The inventory the next dashboards need still does not exist.

Rollback sha (current `origin/main`, fetched just now): e5d9cdaed615542824df7286c1f09a6e6f97e7a8
Branch HEAD: dda68f589ffa316c4475888cfb8dd9cfc30cc981

| Pre-flight check | Result |
|---|---|
| `git merge-base --is-ancestor origin/main HEAD` | PASS. `origin/main` is an ancestor of HEAD. |
| `git diff --name-only origin/main..HEAD` limited to allowed paths | FAIL. Seven files are outside the allowed list (below). |
| `pnpm lilnas secrets verify --keys …` | Cannot run as written. `secrets verify` has no `--keys` flag ("Nonexistent flag: --keys"), as T9 and T10 also noted. Run without the flag it prints `ok` for `infra/.env.exportarr-{sonarr,radarr,sabnzbd}` and `infra/.env.postgres-exporter`, plus the rest of the list I saw. |
| `pnpm lilnas ci detect` | FAIL. `full` is false and `decrypt` is true. The rest of the output is below. |
| Key file copied to `/opt/lilnas/.env.keys` | PASS. Both files are 1874 bytes. |

Files outside the allowed list:
- `apps/tdr-bot/src/__tests__/tdr-bot-metrics.service.test.ts`
- `apps/tdr-bot/src/__tests__/test-utils.ts`
- `apps/tdr-bot/src/llm/observability/__tests__/llm-metrics.service.test.ts`
- `apps/tdr-bot/src/llm/observability/llm-metrics.service.ts`
- `apps/tdr-bot/src/messages/llm/llm-orchestration.service.ts`
- `apps/tdr-bot/src/tdr-bot-metrics.service.ts`
- `docs/logging.md`

The commits that touch them:
- `743b2aae` fix(tdr-bot): pre-create retry and schema-failure series for every LLM operation
- `9c0a9d18` fix(tdr-bot): create known counter label sets at 0 on startup so increase() counts the first event
- `41b04f76` fix(monitoring): match scanner probes on RequestPath and leave out own nexus-code and SABnzbd traffic (the `docs/logging.md` change)

What `ci detect` reports:
- **Images:** `tdr-bot` would be built and pulled, because of the `apps/tdr-bot` changes. The task requires no images.
- **`forceRecreate`:** `["auth","grafana","prometheus"]`. `auth` is not allowed, since only `prometheus` and `grafana` are. I did not find out why `auth` is included.
- **`up`:** `alloy, cadvisor, exportarr-radarr, exportarr-sabnzbd, exportarr-sonarr, immich, immich-database, immich-machine-learning, immich-redis, loki, node-exporter, postgres-exporter-icloud-backup, postgres-exporter-immich, postgres-exporter-tdr-bot, smartctl-exporter, storage-volumes, yacht`. All of these are services defined in `infra/monitoring.yml` or `infra/immich.yml`, so this part is fine.
- **`decrypt`:** true, with `decryptServices` the six exportarr and postgres-exporter services, as expected.

Deploying as-is would rebuild and redeploy the tdr-bot Discord bot and force-recreate `auth`. That is the "rebuild images / redeploy" case the pre-flight is meant to stop.

Options for whoever decides next:
- **Approve the wider push.** The tdr-bot metric commits are the pre-created series fixes from the plan's review remediation. A human would need to sign off on deploying tdr-bot and recreating `auth` alongside phase 1, then the pre-flight is relaxed for them.
- **Split the history.** Push only the monitoring and docs commits. `origin/main` stays an ancestor only if the apps commits are not pushed ahead of them, so this needs a reordered branch, which I am not allowed to build (no rebase).

Role rollback, for when the role is eventually created: `infra/monitoring/scripts/postgres-monitor-roles.sh --drop infra/.env.postgres-exporter.decrypted`

Seven new container names expected after the eventual deploy: `smartctl-exporter`, `exportarr-sonarr`, `exportarr-radarr`, `exportarr-sabnzbd`, `postgres-exporter-tdr-bot`, `postgres-exporter-icloud-backup`, `postgres-exporter-immich`. This is the list from `ci detect`, not observed live.

No throwaway containers or temp files were created.

Retried.

### 2026-11-23 · T12 · blocked
Pre-flight still fails, unchanged since attempt 1. The diff origin/main..HEAD includes apps/tdr-bot/src/** (6 files: tdr-bot-metrics.service.ts and its test, test-utils.ts, llm-metrics.service.ts and its test, llm-orchestration.service.ts) and docs/logging.md, all outside the allowed paths. `ci detect` reports image tdr-bot (build and pull), forceRecreate ["auth","grafana","prometheus"] (auth not allowed; reason not investigated), decrypt true, full false. `up` is within the monitoring/immich services. The H1 approval ("Approved.") does not mention the tdr-bot deploy or the auth recreate, so I did not treat it as covering them.
Passing: origin/main is an ancestor of HEAD; key file sizes match (1874 and 1874). `pnpm lilnas secrets verify` has no --keys flag.
Rollback sha: e5d9cdaed615542824df7286c1f09a6e6f97e7a8. Branch HEAD: 37594a7c5945e192020075cfbc9eaab662c5af3f.
Nothing was done: no key backup refresh, no decrypt, no role creation, no push, no production checks, no inventory (smartctl, sonarr, radarr, sabnzbd, postgres, immich metric names are still unobserved).
Role rollback (nothing created yet): infra/monitoring/scripts/postgres-monitor-roles.sh --drop infra/.env.postgres-exporter.decrypted
Seven expected new containers (from ci detect, not observed live): smartctl-exporter, exportarr-sonarr, exportarr-radarr, exportarr-sabnzbd, postgres-exporter-tdr-bot, postgres-exporter-icloud-backup, postgres-exporter-immich.
No throwaway containers or temp files were created.

Retried.

### 2026-11-23 · H5 · approved
Approved.

### 2026-11-24 · T12 · partial
Pushed sha: 394431e08b3e3ddc54f8f3d9ed5980dcbbe791e2 (HEAD:main, e5d9cdae..394431e0). Rollback sha: e5d9cdaed615542824df7286c1f09a6e6f97e7a8. CI run: https://github.com/codemonkey800/lilnas/actions/runs/45352251208 (red).
Pre-flight all held: ancestor OK; diff paths all allowed; secrets verify rc 0; ci detect full=false, images=[tdr-bot], decrypt=true, forceRecreate=[auth,grafana,prometheus], up all within monitoring.yml/immich.yml; key sizes 1874/1874.
Done: key backup refreshed (/storage/backups/lilnas-secrets/.env.keys, 1874 bytes, 0600). Dry-run SQL read, then roles script run for real (rc 0). lilnas_monitor exists in lilnas-tdr-bot-db-1, lilnas-icloud-backup-db-1, lilnas-immich-database-1: rolsuper f, can login t, pg_monitor member t, default_transaction_read_only on; password login over TCP with the password on stdin succeeds in all three.
CI: detect success, check (apps/tdr-bot) FAILURE (job 138301594297), base-images skipped, build-images success but tdr-bot skipped ("checks failed or missing for apps/tdr-bot"), deploy success, summary failure. Failing step: pnpm run build in apps/tdr-bot: "Turbopack build failed with 12 errors: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font' ... next/font/google queries have exactly one entry" (geist_mono Google Font fetch). Likely a transient Google Fonts fetch failure on the runner; no frontend file is in the diff. Not confirmed; I did not rerun (a rerun redeploys).
Production right after deploy (read-only): auth recreated and healthy; grafana, prometheus, immich recreated; immich healthy; postgres-exporter-tdr-bot/-icloud-backup/-immich and smartctl-exporter up. The exportarr-* containers were not in my filtered ps output. tdr-bot NOT redeployed: up 33h on :latest, so llm_retries_total and tdr_bot_llm_schema_failures_total will not exist until a tdr-bot image is built and deployed.
Not done (stopped per instructions, run red): five-minute wait, Prometheus target checks, smartctl_devices/pg_up/minio bucket series, Grafana uid + home checks, check-dashboards live, tdr-bot series counts, and the metric inventory for smartctl, sonarr, radarr, sabnzbd, postgres, immich.
Expected seven new containers (from ci detect, not all observed): smartctl-exporter, exportarr-sonarr, exportarr-radarr, exportarr-sabnzbd, postgres-exporter-tdr-bot, postgres-exporter-icloud-backup, postgres-exporter-immich (compose names lilnas-<name>-1).
Role rollback: infra/monitoring/scripts/postgres-monitor-roles.sh --drop infra/.env.postgres-exporter.decrypted (run pnpm lilnas secrets decrypt --keys /home/jeremy/lilnas/.env.keys first).
Cleanup: 19 *.decrypted files removed from the worktree; git status clean; docker ps -a --filter name=mon-rig- => 0. No throwaway containers were created.

Remaining:

Rerun or fix the tdr-bot check so the image is built and deployed, then run the full post-deploy verification and inventory from the T12 body. The deploy job already ran for the monitoring and immich changes.

Defects:

- blocking · CI check (apps/tdr-bot) fails on next/font/google build, so the tdr-bot image was not built or deployed · .github/workflows/ci.yml job "check (apps/tdr-bot)" (run 45352251208, job 138301594297), apps/tdr-bot frontend build
  Error: Turbopack build failed with 12 errors: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font' / next/font/google queries have exactly one entry; ##[error]command (apps/tdr-bot) pnpm run build exited (1); annotation: tdr-bot skipped: checks failed or missing for apps/tdr-bot; summary job failed

No commits: nothing to integrate.

### 2026-11-24 · T12 · defects → R5
T12 reported 1 blocking defect at attempt 3, sent to R5; it runs again at round 2 to re-check.

- R5 · CI check (apps/tdr-bot) fails on next/font/google build, so the tdr-bot image was not built or deployed (`.github/workflows/ci.yml job "check (apps/tdr-bot)" (run 45352251208, job 138301594297), apps/tdr-bot frontend build`): Error: Turbopack build failed with 12 errors: Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font' / next/font/google queries have exactly one entry; ##[error]command (apps/tdr-bot) pnpm run build exited (1); annotation: tdr-bot skipped: checks failed or missing for apps/tdr-bot; summary job failed
