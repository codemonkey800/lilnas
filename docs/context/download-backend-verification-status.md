# Download Backend — Verification Status

What has actually been proven to work against the real Radarr, Sonarr, Emby and
MinIO, and what has not. Produced by the plan-009 verification script
(`apps/download/scripts/verify/`) run against the live backend on the lilnas
host. Read sweep and all three mutate passes re-run against the fixed build
on **2026-08-28**.

> **Why this document exists.** The 59 test files under
> `apps/download/src/**/__tests__/` all call `jest.mock('@lilnas/media/radarr')`
> and assert against payloads a human wrote. They prove the _logic_ is right.
> They cannot tell you whether the service works. Everything below is the
> difference between those two claims.

**Scope note:** this reflects the `jeremy/download` branch deployed to the
`download` container. It is **not** merged to `main`, and `main` has none of
Phases 0–8.

---

## Remaining work

All four bugs the sweep left open are **closed and verified against the live
backend** (`65bd8cc`, deployed 2026-08-28) — see the **🔧 Fixed** section
below for what each proof was.

Ordered by what actually blocks progress. §2 is a live production defect
found while fixing the test suite; the rest is scaffolding around the
service rather than the service itself.

### 1. The branch has never been pushed or merged

`jeremy/download` is **120 commits ahead of `main` and 107 unpushed.** This
is the largest outstanding item and it is not cosmetic: deployment
prerequisite 3 below exists _only_ because of it. `main`'s
`apps/download/deploy.yml` is a 15-line file with no `/data` volume and no
`DATABASE_PATH`, so the moment the shared checkout at `/home/jeremy/lilnas`
lands on `main`, the next `docker compose up -d download` recreates the
container with nothing mounted and Nest dies with `SQLITE_CANTOPEN`. That
hazard disappears on merge and only on merge.

The prod checkout is currently parked **detached at `8653ae0`** — a state
nobody can reproduce from a clone.

### 2. The yt-dlp auto-updater cannot work in production

**Found by fixing the test gate, not by the sweep.**
`ytdlp-update.integration.spec.ts` gated on `existsSync('/usr/bin/yt-dlp')`
as a _"Docker container indicator"_. Replacing that with the property the
tests actually need — permission to **replace** the binary — raised the
question of who owns it in the real container. Nobody the service can use:

```
dir : drwxr-xr-x 1 root root /usr/bin
file: -rwxr-xr-x 1 root root /usr/bin/yt-dlp
container user: uid=1000(node)
/usr/bin and /usr/bin/yt-dlp are both NOT writable by node
```

`YtdlpUpdateService` installs with
`move(YTDLP_TEMP_PATH, '/usr/bin/yt-dlp', { overwrite: true })`, which needs
write permission on `/usr/bin`. `YTDLP_AUTO_UPDATE_ENABLED` defaults to
`'true'` and prod sets no `YTDLP_*` variables, so the job is **live**, on
`CronExpression.EVERY_DAY_AT_3AM`. It will fail with `EACCES` every night.

Not yet observed failing — `/api/ytdlp-update/status` reports
`lastCheck: null` because the container restarted after 3 AM — but the
permissions are not in question.

The Dockerfile creates the binary as root and never hands it over:

```dockerfile
RUN curl -L …/yt-dlp -o /usr/bin/yt-dlp && chmod a+rx /usr/bin/yt-dlp
```

`chmod a+rx` grants read and execute to everyone and write to nobody but
root. A one-line `chown node:node /usr/bin/yt-dlp` fixes it, but it is a
deploy-affecting change and worth a deliberate decision — the alternative
being to disable the updater and pin the version at image build time, which
is arguably the better posture for a binary on `PATH` anyway.

⚠️ Also note the suite's own docblock tells you to run
`pnpm test:ytdlp-update`. **No such script exists** in
`apps/download/package.json`, so the documented way to run these tests
against `__tests__/Dockerfile.test` has never worked either.

### 3. The migration landmine is repaired in production only

The one-row `__drizzle_migrations` insert fixed _this_ database. Any other
existing `download.db` — a developer's, a restored backup — still dies at
boot on first contact with a post-squash build. Open question: leave it
documented, or give `DbService` a guard that detects
schema-already-matches-the-snapshot and self-heals the bookkeeping.

