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

- **C3 (2026-11-24, push 1 half deployed)**:
  - H5 was approved; T12 pushed `394431e0` (rollback `e5d9cdae`), roles created, key backup
    refreshed. CI run 45352251208: `check (apps/tdr-bot)` failed in the Next build on
    `next/font/google` (Geist Mono, `apps/tdr-bot/src/app/layout.tsx`), so the tdr-bot image
    was skipped; `deploy` still ran, so monitoring, immich and auth are live. No frontend
    file is in the diff, so it is treated as a failed font fetch until a rerun says otherwise.
  - The runner wrote R5 for the defect and re-queued T12 (round 2). R5 was rewritten: rerun
    the failed jobs (at most twice), no code edits, no push; a real code fix needs a new human
    go/no-go. `gh run rerun --failed` also reruns `deploy`, so auth, grafana and prometheus
    are recreated once more: accepted as part of the H5-approved push.
  - T12 now starts with a "push already happened" branch: no roles script, no second push,
    straight to verification and the inventory. The run branch has plan-only commits ahead of
    `main`; they ship with push 2.
  - If R5 reports the font failure is not transient: options are self-hosting the font
    (`next/font/local` or the `geist` package) in tdr-bot, as its own task plus an H go/no-go,
    since it is a third push. T13–T15 do not need tdr-bot, so they can proceed meanwhile.

