# Download Backend — Verification Status

What has actually been proven to work against the real Radarr, Sonarr, Emby and
MinIO, and what has not. Produced by the plan-009 verification script
(`apps/download/scripts/verify/`) run against the live backend on the lilnas
host, **2026-08-27**.

> **Why this document exists.** The 59 test files under
> `apps/download/src/**/__tests__/` all call `jest.mock('@lilnas/media/radarr')`
> and assert against payloads a human wrote. They prove the _logic_ is right.
> They cannot tell you whether the service works. Everything below is the
> difference between those two claims.

**Scope note:** this reflects the `jeremy/download` branch deployed to the
`download` container. It is **not** merged to `main`, and `main` has none of
Phases 0–8.

---

## Summary

|                      |                                               |
| -------------------- | --------------------------------------------- |
| Read checks verified | **20 of 42** rows                             |
| Remaining failures   | **2** — both the auth deploy dependency       |
| Write path           | **All three media types verified end to end** |
| Real bugs found      | **3** (1 fixed, 2 outstanding)                |

The core request → download → cleanup flow works for movies, shows and videos
against real upstreams. Both remaining failures are in `auth`, not `download`.

---

## ✅ Verified working

### Write path

Exercised by `verify-backend.ts mutate` — real requests, real indexer searches,
real cleanup.

| Pass      | What was proven                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Movie** | Job created → advanced `searching → downloading` against a real indexer → `DELETE` → confirmed out of the library                                             |
| **Show**  | `POST {"tvdbId":276842,"seasonNumber":1}` → scope **round-tripped onto the job** → one `SeasonSearch`, not a `SeriesSearch` → series deleted → confirmed gone |
| **Video** | `pending → downloading → completed` → MinIO served the object back (`application/mp4`, 139,793 bytes)                                                         |

The show pass matters beyond "it works": it proves a scoped request stays
scoped. An unscoped `POST /download/shows` monitors every season and searches
every missing episode.

### Read path

- **Every envelope schema parsed real upstream responses with zero drift.**
  This was the central question the verification script existed to answer.
- **17 routes answered 200 and parsed**, including `activity`, `gallery`,
  `gallery-facets`, `discover`, `history`, both `/search` routes,
  `media-detail`, `media-bad-files`, `media-file`, all three job-by-id routes,
  both `ytdlp` routes, and `auth/whoami`.
- **Cursor pagination round-trips** on `/discover` — 10 + 10 of 40, no overlap,
  stable `total`.
- **`degradedSources: []`** with both upstreams answering `200`.
- **Guards behave correctly** — 401 anonymous, 200 with `X-Forwarded-User`.
  This confirmed `/auth/whoami` **is** guarded, contradicting plan 009's own
  route table.

---

## ❌ Not working

| What                                                        | Cause                                                                                                                                              | Status                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Admin routes** (`/admin/audit-log`, `/admin/stats` → 403) | Deployed `auth` is built from `main`, which lacks `GET /admin/check` (ships in `6883859` on this branch). `AdminCheckService` is fail-closed → 403 | **Clears on merge.** Not a download bug                 |
| **Emby integration** (401; all titles `state: 'unknown'`)   | `EMBY_API_KEY` in `.env.prod` is a placeholder                                                                                                     | **Needs a real key.** Degrades cleanly                  |
| **`GET /media/:id/releases` mutates the library**           | `withMonitoring` → `ensureMovie` → `postApiV3Movie` adds the movie to Radarr if not held. `restore: true` restores only _monitoring_, not removal  | **Open bug.** A read route with a permanent side effect |
| **No way to delete a video**                                | No route exists. `PATCH /videos/:id/cancel` 404s once `Completed`; `DELETE /media/:id/files` rejects `video:` keys via `parseReleaseTarget`        | **Open gap.** Objects must be removed by hand           |

### Fixed during verification

| What                                                                                                    | Cause                                                                                                                                                                                                                  | Fix       |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **`POST /download/videos` 500'd on every request** — video downloads were entirely broken in production | `EACCES: mkdir '/download'`. `DownloadVideoService` hardcodes `VIDEO_DIR = '/download/videos'`; the container runs as UID 1000 and nothing ever created that path — not the Dockerfile, not `deploy.yml`, not `main`'s | `f086c62` |

All 59 mocked test files pass on that bug, because they mock the filesystem.
It is the clearest example of what this exercise was for.

---

## ⚠️ Never exercised

**Do not read these as working.** They were skipped, and the report counts them
apart from passes for exactly that reason.

- **`GET /media/:id/releases`** — behind `--include-expensive`, never run. It
  fires a real 30s+ indexer search, and per the finding above would also add
  movies to Radarr.
- **`GET /media/:id/seasons`** — skipped: no _held_ show exists in the library
  to ask about.
- **`PATCH /videos/:id/pause` and `/resume`** — untouched.
- **`POST /media/:id/releases/grab`, `/replace`, `/bad-files`** — the remaining
  write routes. Untouched.
- **Cursor pagination on `activity`, `gallery`, `history`** — every result set
  fit on one page, so the round trip never ran there.
- **Audit log and admin stats contents** — blocked by the 403.

### Passed, but validated nothing

Five routes answered 200 with **empty lists**: `activity`, `gallery`,
`gallery-facets`, `history`, `media-bad-files`. The envelope is verified; the
element schemas inside were never exercised. The report marks these as
"validated nothing" so they cannot be misread as coverage.

---

## Deployment prerequisites this uncovered

Neither was written down anywhere before.

1. **`/storage/app-data/download` must be owned by UID 1000.** Docker
   auto-creates it as `root:root` and the container runs as `node`, so a fresh
   deploy dies at boot with `SQLITE_CANTOPEN`. `deploy.yml` documents the
   `chown 1000:1000` in a comment, but it is not part of any deploy step.
2. **`download` depends on `auth` shipping from the same branch.** The admin
   surface is broken whenever `auth` predates `6883859`. This is a cross-service
   deploy-ordering constraint that no mocked test can catch.

---

## Reproducing this

Run on the lilnas host, from `apps/download`:

```bash
# Read-only sweep
pnpm exec tsx scripts/verify/verify-backend.ts capture --repo-path /home/jeremy/lilnas --as-admin
pnpm exec tsx scripts/verify/verify-backend.ts check

# Write path — creates and deletes real content; read the guardrails first
pnpm exec tsx scripts/verify/verify-backend.ts preflight --repo-path /home/jeremy/lilnas
pnpm exec tsx scripts/verify/verify-backend.ts mutate --repo-path /home/jeremy/lilnas --only movie
```

⚠️ **Read the verdict line, not the colour.** A run that is mostly skips prints
`MOSTLY UNVERIFIED`; a run that validated nothing prints `NOT A PASS` even with
zero failures.

⚠️ **Captures are gitignored and stay that way** — they hold real requester
emails and real library contents. Paste the _report_, never the captures.

Full task-by-task history, including the findings that corrected the plan's own
premises, is in
[`docs/features/download/plans/009-backend-verification-script.md`](../features/download/plans/009-backend-verification-script.md).