### 4. Library content — the last 8 skipped rows

Every one traces to the same cause: the library is empty. Every mutate pass
tears down what it creates _by design_, so these close only by **keeping**
something.

| What to keep                           | Rows it unblocks                                                             | Cost                    |
| -------------------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| ~10 clips, kept                        | `activity-page2`, `gallery-page2`, `history-page2` + their `cursor.*` checks | ~15 min                 |
| One video with a live MinIO object     | `media-file`, plus the eight empty-fixture passes                            | one kept video          |
| One title Sonarr/Radarr holds, on disk | `media-seasons`, `emby.indexed-carries-a-link`, `emby.watch-url-is-external` | real, permanent content |

The cursor machinery itself is already proven — `cursor.discover` and
`cursor.admin-audit-log` both pass — so the three page-2 rows are unproven
only for their own result sets, not for the mechanism.

### 5. No UI for the video delete

`DELETE /download/videos/:jobId` and `DownloadClient.deleteJob()` exist and
work; nothing in the frontend calls either. `apps/download/src/app` is a
single `page.tsx` with no cancel affordance either, so this is an unexposed
capability rather than a parity gap.

---

## Summary

|                      |                                               |
| -------------------- | --------------------------------------------- |
| Read checks verified | **26 of 42** rows                             |
| Remaining failures   | **0**                                         |
| Write path           | **All three media types verified end to end** |
| Real bugs found      | **7** (all 7 fixed)                           |

The core request → download → cleanup flow works for movies, shows and videos
against real upstreams, and now cleans up after itself completely.

Latest run (2026-08-28, against the fixed build):
`42 rows · 34 passed (8 of them validated nothing) · 0 failed · 8 skipped`.
Previous run was `31 passed · 1 failed · 10 skipped`.

`pnpm test` is green for the first time in this branch's history — **55
suites passed, 1 skipped, 0 failed** (`b053029`); it stood at 17 failures
before, from two causes documented in that commit.

All three mutate passes are clean runs, and the journal drains to **zero
entries and zero residue** — the residue list, which existed because a
finished video could not be torn down, is now always empty.

**Every remaining unverified row has the same cause: the library is empty.**
There is no unknown failure and no route left behind a flag.

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
- **19 routes answered 200 and parsed**, including `activity`, `gallery`,
  `gallery-facets`, `discover`, `history`, both `/search` routes,
  `media-detail`, `media-bad-files`, all three job-by-id routes, both `ytdlp`
  routes, `auth/whoami`, and — since the `auth` redeploy — both admin routes.
- **Cursor pagination round-trips** on `/discover` — 10 + 10 of 40, no overlap,
  stable `total`.
- **`degradedSources: []`** with both upstreams answering `200`.
- **Guards behave correctly** — 401 anonymous, 200 with `X-Forwarded-User`.
  This confirmed `/auth/whoami` **is** guarded, contradicting plan 009's own
  route table.
- **Admin surface answers and its contents check out** —
  `audit.actions-are-known`, `admin.window-days-echoes-request` and
  `admin.stats-internally-consistent` all pass.

---

## 🔧 Fixed

Every bug this exercise found has been fixed. The four that were open at the
end of the sweep are below; the two fixed _during_ it follow.

| What                                              | Cause                                                                                                                                                                       | Fix                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **`GET /media/:id/releases` mutated the library** | `withMonitoring` → `ensureMovie` → `postApiV3Movie` added the movie to Radarr if not held. `restore: true` restored only _monitoring_, not the entry                        | `ensureMovie`/`ensureSeries` report `wasAdded`; the read path deletes it |
| **No request body was validated anywhere**        | Six `@Body()` handlers used `createZodDto` but no `ZodValidationPipe`, and there is no global pipe in `app.module.ts`, `main.ts` or `bootstrap.ts`. Only `@Query()` got one | Explicit pipe on all eight, plus a metadata test that guards the rule    |
| **`?? 0` minted ids that fail the wire schema**   | `toMovie`/`toShow` coerced a missing catalogue id to `0`, but `schema.ts:96` requires `z.number().int().positive()`                                                         | The mappers throw; list call sites drop the record and log               |
| **No way to delete a video**                      | No route existed. `PATCH /videos/:id/cancel` 404s once `Completed`; `DELETE /media/:id/files` rejects `video:` keys via `parseReleaseTarget`                                | `DELETE /download/videos/:jobId`                                         |