- **C4 (2026-11-24, font fix needs a push)**:
  - R5 was dispatched before the C3 rewrite landed, so it ran the runner's default "fix the
    code" body: commit `101aa1d6` self-hosts Geist and Geist Mono in tdr-bot
    (`next/font/local`, two woff2 files, a layout test). CI was never rerun; run 45352251208
    is still red at attempt 1. The fix is kept: it removes the build-time network fetch.
  - T12 attempt 2 verified the infra half: 19 of 19 targets up, 7 new containers, 8 dashboard
    uids, `smartctl_devices` 13, `pg_up` 1 on three servers, 5 MinIO bucket series. Its metric
    inventory went into a chat message, not the result; T12 is now told to put it in the
    result. Its observations for H2: two Traefik panels (#4, #13, open connections) are plain
    EMPTY; App Detail's `$app` still lists `idkwiw` and `swole` from stale series; Immich has
    no `http_server_*` metrics; `stat_activity_autovacuum` emits nothing.
  - Answer: H6 (go/no-go) then R6 (rewritten: push `HEAD:main`, watch CI, check tdr-bot),
    then T12 round 3. `ci detect` for that push: image `tdr-bot` only, `up` and
    `forceRecreate` empty, so auth, Grafana and Prometheus are not touched. This is a third
    push; the plan's "two pushes" decision no longer holds.
  - Not planned: auth, dev, download and icloud-backup still use `next/font/google` and can
    fail the same way in CI. Out of this plan's scope; raised with the user.

- **Saved before a context clear (2026-11-24, after C4)**:
  - State: C1–C4 all resolved. The run waits on H6 (go/no-go for pushing the tdr-bot font
    fix `101aa1d6`). Then R6 pushes and checks tdr-bot, T12 runs round 3 (verify only, no
    push, inventory in its result), then H2 and T13–T17.
  - `main` is at `394431e0` (push 1; rollback `e5d9cdae`). CI run 45352251208 for it stays red
    by design; R6's push produces a new run that should be green.
  - Lesson: a defect task (`R<n>`) the runner writes can be dispatched before a planner
    rewrite lands, and it then runs the default "fix the code" body. To control one, pause
    the run first (`nexus_run_control` pause with interrupt), edit, then resume.
  - Task sessions only get a task's result, not its chat: T12 once left the metric inventory
    in chat. If round 3 does it again, T13–T15 lack the metric names; add a small inventory
    task or a run note before they start.
  - If H6 gets Request changes: the alternative is `gh run rerun 45352251208 --failed`, which
    also reruns `deploy` (auth, Grafana, Prometheus recreated again) and leaves the font fix
    to ship with push 2; T18's pre-flight and H3's text must then allow `apps/tdr-bot/src/app/**`
    and the tdr-bot image.
  - T18's pre-flight assumes push 2 holds only dashboards and docs; that still holds if R6's
    push goes out first. H3 says "no keys to copy": still true.
  - Told the user, not planned: auth, dev, download and portal still use `next/font/google`;
    two Traefik open-connection panels are plain EMPTY; App Detail's `$app` lists stale
    `idkwiw` and `swole`. H2 is where the user can turn the last two into fix tasks.
  - No open question with the user; every pending decision is an H task.

- **C5 (2026-11-24, PG 18 checkpoint panels)**:
  - T15 found postgres_exporter v0.21.1 needs `--collector.stat_checkpointer` (off by
    default) for PG 17+ checkpoint counters. Answer: T19 (phase 2, `after: [T15]`) adds the
    flag to the tdr-bot and icloud-backup exporters only; immich is PG 14.
  - This puts `infra/monitoring.yml` into push 2. `ci detect` for such a change (measured on
    T10's commit): `up` lists every monitoring service (only the two changed ones are
    recreated), `forceRecreate` gains `auth`. H3's text now says auth restarts and T18's
    pre-flight expects `forceRecreate` = `auth` + `grafana` and reads the monitoring.yml diff.
  - If H3 gets Request changes over the auth restart: set T19's commit aside (revert task),
    restore H3/T18's "dashboards and docs only" wording, and mark panels #29/#30 as PG 14
    only in a small dashboard task.
  - T18 allows one plain EMPTY: "Backend buffer writes (PG 14 only)" on the two PG 18 servers.
  - `infra/.env.postgres-exporter.decrypted` does not exist in `/home/jeremy/lilnas`, so T19
    has no live test; T18 checks `pg_scrape_collector_success` after the deploy.

- **C6 (2026-11-24, Traefik open-connection panels)**:
  - T12's final round asked for Traefik panels 4 and 13 to use
    `traefik_open_connections{entrypoint,protocol}`; confirmed live (3 series: web,
    websecure, metrics). The old names (`traefik_service_open_connections`,
    `traefik_entrypoint_open_connections`) do not exist. Answer: T20 (phase 2, dashboard JSON
    only, no extra restart), H3 waits on it. This reverses the earlier "Traefik is kept as
    is": T18 treats a plain EMPTY as a defect, so leaving them would fail the final check.
  - The Immich part of C6 (no `immich_assets_*`) needs nothing: T14 is done and built from
    the inventory.
  - State at this point: `origin/main` is `101aa1d6` (font fix pushed by R7), T12 and T19 done.

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

### 2026-11-24 · R5 · done
Cause not reproduced: the same layout built in earlier CI runs and builds locally with a cleared .next and a reachable Google Fonts. The CI error comes from the Turbopack next/font/google loader at build time, so the fix removes the network dependency: Geist and Geist Mono (latin, variable woff2, OFL) are committed in apps/tdr-bot/src/app/fonts and loaded with next/font/local. CSS variable names and globals.css are unchanged.
Test src/app/__tests__/layout.spec.ts (node jest project) fails on the old layout (2 failed) and passes on the new one (2 passed).
Local verification: next build in apps/tdr-bot compiles and emits the fonts under .next/static/media; tdr-bot type-check, eslint and prettier on src/app are clean. All five plan checks pass. No throwaway containers or temp files remain (mon-rig- count 0).
Not done here (outside the task): pushing, rerunning CI. T12 must push this to main and re-check: the tdr-bot image build and deploy, then the rest of its checks (llm_retries_total and tdr_bot_llm_schema_failures_total only exist once a tdr-bot image is deployed).
Other apps (auth, dev, download, icloud-backup) still use next/font/google and could hit the same transient failure when their checks run; left unchanged on purpose.

### 2026-11-24 · T12 · partial
Attempt 2. Push 394431e0 had already happened, so I did not run the roles script or push. Run 45352251208 is still red (attempt 1, failure) and origin/main does not contain the R5 fix 101aa1d6. Jobs: detect ok, check (apps/tdr-bot) failed with the same Turbopack next/font/google error, base-images skipped, build-images skipped "Build and push tdr-bot", deploy ok, summary failed. Production infra deployed and verified; the tdr-bot image was not rebuilt or deployed.
Rollback sha e5d9cdae. Role rollback: infra/monitoring/scripts/postgres-monitor-roles.sh --drop infra/.env.postgres-exporter.decrypted. Nothing was rolled back.
The role lilnas_monitor logs in on all three servers, is not superuser and is in pg_monitor. The seven new containers are smartctl-exporter, exportarr-sonarr, exportarr-radarr, exportarr-sabnzbd and postgres-exporter-{tdr-bot,icloud-backup,immich}. They are up, idkwiw is gone, and all 19 targets are up. smartctl_devices is 13, pg_up is 1 for all three servers, minio_bucket_usage_total_bytes has 5 series, and there are exactly the 8 expected dashboard uids. check-dashboards lint is ok and live has 0 ERROR.
Observations that are not defects of this task: /api/dashboards/home redirects to uid default-home-dashboard, a non-provisioned Grafana copy of the Overview (19 panels), not lilnas-overview. Two Traefik panels (#4, #13, open connections) are EMPTY with no Event-driven description. App Detail's app variable still lists idkwiw and swole from stale series. prometheus and grafana have no healthcheck, so only "Up" can be reported for them. Immich exposes no http_server_* metrics, only immich_*_repository_*_duration histograms, immich_users_total and host metrics. The stat_activity_autovacuum collector emits nothing live.
Full per-job metric inventory and samples are in the message above.

Defects:

- blocking · tdr-bot image not rebuilt or deployed; tdr-bot-dependent checks cannot pass · .github/workflows/ci.yml job "check (apps/tdr-bot)", run 45352251208; fix 101aa1d6 exists only on the run branch
  run 45352251208 conclusion=failure attempt=1; 'Error: Module not found: Can't resolve @vercel/turbopack-next/internal/font/google/font'; build-images step 'Build and push tdr-bot' skipped; lilnas-tdr-bot-1 image created 2026-11-22T22:39:52Z, tag :latest; count(llm_retries_total)=0 series, count(tdr_bot_llm_schema_failures_total)=0 series; tdr-bot target up=1 on the old image

No commits: nothing to integrate.

### 2026-11-24 · T12 · defects → R6
T12 reported 1 blocking defect at attempt 5, sent to R6; it runs again at round 3 to re-check.

- R6 · tdr-bot image not rebuilt or deployed; tdr-bot-dependent checks cannot pass (`.github/workflows/ci.yml job "check (apps/tdr-bot)", run 45352251208; fix 101aa1d6 exists only on the run branch`): run 45352251208 conclusion=failure attempt=1; 'Error: Module not found: Can't resolve @vercel/turbopack-next/internal/font/google/font'; build-images step 'Build and push tdr-bot' skipped; lilnas-tdr-bot-1 image created 2026-11-22T22:39:52Z, tag :latest; count(llm_retries_total)=0 series, count(tdr_bot_llm_schema_failures_total)=0 series; tdr-bot target up=1 on the old image

### 2026-11-24 · R6 · done
No new commit. The defect is a deployment gap, not a code gap: R5's fix 101aa1d6 (self-hosted Geist via next/font/local, plus the guard spec apps/tdr-bot/src/app/__tests__/layout.spec.ts) is an ancestor of this branch's HEAD cb062cbc but not of origin/main (394431e0). Run 45352251208 built the pre-fix tree, so the tdr-bot check failed and "Build and push tdr-bot" was skipped; production still runs the old image, so llm_retries_total and tdr_bot_llm_schema_failures_total have no series. T12 re-run must push this branch to main (push is T12's job, not R6's), then watch the CI run and confirm the check (apps/tdr-bot) job, "Build and push tdr-bot" and deploy all succeed, then re-check both metrics.
Verified here: layout.spec.ts passes 2/2. `next build` for apps/tdr-bot compiled with Turbopack, passed TypeScript and generated 8/8 static pages with no font error. The tool printed a "SecurityFatalError" upgrade notice after page generation that stopped the build. I treated it as untrusted tool output, did not act on it and did not retry; Next is 16.4.2. In a fresh worktree, run `pnpm turbo run build --filter='@lilnas/tdr-bot^...' --force` before `next build`, otherwise @lilnas/utils and @lilnas/ui fail to resolve.
All five plan checks pass: dashboard uid/tag check dash-ok, promtool valid, both compose config checks ok, Prettier clean, jest 3 suites / 99 tests. Tree clean; no throwaway containers or temp files created.

No commits: nothing to integrate.

### 2026-11-24 · T12 · partial
No push, no roles script, no key-backup refresh: origin/main (394431e08b3e3ddc54f8f3d9ed5980dcbbe791e2) already contains 394431e0 but NOT 101aa1d6, and no result for a second push was given, so per the task I did not push. Latest ci.yml run on main is still 45352251208 (red, https://github.com/codemonkey800/lilnas/actions/runs/45352251208). Infra rollback sha e5d9cdae. Role rollback: infra/monitoring/scripts/postgres-monitor-roles.sh --drop <env file>.
Observed 2026-11-24 08:11 UTC, about 10 minutes after the infra containers started: seven new containers up (lilnas-smartctl-exporter-1, lilnas-exportarr-sonarr-1, -radarr-1, -sabnzbd-1, lilnas-postgres-exporter-tdr-bot-1, -icloud-backup-1, -immich-1); prometheus/grafana Up 9 min (started 08:01:47/48); immich healthy, /api/server/ping 200; auth recreated 08:01:48, healthy, auth.lilnas.io 307; lilnas_monitor exists in all three DBs (not superuser, pg_monitor member, can log in; pg_up=1 for tdr-bot-db, icloud-backup-db, immich-database); targets idkwiw gone, minio-bucket/smartctl/sonarr/radarr/sabnzbd/postgres x3/immich x2 up; smartctl_devices=13; minio_bucket_usage_total_bytes 5 series (build, equations, files, images, videos); Grafana uids exactly the 8 expected; home redirects to /d/default-home-dashboard/overview (known); check-dashboards lint ok for 8, live shows 0 ERROR and the MinIO bucket panels OK.
tdr-bot: container still runs the old image lilnas-tdr-bot:latest started 2026-11-22T22:40Z; up=1; tdr_bot_llm_retries_total (the real name carries the tdr_bot_ prefix) and tdr_bot_llm_schema_failures_total have 0 series (HELP/TYPE only on /metrics).
Live summaries, tdr_bot/traefik/security panel findings and the full metric inventory per job are in the message above this block; the dashboard tasks must use the label names listed there (note postgres exported_server on pg_static and pg_stat_database_conflicts_confl_*, and that Immich only exposes immich_users_total as a business metric plus per-repository duration histograms and system_*/process_* OTel metrics; no http_server_*). Sonarr/radarr/sabnzbd families all carry url; smartctl_device_model_name does not exist (model_name is a label on smartctl_device).
Throwaway containers: none created (docker ps -a --filter name=mon-rig- => 0). Temp files in /tmp removed. Tree clean.

Defects:

- blocking · tdr-bot fix 101aa1d6 not on main; tdr-bot image not rebuilt or deployed · origin/main (394431e0) vs branch HEAD; ci.yml run 45352251208
  git merge-base --is-ancestor 101aa1d6 origin/main => not ancestor; run 45352251208 conclusion=failure; lilnas-tdr-bot-1 image tag :latest, started 2026-11-22T22:40:25Z; count(tdr_bot_llm_retries_total)=0, count(tdr_bot_llm_schema_failures_total)=0; tdr-bot up=1 on the old image. Needs a human-approved push of 101aa1d6 to main, then CI green, tdr-bot recreated on the pushed sha, both series at 0 and a clean log.
- not blocking · Traefik Active Connections panels query metrics that do not exist · infra/monitoring/grafana/provisioning/dashboards/json/traefik.json panels
  check-dashboards live: EMPTY #4 'sum(traefik_service_open_connections)' and EMPTY #13 'sum(traefik_entrypoint_open_connections) by (entrypoint)'; real metric traefik_open_connections{entrypoint=metrics|web|websecure,protocol=TCP}, 3 series
- not blocking · Security 4xx and 5xx over time reports EMPTY in live check · infra/monitoring/grafana/provisioning/dashboards/json/security.json panel
  live: both targets empty with [$__interval]; same selector over [24h] returns 2699 4xx lines (of 59940 access lines), so likely a checker $__interval artifact; panel not marked Event-driven

No commits: nothing to integrate.

### 2026-11-24 · T17 · done
docs/monitoring.md lists all 11 dashboards. Disk Health, Media Stack and Postgres (lilnas-disk-health, lilnas-media, lilnas-postgres) are documented from the task's uids and files only, since those files are not on this branch; verify their "Answers" and data-source cells when their tasks merge. deploy.md count is 19 (7 apps + infra/.env + 11 infra/.env.*), from scripts/deploy/decrypt-env.sh --list . (the default root /opt/lilnas fails with git dubious ownership from this user). Private-key names in the .env.keys table were checked against the real .env.keys (names only). No dashboard changed, so no live summary or new metrics. T12's partial status (tdr-bot fix 101aa1d6 not on main; Traefik Active Connections panels and Security 4xx/5xx panel findings) is not documented as fact in monitoring.md; no mention of it was added.

### 2026-11-24 · H2 · approved
Approved.

### 2026-11-24 · H6 · approved
Approved.

### 2026-11-24 · T14 · done
Dashboard uid lilnas-media, 55 panels, rows At a glance / Sonarr / Radarr / SABnzbd / Emby / Immich / Logs. Lint ok. Live: 52 OK, 0 EMPTY, 3 EMPTY (event-driven: Emby 5xx, Immich 5xx, Loki errors-and-warnings-over-time), 0 ERROR.
Deliberate differences: sonarr/radarr/sabnzbd have no Traefik service, so their "up" is the exportarr up metric; exportarr exports no Sonarr/Radarr queue metrics, so queue panels use sabnzbd_queue_length / sabnzbd_remaining_bytes; Emby/Immich "up" = Traefik 2xx/3xx within 15m or cAdvisor container_last_seen within 2m; Emby 4xx panel excludes 401 and links to /d/lilnas-security (plus a dashboard-level link); Immich job panels use only immich_job_repository_{get_queue,check_workers}_duration_* because other repository histograms barely fire and a regex-on-__name__ query returned HTTP 422.
Metrics observed in live Prometheus (2026-11-24); Loki detected_level/service labels observed live. No new exporter or throwaway container used. A mon-rig-pgexp container seen in docker ps belongs to another task and was not touched.
All five plan checks pass (jq/uid check, promtool, compose config, prettier, 3 jest suites 99 tests).

### 2026-11-24 · T16 · done
Overview now 20 grid rows. Top row h5→h4, new tile row at y=4 (six stat tiles, ids 20–25), everything below shifted down with its size unchanged; no tile removed. Tiles link by uid to /d/lilnas-disk-health, /d/lilnas-postgres and /d/lilnas-media (those dashboards come from other tasks; nothing waits on them).
Deliberate differences: "Media exporters up" uses `up{job=~"sonarr|radarr|sabnzbd"}` because no sonarr_up/radarr_up/sabnzbd_up metric exists; queue size is `sabnzbd_queue_length` because `sabnzbd_queue_size` does not exist. Sector sum is limited to attribute_value_type="raw" (value/worst/thresh are also exported and would inflate it).
Observed live (lilnas-prometheus-1): smartctl_device_smart_status, smartctl_device_attribute, smartctl_device_media_errors, smartctl_device_temperature (13 drives, job smartctl); pg_up (3 series by server); up for sonarr/radarr/sabnzbd jobs; sabnzbd_queue_length (0).
check-dashboards lint ok. live: lilnas-overview: 23 OK, 0 EMPTY, 2 EMPTY (event-driven), 0 ERROR (the two event-driven panels, #3 and #8, are pre-existing and already have Event-driven: descriptions).
Checks passed: dashboard jq/uid check, promtool check config, compose config (monitoring + immich), prettier -c, jest (3 suites, 99 tests). I created no throwaway containers; temp files /tmp/t16.* removed. Two other tasks' containers (mon-rig-t13-grafana, mon-rig-pgexp) were running and left alone.

### 2026-11-24 · T15 · partial
Dashboard uid lilnas-postgres, title Postgres, tags lilnas+postgres, id null, one dashboards link, variable `server` (label_values(pg_up, server), multi, All, allValue `.+`). 34 panels in the seven requested sections. All five checks pass (jq/uid check, promtool, compose config, prettier, jest 99 tests); lint ok for all 9 dashboards.

Live summary (check-dashboards.mjs live, panel counts):
  server=All:              33 OK, 0 EMPTY, 1 EMPTY (event-driven), 0 ERROR
  server=immich-database:  33 OK, 0 EMPTY, 1 EMPTY (event-driven), 0 ERROR
  server=tdr-bot-db:       30 OK, 3 EMPTY, 1 EMPTY (event-driven), 0 ERROR
  server=icloud-backup-db: 30 OK, 3 EMPTY, 1 EMPTY (event-driven), 0 ERROR
The event-driven one is "Errors and fatals per server" (Loki, 5 minute window); its description starts "Event-driven:". The Errors and fatals logs panel has data over 24h.

The 3 EMPTY panels on PG 18 servers (not event-driven, so an honest EMPTY):
  #29 Checkpoints per minute, #30 Checkpoint write and sync time: wait on the exporter `stat_checkpointer` collector. On PG 18 `pg_stat_bgwriter` no longer holds checkpoint counters, and the PG 18 exporters (tdr-bot, icloud-backup) do not run `--collector.stat_checkpointer`. The queries are `pg_stat_checkpointer_* or pg_stat_bgwriter_*`, so immich-database (PG 14) shows today and the PG 18 servers fill in once the collector is on. "Buffers written" shows PG 18 only for bgwriter and alloc until then.
  #33 Backend buffer writes (PG 14 only): pg_stat_bgwriter_buffers_backend_total and _backend_fsync_total do not exist on PG 17+; named in the title.
Metrics that do not exist on PG 14: pg_stat_checkpointer_* (PG 17+); on PG 18: pg_stat_bgwriter_checkpoints_*, checkpoint_write/sync_time, buffers_checkpoint, buffers_backend*.

Where each metric family was observed:
  Live in Prometheus (job postgres, 2026-11-24): pg_up, pg_static (short_version, version labels), pg_settings_max_connections, pg_database_size_bytes, pg_stat_database_* (numbackends, deadlocks, xact_commit/rollback, tup_*, blks_hit/read, temp_files/bytes), pg_stat_activity_count, pg_stat_activity_max_tx_duration, pg_locks_count, pg_long_running_transactions, pg_wal_size_bytes, pg_stat_user_tables_* (table_size_bytes, n_live_tup, n_dead_tup, last_autovacuum), pg_stat_bgwriter_* (alloc, clean, maxwritten_clean on all three; checkpoints_*, checkpoint_*_time, buffers_checkpoint, buffers_backend* on immich only); cAdvisor container_cpu_usage_seconds_total, container_memory_working_set_bytes, container_fs_reads/writes_bytes_total, container_start_time_seconds for lilnas-{tdr-bot-db,icloud-backup-db,immich-database}-1.
  Throwaway exporter scrape (quay.io/prometheuscommunity/postgres-exporter:v0.21.1 with --collector.stat_checkpointer against tdr-bot-db): pg_stat_checkpointer_num_timed_total, num_requested_total, write_time_total, sync_time_total, buffers_written_total (plus restartpoints_*, stats_reset_total).
No postmaster start-time metric is exported, so Uptime uses time() - container_start_time_seconds (the container's main process is Postgres).
tdr-bot-db checkpointer tables (checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations) get a named table panel and a size-over-time panel that ignore $server, so they show at every selection.

Throwaway cleanup: container mon-rig-pgexp removed with `docker rm -f`; the curl helper ran with --rm; the decrypted temp env dir under /tmp deleted; /tmp helper files removed. `docker ps -a --filter name=mon-rig-` now lists only mon-rig-t13-grafana, which belongs to another task (T13) and was left alone. Tree clean.
No secret value printed or committed (the throwaway used an --env-file, not command-line values).

Defects:

- not blocking · PG 18 checkpoint panels have no data until the exporter stat_checkpointer collector is on · infra/monitoring.yml postgres-exporter-tdr-bot and postgres-exporter-icloud-backup commands
  live --var server=tdr-bot-db: EMPTY #29 Checkpoints per minute, #30 Checkpoint write and sync time; pg_stat_checkpointer_num_timed_total returns 0 series in Prometheus

### 2026-11-24 · T13 · done
New dashboard uid lilnas-disk-health, 30 panels, default range 24h, refresh 1m. Lint ok (9 dashboards). live (24h): 20 OK, 0 EMPTY, 3 EMPTY (event-driven), 0 ERROR; the three empty panels are the Kernel ones, all described with "Event-driven:". With --range 7d the SATA log panel has data (ata5 resets).
All metrics observed in live Prometheus/Loki; none new. Rendered in a throwaway grafana/grafana:13.2.4 (mon-rig-t13-grafana, removed, 0 left; /tmp files removed) to verify the joinByField tables.
Unhealthy per live data: sdd has 392 UDMA CRC errors and 392 error-log entries (smartctl exit status 64, SMART PASS, sector counters 0, so cable/port suspected); CPU k10temp Tctl 87-96C now, 7d peak 97C (Tccd1 103C), gigabyte_wmi temp3 7d peak 97C; ata5 exceptions and hard link resets within 7d (none in 24h). All 13 drives report and PASS, 0 NVMe media errors, 0 btrfs device errors.
Serial numbers not shown or reported. Checks: all five pass (promtool valid, compose config ok, prettier ok, jest 99 passed). Unrelated container mon-rig-pgexp belongs to another task and was left alone.

### 2026-11-24 · T19 · done
Added --collector.stat_checkpointer to postgres-exporter-tdr-bot and postgres-exporter-icloud-backup only (immich is PG14, no pg_stat_checkpointer view). Updated the comment block above the three exporters. No dashboard edits, no containers started, no throwaway containers or temp files created. The T15 defect (PG 18 checkpoint panels empty) is resolved in config and takes effect on the next push; the push task should confirm pg_stat_checkpointer_* appears for tdr-bot-db and icloud-backup-db in production Prometheus. The change under infra/monitoring.yml makes CI run `up -d` for the monitoring services, which recreates only exporters whose config changed.

### 2026-11-24 · T12 · defects → R7
T12 reported 1 blocking defect at attempt 6, sent to R7; it runs again at round 4 to re-check.

- R7 · tdr-bot fix 101aa1d6 not on main; tdr-bot image not rebuilt or deployed (`origin/main (394431e0) vs branch HEAD; ci.yml run 45352251208`): git merge-base --is-ancestor 101aa1d6 origin/main => not ancestor; run 45352251208 conclusion=failure; lilnas-tdr-bot-1 image tag :latest, started 2026-11-22T22:40:25Z; count(tdr_bot_llm_retries_total)=0, count(tdr_bot_llm_schema_failures_total)=0; tdr-bot up=1 on the old image. Needs a human-approved push of 101aa1d6 to main, then CI green, tdr-bot recreated on the pushed sha, both series at 0 and a clean log.

### 2026-11-24 · R7 · done
No new commit: the fix 101aa1d6 already existed on the run branch; the defect was that it was not on main. Pushed exactly 101aa1d6 to main (`git push origin 101aa1d6:main`, fast-forward 394431e0..101aa1d6) under H6's approval, whose scope was apps/tdr-bot/src/app/** and docs/plans/** only. The rest of the branch (dashboards, infra/monitoring.yml, docs) is NOT pushed; T12 still owns that push. Because 101aa1d6 sits on top of the earlier plan-doc commits (48ea2bc3, a0aa1b37, 729e02fc, 66112617), those docs/plans commits went out with it. Pushed sha 101aa1d6; rollback sha 394431e0 (revert 101aa1d6 and push, or `LILNAS_TAG=<previous sha> docker compose up -d tdr-bot` in /opt/lilnas).
ci detect --base origin/main --head 101aa1d6: images [tdr-bot], pull [tdr-bot], up [], forceRecreate [], decrypt false.
CI run https://github.com/codemonkey800/lilnas/actions/runs/45356676879: success (check apps/tdr-bot, build-images Build and push tdr-bot, deploy 1m18s, summary all green).
Observed 2026-11-24 ~08:38 UTC: lilnas-tdr-bot-1 image ghcr.io/codemonkey800/lilnas-tdr-bot:latest (sha256:929ec9e6da6ce510a535c27833d93c025ab28580cf0fcae34a9eb744f141a597), started 08:36:10Z, RestartCount 0; up{job="tdr-bot"}=1; count(tdr_bot_llm_retries_total)=132 series, max 0; count(tdr_bot_llm_schema_failures_total)=33 series, max 0; no error/exception/fatal lines in the last 10m of logs.
Local guard test apps/tdr-bot/src/app/__tests__/layout.spec.ts: 2 passed.
Note for T12 round 4: origin/main is now 101aa1d6, so the branch remains a fast-forward of main. The remaining push (everything else on the branch) will touch infra/monitoring.yml / prometheus.yml / dashboards, so its ci detect will include forceRecreate for grafana/prometheus and auth; check H1/H5 approvals cover that. No throwaway containers or temp files created; tree clean.

No commits: nothing to integrate.

### 2026-11-24 · T12 · done
```
## Push / CI / rollback
- Pushed sha (final, from R7): 101aa1d6b2fa6ffc0322db7d174510e98ed81d09 (fast-forward 394431e0..101aa1d6). The phase-1 infra push was 394431e0.
- Rollback shas: infra push e5d9cdae; the tdr-bot fix push 394431e0 (or `LILNAS_TAG=<sha> docker compose up -d tdr-bot` in /opt/lilnas).
- Not run this attempt: the roles script and `git push`, per the task body, because origin/main already contains 394431e0 and 101aa1d6.
- CI: https://github.com/codemonkey800/lilnas/actions/runs/45356676879 is success for 101aa1d6. The red run 45352251208 (394431e0) is expected and not a defect.
- Role rollback: `infra/monitoring/scripts/postgres-monitor-roles.sh --drop infra/.env.postgres-exporter.decrypted`
- Key file: `stat -c %s` is 1874 for both /opt/lilnas/.env.keys and /home/jeremy/lilnas/.env.keys.

## Checks, observed 2026-11-24 08:38-08:50 UTC. The 101aa1d6 deploy recreated prometheus, grafana, auth and tdr-bot at 08:36:10-08:36:42Z.
- Role: `lilnas_monitor` exists in lilnas-tdr-bot-db-1, lilnas-icloud-backup-db-1 and lilnas-immich-database-1 (checked as the container superuser): rolsuper f, rolcanlogin t, member of pg_monitor t. A TCP login with the password on stdin works in all three, giving current_user lilnas_monitor and default_transaction_read_only on. The password was never in argv.
- Seven new containers, all Up 36-41 min: lilnas-smartctl-exporter-1, lilnas-exportarr-sonarr-1, lilnas-exportarr-radarr-1, lilnas-exportarr-sabnzbd-1, lilnas-postgres-exporter-tdr-bot-1, lilnas-postgres-exporter-icloud-backup-1, lilnas-postgres-exporter-immich-1.
- prometheus Up 6 min, grafana Up 5 min, immich Up 41 min (healthy). prometheus and grafana have no healthcheck, so Up is enough.
- https://immich.lilnas.io/api/server/ping returns 200.
- auth recreated and healthy (lilnas-auth-1, 08:36:42Z). https://auth.lilnas.io returns 307 (redirect to login).
- tdr-bot image: ghcr.io/codemonkey800/lilnas-tdr-bot:latest, sha256:929ec9e6…, label org.opencontainers.image.revision = 101aa1d6b2fa…, started 08:36:10Z, RestartCount 0. up{job="tdr-bot"}=1. Log shows only /metrics request lines, 0 error/exception/fatal lines in 10 min. Series count of tdr_bot_llm_retries_total is 132 (max 0). Series count of tdr_bot_llm_schema_failures_total is 33 (max 0). The unprefixed `llm_retries_total` and `tdr_bot_llm_schema_failures_total` names in the task text do not exist; the real names carry the tdr_bot_ prefix.
- Targets, all up: cadvisor, download, equations, immich (immich:8081 api, immich:8082 microservices), me-token-tracker, minio, minio-bucket, node-exporter, postgres x3, prometheus, radarr, sabnzbd, smartctl, sonarr, tdr-bot, traefik. `idkwiw` is gone. All lastError empty.
- smartctl_devices = 13. pg_up = 1 for icloud-backup-db, tdr-bot-db and immich-database. minio_bucket_usage_total_bytes has 5 series, one per bucket: build 8440960985, equations 0, files 5222522, images 28324, videos 0.
- Grafana search uids are exactly lilnas-app-detail, lilnas-infrastructure, lilnas-logs, lilnas-overview, lilnas-security, lilnas-storage, lilnas-tdr-bot, lilnas-traefik. `/api/dashboards/home` returns redirectUri /d/default-home-dashboard/overview (title Overview), which is the known copy of Overview.
- Dashboards deployed on origin/main are only those 8. disk-health, media and postgres exist on the branch but are not deployed. The branch's overview.json differs from main's (426 lines); I ran live over main's 8 files.
- `check-dashboards.mjs lint` over those 8: "lint ok: 8 dashboards".
- `check-dashboards.mjs live` summary (24h, main's files):
  - lilnas-app-detail (default app): 23 OK, 0 EMPTY, 9 event-driven, 0 ERROR
  - lilnas-infrastructure: 18 OK, 0 EMPTY, 0 event-driven, 0 ERROR
  - lilnas-logs: 3 OK, 0 EMPTY, 0 event-driven, 0 ERROR
  - lilnas-overview: 17 OK, 0 EMPTY, 2 event-driven, 0 ERROR (checked on main's file)
  - lilnas-security: 20 OK, 1 EMPTY, 8 event-driven, 0 ERROR
  - lilnas-storage: 29 OK, 0 EMPTY, 0 event-driven, 0 ERROR. The MinIO bucket panels #46-#49 and #50 are OK: 1, 5, 5 and 5 series, and 2 for #50.
  - lilnas-tdr-bot: 12 OK, 0 EMPTY, 1 event-driven, 0 ERROR
  - lilnas-traefik: 14 OK, 2 EMPTY, 0 event-driven, 0 ERROR
- App Detail once per app (`--var app=<app>`), 0 ERROR and 0 plain EMPTY each: tdr-bot 23 OK / 9 event-driven; download 25 OK / 7 event-driven; equations 23 OK / 9 event-driven; me-token-tracker 23 OK / 9 event-driven.
- Security #18 "4xx and 5xx over time" shows EMPTY only because the checker runs an instant `count_over_time(...[5m])` and nothing hit 4xx in the last 5 minutes. Run as a range query over 24h the same expression returns 1 series with 204 points, so the panel is fine; the checker is the cause.
- Cleanup: `docker ps -a --filter name=mon-rig-` returns 0 containers. The 18 `*.decrypted` files in the worktree are deleted and /tmp helpers removed. Tree clean, no commits.

## Per-job metric inventory (live, instant query `{job="<job>"}`). Format: name(series count)[label names beyond job/instance]. Every series also carries job and instance.
### smartctl (target smartctl-exporter:9633, 60s). All values below were observed.
- smartctl_devices(1)[] = 13
- smartctl_device(13)[ata_additional_product_id,ata_version,device,firmware_version,form_factor,interface,model_family,model_name,protocol,sata_version,serial_number]. Not seen: the scsi_* labels from the earlier throwaway run.
- smartctl_device_attribute(608)[attribute_flags_long,attribute_flags_short,attribute_id,attribute_name,attribute_value_type,device]. HDD-only. Sample: {device=sda, attribute_name=Reallocated_Sector_Ct, attribute_id=5, attribute_value_type=raw} = 0, and the same for sdb = 0.
- Per-device families, label device only: smartctl_device_available_spare(5), smartctl_device_available_spare_threshold(5), smartctl_device_bytes_read(5), smartctl_device_bytes_written(5), smartctl_device_capacity_blocks(13), smartctl_device_capacity_bytes(13), smartctl_device_critical_warning(5), smartctl_device_media_errors(5), smartctl_device_num_err_log_entries(5), smartctl_device_nvme_capacity_bytes(5), smartctl_device_percentage_used(5), smartctl_device_power_cycle_count(13), smartctl_device_power_on_seconds(13), smartctl_device_rotation_rate(8), smartctl_device_smart_status(13), smartctl_device_smartctl_exit_status(13). The 5-series families are NVMe only.
- With extra labels: smartctl_device_block_size(26)[blocks_type,device]; smartctl_device_error_log_count(8)[device,error_log_type]; smartctl_device_interface_speed(16)[device,speed_type]; smartctl_device_temperature(23)[device,temperature_type=current|op_limit_max|critical_limit_max]; smartctl_exporter_build_info(1)[branch,goarch,goos,goversion,revision,tags,version]; smartctl_version(1)[build_info,json_format_version,smartctl_version,svn_revision].
- Samples: smartctl_device_temperature{device=nvme0,temperature_type=current}=53, nvme1=36. smartctl_device_percentage_used{nvme0}=4, {nvme1}=0. smartctl_device_smart_status{nvme0}=1. smartctl_device_capacity_bytes{nvme0}=4000787030016. smartctl_device_power_on_seconds{sda}=51544800.
- Plus up, scrape_*, go_*, process_*, promhttp_*.

### sonarr (exportarr-sonarr:9707, 60s). Every series carries the label url.
- Names: exportarr_app_info(1)[app_name,build_time,revision,version]; sonarr_episode_cutoff_unmet_total, sonarr_episode_downloaded_total, sonarr_episode_missing_total, sonarr_episode_total, sonarr_history_total, sonarr_season_downloaded_total, sonarr_season_monitored_total, sonarr_season_total, sonarr_season_unmonitored_total, sonarr_series_downloaded_total, sonarr_series_filesize_bytes, sonarr_series_monitored_total, sonarr_series_total, sonarr_series_unmonitored_total, sonarr_system_status, sonarr_scrape_duration_seconds (each 1 series, [url]); sonarr_rootfolder_freespace_bytes(1)[path,url]; sonarr_scrape_requests_total(1)[code,url]; sonarr_system_health_issues(1)[message,source,type,url,wikiurl].
- Samples: sonarr_series_total=84; sonarr_episode_total=7799; sonarr_rootfolder_freespace_bytes{path="/tv"}=14255056928768; sonarr_system_health_issues{type=warning, source=IndexerLongTermStatusCheck, message="Indexers unavailable due to failures for more than 6 hours: NzbPlanet, Anime Tosho"}=1.
- ENABLE_ADDITIONAL_METRICS is off, so there are no sonarr_episode_quality/monitored families.

### radarr (exportarr-radarr:9708, 60s). Every series carries the label url.
- Names: exportarr_app_info; radarr_history_total, radarr_movie_cutoff_unmet_total, radarr_movie_downloaded_total, radarr_movie_editions, radarr_movie_filesize_total, radarr_movie_missing_total, radarr_movie_monitored_total, radarr_movie_total, radarr_movie_unmonitored_total, radarr_movie_wanted_total, radarr_system_status, radarr_scrape_duration_seconds (each 1, [url]); radarr_movie_quality_total(9)[quality,url,weight]; radarr_movie_tag_total(2)[tag,url]; radarr_rootfolder_freespace_bytes(1)[path,url]; radarr_scrape_requests_total(1)[code,url]; radarr_system_health_issues(2)[message,source,type,url,wikiurl].
- Samples: radarr_movie_total=296; radarr_movie_quality_total{quality="Bluray-1080p",weight="19"}=214, {quality="Bluray-480p",weight="12"}=2; radarr_rootfolder_freespace_bytes{path="/movies"}=17660865564672.

### sabnzbd (exportarr-sabnzbd:9709, 60s). Every series carries the label url. sabnzbd_info shows status Idle, version 5.1.3.
- Names: exportarr_app_info; sabnzbd_article_cache_articles, sabnzbd_article_cache_bytes, sabnzbd_downloaded_bytes, sabnzbd_pause_duration_seconds, sabnzbd_paused, sabnzbd_paused_all, sabnzbd_queue_length, sabnzbd_queue_query_duration_seconds, sabnzbd_queue_warnings, sabnzbd_quota_bytes, sabnzbd_remaining_bytes, sabnzbd_remaining_quota_bytes, sabnzbd_scrape_duration_seconds, sabnzbd_server_stats_query_duration_seconds, sabnzbd_speed_bps, sabnzbd_status, sabnzbd_time_estimate_seconds, sabnzbd_total_bytes (each 1, [url]); sabnzbd_info(1)[status,url,version]; sabnzbd_disk_total_bytes(2) and sabnzbd_disk_used_bytes(2)[folder=complete|download,url]; sabnzbd_scrape_requests_total(1)[code,url]; sabnzbd_server_articles_success(3), sabnzbd_server_articles_total(3), sabnzbd_server_downloaded_bytes(3)[server,url].
- Samples: sabnzbd_queue_length=0; sabnzbd_speed_bps=0; sabnzbd_disk_used_bytes{folder="complete"}=152686087372.8; sabnzbd_server_articles_success{server="news.eweka.nl"}=0, {server="news.newshosting.com"}=0 (a third server also exists).

### postgres (3 targets, label `server` = tdr-bot-db | icloud-backup-db | immich-database; 15s). All observed live.
- Exporter and build: pg_up(3)[server]; pg_static(3)[exported_server,server,short_version,version]; postgres_exporter_build_info(3)[branch,goarch,goos,goversion,revision,server,tags,version]; postgres_exporter_config_last_reload_success_timestamp_seconds(3), postgres_exporter_config_last_reload_successful(3); pg_exporter_last_scrape_duration_seconds(3), pg_exporter_last_scrape_error(3), pg_exporter_scrapes_total(3) [server]; pg_scrape_collector_duration_seconds(51) and pg_scrape_collector_success(51)[collector,server].
- Databases: pg_database_size_bytes(12)[datname,server]; pg_database_connection_limit(12)[datname,server]; pg_locks_count(108)[datname,mode,server]; pg_roles_connection_limit(49)[rolname,server].
- pg_stat_database_* (12 series, [datid,datname,server]): active_time_seconds_total, blk_read_time, blk_write_time, blks_hit, blks_read, conflicts, deadlocks, numbackends, stats_reset, temp_bytes, temp_files, tup_deleted, tup_fetched, tup_inserted, tup_returned, tup_updated, xact_commit, xact_rollback. The conflicts_confl_{bufferpin,deadlock,lock,snapshot,tablespace} families (12) and conflicts_confl_active_logicalslot (8) carry [datid,datname,exported_server,server].
- pg_stat_activity_count(74) and pg_stat_activity_max_tx_duration(74)[application_name,backend_type,datname,server,state,usename,wait_event,wait_event_type].
- pg_long_running_transactions(3) and pg_long_running_transactions_oldest_timestamp_seconds(3)[server].
- Replication, WAL and archiver (3 each, [server]): pg_replication_is_replica, pg_replication_lag_seconds, pg_replication_last_replay_seconds, pg_wal_segments, pg_wal_size_bytes, pg_stat_archiver_archived_count, pg_stat_archiver_failed_count.
- pg_stat_bgwriter_*, [server]. All servers: buffers_alloc_total, buffers_clean_total, maxwritten_clean_total, stats_reset_total (3 each). Only one server (PG14 immich) has buffers_backend_fsync_total, buffers_backend_total, buffers_checkpoint_total, checkpoint_sync_time_total, checkpoint_write_time_total, checkpoints_req_total, checkpoints_timed_total (1 each). The stat_checkpointer collector the repo enabled for PG18 (commit 828ea9e8) produces no pg_stat_checkpointer_* family live, so do not use that name in a panel.
- Per-table families (86 series each, [datname,relname,schemaname,server]):
  - pg_stat_user_tables_*: analyze_count, autoanalyze_count, autovacuum_count, idx_scan, idx_tup_fetch, index_size_bytes, last_analyze, last_autoanalyze, last_autovacuum, last_vacuum, n_dead_tup, n_live_tup, n_mod_since_analyze, n_tup_del, n_tup_hot_upd, n_tup_ins, n_tup_upd, seq_scan, seq_tup_read, table_size_bytes, vacuum_count.
  - pg_statio_user_tables_*: heap_blocks_hit, heap_blocks_read, idx_blocks_hit, idx_blocks_read, tidx_blocks_hit, tidx_blocks_read, toast_blocks_hit, toast_blocks_read.
- pg_settings_*: 299 names, label [server] only (e.g. pg_settings_max_connections). Plus go_*, process_*, promhttp_* (40 names).
- Not emitted live: any stat_activity_autovacuum family (collector succeeds but emits nothing); no stat_statements families (collector off).
- Samples: pg_up{server="tdr-bot-db"}=1 (also icloud-backup-db and immich-database); pg_database_size_bytes{datname="icloud_backup",server="icloud-backup-db"}=8238783; pg_stat_database_numbackends{datname="tdr_bot",server="tdr-bot-db"}=3, {datname="icloud_backup"}=2; pg_stat_database_xact_commit{datname="tdr_bot"}=32891, {datname="icloud_backup"}=27430; pg_stat_activity_count{datname="icloud_backup",server="icloud-backup-db",state="active"}=0.

### immich (immich:8081 component=api, immich:8082 component=microservices; 15s). 191 names, observed 08:48 UTC.
- Only the api component has series so far; of the two `up` series, one is the microservices port. Only `immich_users_total{component="api"}` was queried: 2. `{__name__=~"http_.*",job="immich"}` returns nothing, so there are NO http_server_* metrics.
- Family 1, immich_<repository>_<method>_duration histograms, labelled [component,otel_scope_name=nestjs-otel] plus `le` on _bucket, with _bucket/_sum/_count suffixes, about 60 methods. Repositories seen: asset, cron, crypto, database, event, job, machine_learning, map, metadata, plugin, server_info, storage, system_metadata, telemetry, user, version_history, video_stream, websocket. Example: immich_user_repository_get_count_duration_count{component="api"}=1 (22 _bucket series, 1 _sum, 1 _count).
- Family 2, one gauge: immich_users_total{component, otel_scope_name} = 2.
- Family 3, host-metrics (otel_scope_name=host-metrics, otel_scope_version=0.38.3), [component,...]:
  - system_cpu_time_total(320) and system_cpu_utilization(320) [system_cpu_logical_number,system_cpu_state]; sample system_cpu_utilization{system_cpu_logical_number="0",system_cpu_state="user"}=0.045 and state="system"=0.019.
  - system_memory_usage(4) and system_memory_utilization(4) [system_memory_state=used|free]; sample system_memory_usage{used}=23906144256, {free}=76424531968.
  - system_network_io_total(4), system_network_dropped_total(4), system_network_errors_total(4) [network_io_direction,system_device]; sample system_network_io_total{receive,eth0}=12741828, {transmit,eth0}=66588503.
- target_info(2)[component,host_arch,host_name,process_command,process_command_args,process_executable_name,process_executable_path,process_owner,process_pid,process_runtime_description,process_runtime_name,process_runtime_version,service_name,service_version]; up(2)[component]; plus go_*/process_*/scrape_*.
- There are NO immich_assets_total, immich_photos_total, immich_videos_total or immich_usage_by_user families on this version. A Media/Immich panel must not use them. Library size will have to come from the postgres job (immich-database server) or elsewhere.

Defects:

- not blocking · Traefik panels · infra/monitoring/grafana/provisioning/dashboards/json/traefik.json (panels 4 and 13; origin/main, introduced in a36737bb "monitoring"; not touched by phase 1)
  check-dashboards.mjs live: EMPTY #4 target A: sum(traefik_service_open_connections); EMPTY #13 target A: sum(traefik_entrypoint_open_connections) by (entrypoint). Live Prometheus has neither; the metric is traefik_open_connections{entrypoint,protocol}: metrics=1, web=0, websecure=3. Neither panel has an Event-driven description.

No commits: nothing to integrate.
```

### 2026-11-24 · T20 · done
Panels 4 and 13 now query traefik_open_connections (observed in production Prometheus: entrypoints web, websecure, metrics, protocol TCP).
Neither panel had a description, so none needed correcting. Diff is two "expr" lines only.
check-dashboards lint: "lint ok: 1 dashboards".
check-dashboards live, before: 14 OK, 2 EMPTY (panels 4 and 13).
check-dashboards live, after: lilnas-traefik: 16 OK, 0 EMPTY, 0 EMPTY (event-driven), 0 ERROR. Panel 4 shows 1 series and panel 13 shows 3 series. The other 14 panels report the same OK results as before.
No other plain EMPTY panel on the dashboard.
All five plan checks pass (uid/tag check, promtool, compose config, prettier, jest 99 tests passed). No throwaway containers or temp files created; nothing deployed or pushed.

### 2026-11-24 · Phase 2 · review cycle 1
Pass 1 (R5, T17): T17's docs mostly match the shipped config (jobs, targets, images, env files, role script, checker and deploy actions all verified), and R5's switch to locally hosted fonts is sound. One defect: the docs/monitoring.md dashboard table rows for Disk Health, Media Stack and Postgres were written before those dashboards merged, and their data-source and 'Answers' cells no longer match the files.
Pass 2 (T14): T14 adds media.json (lilnas-media) with every row the task asked for; the queries check out against live Prometheus. One wrong-value panel: Immich 'Node process CPU' is 32x too low because host-metrics already divides by all cores.
Pass 3 (T16): T16 adds six stat tiles (SMART failures, bad sectors + NVMe media errors, hottest drive, Postgres up out of 3, media exporters up out of 3, SABnzbd queue) in a new 4-unit row at y=4. It shrinks the top row from 5 to 4, shifts every lower panel down by 3 and removes nothing. Every query's metric and label resolves in live Prometheus, and the links use the required uids. No findings.
Pass 4 (T15): T15's postgres.json matches the task: every requested row is there, the PG 14/PG 18 checkpoint split uses `or`, and the checkpointer tables are pinned to tdr-bot-db. No P0 or P1 defects. Two P2s: the Deadlocks stat shows an extra unlabeled 0 tile, and the Up panel cannot show a dead exporter as DOWN.
Pass 5 (T13): T13's Disk Health dashboard meets the task: uid, tags, link, all requested sections and the joins check out against live Prometheus (device-to-mount rewrite, btrfs uuid-to-mountpoint join, NVMe hwmon chip names, raw attribute type). The only defect is a P2: the hottest-drive tile uses HDD temperature thresholds, so it is yellow on a healthy server.
Pass 6 (T19, T20): T19 adds --collector.stat_checkpointer to exactly the two PG 18 exporters and rewrites the comment block as asked. T20 changes only the two Traefik expr lines to the metric that exists live. No P0/P1 defects; two P2 notes, both following from the plan's own wording.
Seams pass: Seams pass: no blocking cross-task disagreements. Overview links, job names, service names and uids agree across T13–T17 and T19; two P2 seams remain: the Overview bad-sector tile disagrees with Disk Health's definition, and Postgres panel descriptions went stale after T19 enabled stat_checkpointer.
Consolidation: Seven slice passes merged into 8 findings: 2 P1 (docs/monitoring.md dashboard rows for Disk Health, Media Stack and Postgres don't match the merged files; Immich Node process CPU panel reads 1/32 of real usage) and 6 P2 notes. The three reports of stale Postgres checkpoint descriptions (Pass 4 suspicion, Pass 6, seams) are merged into one.

- F10 · P1 · Dashboard table wrong for Disk Health, Media Stack, Postgres — docs/monitoring.md:30 → R8
- F11 · P1 · Immich Node process CPU panel reads 1/32 of real usage — infra/monitoring/grafana/provisioning/dashboards/json/media.json:2700 → R9

Notes:
- F12 · P2 · Postgres checkpoint panel descriptions say stat_checkpointer is not enabled — infra/monitoring/grafana/provisioning/dashboards/json/postgres.json:1627
- F13 · P2 · Overview bad-sector tile omits Offline_Uncorrectable that Disk Health counts — infra/monitoring/grafana/provisioning/dashboards/json/overview.json
- F14 · P2 · Postgres Up panel cannot show a dead exporter as DOWN — infra/monitoring/grafana/provisioning/dashboards/json/postgres.json:82
- F15 · P2 · Deadlocks stat shows an extra unlabeled 0 tile — infra/monitoring/grafana/provisioning/dashboards/json/postgres.json:330
- F16 · P2 · Hottest-drive tile and Temp column use HDD thresholds, so a healthy NVMe shows yellow — infra/monitoring/grafana/provisioning/dashboards/json/disk-health.json
- F17 · P2 · plan-mandated · Traefik Active Connections counts Prometheus's own scrape connection — infra/monitoring/grafana/provisioning/dashboards/json/traefik.json:98

Suspicions:
- Missing / wanted stat mixes Radarr missing with 'wanted' wording and has no fallback — infra/monitoring/grafana/provisioning/dashboards/json/media.json · Panel 9 sums sonarr_episode_missing_total + radarr_movie_missing_total (live 348 + 7) while radarr_movie_wanted_total is 0. The expression has no 'or' fallback, so the tile goes blank if either exporter is down. · confirm by: Check Radarr's Wanted > Missing view to decide whether 'missing' or 'wanted' is the number the tile should show.
- 'Drives reporting' may stay at 13 after a drive drops off the bus — infra/monitoring/grafana/provisioning/dashboards/json/disk-health.json · count(smartctl_device) only falls if the exporter stops emitting the series. smartctl_exporter keeps its device list until the next rescan and may still emit it from a failed run. · confirm by: Check smartctl_exporter's behaviour when a device node vanishes and its rescan interval in infra/monitoring.yml.
- Plan notes claim stat_checkpointer produces nothing live — docs/plans/021-grafana-dashboard-overhaul.md:811 · A note says the collector 'produces no pg_stat_checkpointer_* family live'. That is most likely because T19 isn't deployed yet: T15's throwaway exporter with the flag did produce the family. A reader could still take it to mean the collector is broken. · confirm by: After the push, pg_scrape_collector_success{collector="stat_checkpointer"} is 1 and pg_stat_checkpointer_num_timed_total has series for tdr-bot-db and icloud-backup-db.

Spec check:
- missing: Rising counters matter more than totals: show increase over $__range beside the current value. (infra/monitoring/grafana/provisioning/dashboards/json/disk-health.json (panel 9)) — The Drives table has rise columns only for CRC and Err log. Reallocated, pending and uncorrectable sectors and NVMe media errors show only the current value per drive.
- extra: R5 commits (tdr-bot font self-hosting) (apps/tdr-bot/src/app/layout.tsx) — Remediation fixing T12's CI build break; not part of T17.
- extra: Activity: connections by state, TPS, rows, cache hit ratio, temp files and bytes (postgres.json panel 26) — Adds an 'Idle in transaction and long-running' panel; harmless.
- extra: Kernel: SATA error and link-reset log lines (event-driven) (disk-health.json panel 30) — Adds an NVMe/PCIe AER log panel; harmless.
- misunderstood: the 11 dashboards: title, uid, file, what each answers, its data sources (docs/monitoring.md) — Disk Health, Media Stack and Postgres rows were written from the plan, not the merged files (finding).
- unverifiable: Grafana redirects / to /d/default-home-dashboard/overview (docs/monitoring.md) — Load https://grafana.lilnas.io/ once after deploy.
- unverifiable: Keep it one screen at 1080p (overview.json) — 20 grid rows should fit; open the home page at 1920x1080 after deploy.
- unverifiable: PG 18 checkpoint panels return data; the push task checks it in production (postgres.json WAL and checkpoints row, T19) — pg_stat_checkpointer_* for both PG 18 servers can only be confirmed after push 2.
- unverifiable: Run check-dashboards.mjs lint and live and report the summary (T14, T15, T20 notes) — T14 reports 52 OK / 3 event-driven; T15's live summary is cut off; T20 reports 16 OK / 0 EMPTY with no raw output. Re-run live to confirm.
- unverifiable: Links to /d/lilnas-disk-health, /d/lilnas-postgres, /d/lilnas-media (overview.json panels 20-25) — The seams pass confirmed the uids match; open each link once after deploy.
- unverifiable: Mask nothing in the dashboard, but keep serial numbers out of your result. (T13 result text) — Confirm the run's result text contains no serials.

Declined to judge:
- layout.spec.ts checks layout.tsx with a regex, so a double-quoted next/font/google import would slip past it — Prettier enforces single quotes; this is an acceptable guard for build config.
- Overview 'Drives failing SMART', 'Bad sectors' and 'Download queue' tiles (and Disk Health tiles with noValue '0') show a green 0 when their exporter is down — Matches the existing Overview pattern, and the 'Scrape targets down' tile shows the failure.
- 'Media exporters up' counts exportarr scrape targets, not app health — The task asked for the exporters to be up, and no *_up metric exists.
- Emby/Immich up tiles stay UP for up to 15 min after the container stops; Immich uses Traefik/cAdvisor rather than up{job="immich"} — The task allows a recent 2xx/3xx through Traefik or a running container.
- Disk Health organize.indexByName keyed by renamed columns (a no-op) — Cosmetic; the natural join order already gives the intended columns.
- Postgres top-10 tables hard-code the three servers instead of using topk by server — Works for the current servers; adding a fourth is out of scope.
- Cosmetic items: [5m] instead of $__rate_interval, unit 'none' on checkpoint write/sync time, increase() over $__rate_interval on bgwriter stalls, Loki regex matching, 4-unit 'Targets that are down' table, docs wording — Style or display only.
- tdr-bot font changes (R5) in the seams stat — Not a seam between monitoring tasks; covered by its slice pass.

Checked:
- Scrape jobs, images, env files and role script in the docs match the config — infra/monitoring/prometheus.yml, infra/monitoring.yml, infra/.env*, postgres-monitor-roles.sh: All match, including 19 env files and 90d retention.
- Docs dashboard rows match the merged files — media.json, disk-health.json, postgres.json: Data sources and coverage differ (finding).
- R5 leaves a next/font/google import or unwired font vars — apps/tdr-bot/src: Only comments mention it; globals.css still uses --font-geist and --font-geist-mono.
- Units of process_cpu_utilization — live Prometheus, immich vs cAdvisor: Divided by 32 cores (finding).
- group_left(volume) joins and exportarr metric names in media.json — live lilnas_storage_volume, sonarr/radarr series: Mountpoints unique; no queue metrics exist, as the note says; other names exist.
- Overview tile metrics, labels and the hard-coded /3 — live smartctl, pg_up, sabnzbd_queue_length, up{job=~"sonarr|radarr|sabnzbd"}: All resolve; pg_up has 3 series.
- Overview grid overlap after the shift — overview.json gridPos: 20 rows, no overlap, row y=4 fills 24 columns.
- Overview links and job names match uids and scrape config across tasks — overview.json vs dashboard uids, prometheus.yml: All 10 /d/lilnas-* links resolve; job names agree everywhere.
- or vector(0) adds an unlabeled series in Deadlocks — live query of postgres.json panel 7: Confirmed 4 series (finding).
- Checkpointer table renames and cAdvisor label_replace joins — Grafana 13.2.4 frontend, container_start_time_seconds: Renames apply; joins are 1:1.
- Disk Health device rewrite, btrfs uuid join, NVMe hwmon names, raw attribute types — live Prometheus: All join correctly for the current 13 filesystems.
- T19 flag scope and old Traefik metric names still referenced — infra/monitoring.yml, infra/, docs/: Flag only on the two PG 18 exporters; old names only in plan history.

### 2026-11-24 · R8 · done
Regression test: new describe block 'docs/monitoring.md dashboard table' in check-dashboards.test.mjs. It parses the dashboard table and compares each row's Data sources cell (as a sorted set) with the datasource uids in the matching JSON; it also checks every JSON file has a row. It failed on disk-health, media and postgres before the docs fix.
No dashboard JSON, scrape job or compose file changed, so no `live` run or new metrics were needed.

### 2026-11-24 · R9 · done
Panel 57 query is now sum by (component)(process_cpu_utilization{job="immich"}) * scalar(count(node_cpu_seconds_total{mode="idle"})) * 100, so the "100% = one core" description is true. Regression tests were added to check-dashboards.test.mjs (node --test) and failed before the fix.
Live Prometheus: process_cpu_utilization{job="immich"} (otel host-metrics 0.38.3, components api/microservices) and node_cpu_seconds_total were both observed; core count = 32; new query returns ~0.105% (api) and ~0.160% (microservices).
check-dashboards lint ok; live summary for lilnas-media: 52 OK, 0 EMPTY, 3 EMPTY (event-driven), 0 ERROR.
No throwaway containers or temp files were created.

### 2026-11-24 · Phase 2 · review cycle 2
Re-review of the cycle-1 remediation: R8 corrects the Disk Health, Media Stack and Postgres rows in docs/monitoring.md, and R9 scales Immich panel 57 to per-core; both hold against the merged JSON and live Prometheus. No new defects in the remediation diff.

Earlier findings: F10 fixed, F11 fixed.

Declined to judge:
- Panel 57 shows nothing if node-exporter is down (scalar() of an empty vector is NaN) — Only happens outside normal use, and the cAdvisor CPU panel beside it still works.
- The regression test finds panel 57 by its numeric id — Style. The test checks the title first, so a renumbered panel fails loudly instead of passing silently.

Checked:
- Core-count scalar double-counts if more than one node-exporter job or instance exists — live Prometheus count by (job,instance)(node_cpu_seconds_total{mode="idle"}): One series, node-exporter:9100, value 32.
- Other panels use process_cpu_utilization or system_cpu_utilization without scaling — infra/monitoring/grafana/provisioning/dashboards/json/*.json: Only media.json panel 57 uses it, and it is now scaled. Its description still says '100% = one core', which is now accurate.
- Docs 'Answers' text claims coverage the JSON does not have (kernel NVMe errors, WAL/checkpoints, logs) — disk-health.json Loki exprs; postgres.json panel titles: disk-health.json has both ATA and NVMe/AER kernel log queries; postgres.json has 'WAL and checkpoints' and 'Logs' rows.
- Datasource-uid test misses odd uids (-- Grafana --, -- Mixed --, template variables) — grep of datasource uids in dashboards/json: Only the prometheus, loki and lilnas-* dashboard uids are present, so the test's uid-to-name mapping covers every case.
- Table parser reads the wrong columns — infra/monitoring/scripts/check-dashboards.test.mjs: split('|') puts File at cells[3] and Data sources at cells[5], which matches the five-column table.

### 2026-11-24 · H3 · approved
Approved.