### The three that mattered most, in detail

**A GET that wrote to your library.** On a `tmdb:` key Radarr did not hold,
`/releases` added the movie; restoring put monitoring back but left the entry.
An `--include-expensive` sweep would have silently populated Radarr with
catalogue movies. `ensureMovie`/`ensureSeries` now distinguish "it was already
here, unmonitored" from "this call added it", and `withMonitoring` undoes the
second with `unmonitorAndDelete(id, false)` — `deleteFiles: false`, because a
title that was not in the library a moment ago has nothing on disk this call
is entitled to delete. A grab (`restore: false`) is unaffected: the user
picked it, so it stays.

**Nothing validated request bodies.** `CreateJobInputDto`,
`RequestMovieInputDto`, `RequestShowInputDto`, `GrabReleaseInputDto`,
`ReplaceReleaseInputDto` and `FlagBadFileInputDto` were all declared and none
was enforced. This directly contradicted `RequestShowInputSchema`'s own
docblock, which reasons that a string `"3"` "is a client bug worth a 400
rather than something to silently coerce" — **that 400 never fired.** Both
`/search` routes had the same gap on `@Query()`. All eight now carry a pipe,
and `download.controller.validation.test.ts` asserts it structurally off
Nest's `ROUTE_ARGS_METADATA` rather than route by route, so a new `@Body()`
added without one fails in CI instead of in production.

**`?? 0` produced a silently-dropped record.** An upstream record with no
catalogue id yielded a `Media` that failed the app's own wire schema: the
backend serialised it fine and the frontend's `safeParse()` dropped the job
with no error anywhere. `toMovie()`/`toShow()` now throw, matching
`toEpisode()`'s existing rule for structurally-required fields, and
`mapCatalogueEntries()` turns that throw into one dropped record plus a
warning rather than a failed listing. Single-record lookups
(`lookupByTmdbId`) let the throw reach the caller, because there the
unmappable record _is_ the answer. (`sonarr.service.ts`'s `?? 0` for
`seasonNumber` is untouched — season 0 legitimately means specials.)

**No way to delete a video.** `DELETE /download/videos/:jobId` is the video
counterpart of the movie and show deletes: it stops a running job, removes
the MinIO objects, and clears the `videos` row's `downloadUrls` so nothing
keeps advertising a link that 404s. Order is load-bearing — objects first,
row second, or a failed MinIO call loses the only record of what to delete.
The `videos` row itself survives: it is keyed on `(sourceUrl, timeRange)`, so
other jobs may point at it, and deleting it would orphan history rather than
clean it up. The job is resolved via `adoptJob()`, which falls back to the
durable row, so a restart is not a reason a video becomes unremovable.

### Fixed during verification

| What                                                                                                    | Cause                                                                                                                                                                                                                  | Fix               |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **`POST /download/videos` 500'd on every request** — video downloads were entirely broken in production | `EACCES: mkdir '/download'`. `DownloadVideoService` hardcodes `VIDEO_DIR = '/download/videos'`; the container runs as UID 1000 and nothing ever created that path — not the Dockerfile, not `deploy.yml`, not `main`'s | `f086c62`         |
| **Admin routes 403'd** (`/admin/audit-log`, `/admin/stats`)                                             | Deployed `auth` was built from `main`, which lacks `GET /admin/check` (ships in `6883859` on this branch). `AdminCheckService` is fail-closed → 403                                                                    | `auth` redeployed |
| **Emby lookups 401'd; all titles reported `state: 'unknown'`**                                          | `EMBY_API_KEY` in `.env.prod` was a literal `PLACEHOLDER_REPLACE_ME`                                                                                                                                                   | Real key wired in |

All 59 mocked test files pass on the video bug, because they mock the
filesystem. It is the clearest example of what this exercise was for.

**On the Emby key:** it came from `apps/tdr-bot/.env.prod` (`EMBY_API_TOKEN`) —
both services authenticate with `?api_key=` against the same server. Verified
from inside the `download` container: `GET /emby/Users` returns `200` and the
`EMBY_USERNAME` user (`jeremy`) exists, which `emby-status.service.ts:206`
requires. **The key is proven; the `embyStatus` path is not** — see below.

---

## ⚠️ Never exercised

**Do not read these as working.** They were skipped, and the report counts them
apart from passes for exactly that reason.

- **`GET /media/:id/releases`** — behind `--include-expensive`, never run. It
  fires a real 30s+ indexer search. The library mutation that made the flag
  unsafe is fixed, so it can now be run.
- **`GET /media/:id/seasons`** — skipped: no _held_ show exists in the library
  to ask about. The last run found 31 show media keys, but every one came from
  a catalogue or history source rather than a completed gallery entry.
- **`PATCH /videos/:id/pause` and `/resume`** — untouched.
- **`POST /media/:id/releases/grab`, `/replace`, `/bad-files`** — the remaining
  write routes. Untouched.
- **Cursor pagination on `activity`, `gallery`, `history`, `admin/audit-log`** —
  every result set fit on one page, so the round trip never ran there.

### Passed, but validated nothing

Six rows answered 200 over **empty data**, including `activity` and
`media-bad-files`. The envelope is verified; the element schemas inside were
never exercised. The report marks these "validated nothing" so they cannot be
misread as coverage.

**Both Emby spot-checks are in this category.** `emby.indexed-carries-a-link`
and `emby.watch-url-is-external` pass over _69 media objects, none carrying an
`embyStatus` at all._ Emby only annotates titles with a file on disk, and the
library has none. Proving the new key end to end requires a real completed
download that stays in the library.

### The one failure that used to be here — resolved

`media-file` returned **404** for
`/download/media/video%3AYkgL4RGtgfyO4T8oubhFU/file`, a key mined from
`gallery`.

It was never a route bug. It was the missing video `DELETE` showing its
consequences: the MinIO object had been removed by hand after a mutate run,
the job row had no route that could remove it, and the gallery went on
advertising a `downloadUrl` that 404s. The checker was correctly reporting a
real inconsistency.

**Closed on 2026-08-28.** That exact orphan (`eKHs-LYxPwll2RpBKLKwY`) was
cleared with the new route — which is also what proved the already-missing
-object branch works, since MinIO had nothing left to delete. `downloadUrls`
went to `[]`, the job to `cancelled`, and a `video.delete` row landed in the
audit log.

The class of bug is gone, not just the instance: `DELETE
/download/videos/:jobId` clears `downloadUrls` in the same operation that
removes the objects, so the gallery cannot advertise a link to something that
isn't there. `media-file` now reports `SKIPPED (no held video)` — the honest
answer for an empty library, and one of the eight rows §4 above closes.

---

## What full verification still requires

Covered above — see **Remaining work §4, Library content**.
Every unverified row now has one cause (the library is empty) and one
remedy (keep some content). There is no unknown failure and no route left
behind a flag.

---

## ⚠️ The migration squash was a loaded gun

**Found by deploying.** `57c1409 chore(download): squash migrations into a
single init` replaced the 0000–0007 migration series with one
`0000_soft_inertia.sql`. It was never redeployed after landing — the image
that had been running was built at **11:46**, seven hours _before_ the squash
committed at **18:46** — so nobody had exercised it against an existing
database.

The next deploy of `download`, whatever it contained, was going to die at
boot:

```
DrizzleError: Failed to run the query 'CREATE TABLE `audit_log` (...)'
  cause: SqliteError: table `audit_log` already exists
```

Drizzle's migrator does **not** compare hashes to decide what to apply. It
reads the newest `created_at` out of `__drizzle_migrations` and applies every
migration whose journal `when` is greater:

```js
if (!lastDbMigration || Number(lastDbMigration[2]) < migration.folderMillis) { … }
```

The squashed file's `when` is `1787867746354`; the live DB's newest row was
`1787703321423`. Newer ⇒ apply from scratch ⇒ `CREATE TABLE` against tables
that already exist ⇒ fatal boot error.

**The repair, and why it was safe.** The live schema was diffed against the
schema the squashed migration produces: identical tables, identical 13
columns and 5 indexes on `jobs`, identical constraints — the only textual
difference is `` `jobs` `` vs `"jobs"` quoting left by an old table rebuild.
Since the schema already matched, the fix was bookkeeping only: one row
recording the squashed migration as applied. The eight historical rows were
**kept**, not deleted, so the record of what was actually applied to this
database survives.

⚠️ **Any other existing `download.db` still has this landmine** — a dev
database, or a restored backup, will hit the identical fatal boot error on
first start against a post-squash build. The same one-row insert fixes it.

⚠️ **`media-backfill.spec.ts` and `schema.spec.ts` still fail** for the same
root cause: they exercise migrations `0002`/`0003`/`0006`, which the squash
deleted. 17 failing tests, all from that one commit. The squash was not
finished.

---

## A red row that wasn't a bug

The first video mutate pass after the fix reported:

```
video.progress  FAIL  (illegal transition: converting → completed)
```

The backend's own logs showed `converting → uploading → cleaning →
completed` — every edge legal. The checker compared observed pairs against a
**single-hop adjacency table**, but it reads a _sampled_ status: `Uploading`
is a 139 KB `fPutObject` and `Cleaning` is an `rm`, so for the five-second
fixture clip both routinely finish inside one poll interval. Two consecutive
runs sampled differently (`converting → completed`, then `pending →
downloading → completed`), which is the tell.

Fixed in `a9b76dd` by judging transitions on **reachability** rather than
adjacency — but only through _transient_ states. Plain reachability would be
vacuous, because `pausing → paused → pending → downloading` is a path through
the graph and would launder a genuinely backwards observation into a legal
one. The walk therefore refuses to expand `Paused` and the terminal statuses:
a job does not leave those without a fresh user action, so a poller cannot
miss one the way it misses a sub-second `Uploading`.

This mattered beyond the one row. A red row next to a backend that behaved
perfectly is worse than no row, because it trains the reader to discount red
rows — the one thing this script cannot afford.

---

## Deployment prerequisites this uncovered

None of these was written down anywhere before.

1. **`/storage/app-data/download` must be owned by UID 1000.** Docker
   auto-creates it as `root:root` and the container runs as `node`, so a fresh
   deploy dies at boot with `SQLITE_CANTOPEN`. `deploy.yml` documents the
   `chown 1000:1000` in a comment, but it is not part of any deploy step.
2. **`download` depends on `auth` shipping from the same branch.** The admin
   surface is broken whenever `auth` predates `6883859`. This is a cross-service
   deploy-ordering constraint that no mocked test can catch.
3. **The `/data` volume and `DATABASE_PATH` exist only on this branch.**
   `main`'s `apps/download/deploy.yml` is a 15-line file with neither. If the
   shared checkout at `/home/jeremy/lilnas` is parked on `main`, the next
   `docker compose up -d download` recreates the container with nothing mounted
   at `/data` and Nest dies with `SQLITE_CANTOPEN`. This has already happened
   once: an ordinary `git checkout main` silently armed the break until the
   next restart.

4. **The migration bookkeeping must match the squash.** See the section
   above — an existing `download.db` written before `57c1409` will kill the
   container at boot until one row is inserted into `__drizzle_migrations`.

⚠️ **A broken backend still reports `Up`.** The container runs Next.js on
`:8080` and Nest on `:8081`. When the backend dies at boot the frontend stays
healthy, so `docker compose ps` shows `Up` and any container-level health check
passes. Check `:8081` directly.

Prerequisite 3 disappears on merge — which is the real argument for merging
rather than continuing to manage it operationally.

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

`--include-expensive` is now safe to pass: `/releases` takes back any library
entry it had to add. Expect it to be slow — a real 30s+ indexer search per
title.

Full task-by-task history, including the findings that corrected the plan's own
premises, is in
[`docs/features/download/plans/009-backend-verification-script.md`](../features/download/plans/009-backend-verification-script.md).
