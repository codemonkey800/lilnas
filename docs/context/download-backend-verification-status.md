# Download Backend — Verification Status

What has actually been proven to work against the real Radarr, Sonarr, Emby and
MinIO, and what has not. Produced by the plan-009 verification script
(`apps/download/scripts/verify/`) run against the live backend on the lilnas
host. Read sweep and all three mutate passes re-run against the fixed build
on **2026-08-28**, that time with content deliberately **kept** in the
library and `--include-expensive` passed — see **Remaining work §4**.

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

Ordered by what actually blocks progress. **§6 is the live gap**: §2 and §3
are now fixed in code but the container still runs the image built before
them, so both production defects are still armed. §4 is done. §1 and §5 are
scaffolding around the service rather than the service itself.

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

### 2. The yt-dlp auto-updater cannot work in production — fixed in code, NOT DEPLOYED

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
`move(YTDLP_TEMP_PATH, '/usr/bin/yt-dlp', { overwrite: true })`.
`YTDLP_AUTO_UPDATE_ENABLED` defaults to `'true'` and prod sets no `YTDLP_*`
variables, so the job is **live**, on `CronExpression.EVERY_DAY_AT_3AM`. It
will fail with `EACCES` every night.

Not yet observed failing — `/api/ytdlp-update/status` reports
`lastCheck: null` because the container restarted after 3 AM — but the
permissions are not in question.

**Why `chown node:node /usr/bin/yt-dlp` is not the fix.** The obvious
one-liner does not work. `move()` is a rename, and POSIX requires write
permission on the **containing directory** to rename or unlink an entry —
ownership of the file itself is irrelevant. `/usr/bin` is
`root:root drwxr-xr-x`, so node still could not replace it.

**The fix taken (2026-08-28):** the real binary moved to a node-owned
directory, with `/usr/bin/yt-dlp` left as a symlink so the four hardcoded
`spawn('/usr/bin/yt-dlp', …)` call sites in `download.service.ts` and
`download-video.service.ts` keep working untouched.

```dockerfile
RUN mkdir -p /opt/yt-dlp && \
    curl -L …/yt-dlp -o /opt/yt-dlp/yt-dlp && \
    chmod a+rx /opt/yt-dlp/yt-dlp && \
    chown -R node:node /opt/yt-dlp && \
    ln -s /opt/yt-dlp/yt-dlp /usr/bin/yt-dlp
```

`YTDLP_BINARY_PATH` in `ytdlp-update.service.ts` now points at
`/opt/yt-dlp/yt-dlp` — the updater must replace the real file, not write
through the symlink. `__tests__/Dockerfile.test` and both spec files track
the same path. Rejected alternative: `chown` `/usr/bin` itself, which would
let a compromised node process replace any system binary — not a trade worth
making on the service that had the 2026-07-14 RCE.

⚠️ **Verified by tests only.** `pnpm test` is green and `pnpm run type-check`
passes, but the running container is still on the **old image**. The EACCES
this fixes has not been observed not-happening. See §6.

~~The suite's docblock tells you to run `pnpm test:ytdlp-update`; no such
script exists.~~ **Wrong — that script does exist**
(`apps/download/package.json:35`, added in `7a32820`). The earlier claim in
this document was incorrect.

### 3. The migration landmine — self-healing guard added, NOT DEPLOYED

The one-row `__drizzle_migrations` insert fixed _this_ database. Any other
existing `download.db` — a developer's, a restored backup — still died at
boot on first contact with a post-squash build.

**Resolved by the guard, not by documentation.** `runMigrations()` in
`apps/download/src/db/migrate.ts` now calls `selfHealMigrationBookkeeping()`
before handing off to drizzle's migrator. For each migration drizzle is
about to (re-)apply, it parses the `CREATE TABLE` statements out of the
migration SQL; if **every** table that migration would create already exists,
it records the migration as applied instead of letting it run. It stops at
the first migration that is not purely a re-creation of existing tables, so a
genuinely new migration still runs through the real migrator untouched.

`db.service.spec.ts` reproduces the exact landmine — schema built by
executing `0000_soft_inertia.sql` directly against a fresh file with no
bookkeeping row at all — and asserts `runMigrations()` no longer throws and
that exactly one row lands in `__drizzle_migrations`.

⚠️ **Verified by tests only**, same as §2. Not yet exercised against a real
pre-squash database in a deployed container. See §6.

### 4. Library content — 8 skipped rows → 3 ✅ CLOSED

Every one traced to the same cause: the library was empty. Every mutate pass
tears down what it creates _by design_, so these closed only by **keeping**
something. Done on **2026-08-28** via `mutate --keep`, which exists for
exactly this and leaves the journal drained afterwards.

Kept in the library:

| What                          | How                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------- |
| 1 movie — _Following_ (1999)  | `mutate --only movie --keep`; reached `downloading`                             |
| 1 show — _Olive Kitteridge_ S1 | `mutate --only show --keep`; added to Sonarr, still `searching`                 |
| 11 distinct video clips       | `--only video --keep` over 11 `--fixtures` files with distinct `timeRange`s     |

The video trick matters: a `video:` key is derived from
`(sourceUrl, timeRange)`, so re-running the same fixture reuses one row.
Walking the time range (`00:00:00–00:00:03`, `00:00:01–00:00:04`, …) mints a
fresh key each time and is what pushes `gallery` past its 10-row page.

**Rows this closed:** `gallery-page2`, `cursor.gallery`, `media-file`, and
`media-releases` (run with `--include-expensive`, now safe since
`/releases` takes back any entry it had to add — this is the first time that
flag has ever been exercised).

**Three rows remain skipped, and are not worth forcing:**

- **`activity-page2` / `cursor.activity`** — `/activity` lists only movie and
  show jobs, never videos, so paginating it needs >10 real Radarr/Sonarr adds.
  The cursor mechanism is already proven four ways over (`gallery`,
  `discover`, `history`, `admin-audit-log`), so this would be library
  pollution buying nothing.
- **`media-seasons`** — needs the kept show to finish downloading and land on
  disk, which waits on an indexer actually holding an _Olive Kitteridge_ S1
  release. Not forceable on demand; may close on its own.

### 6. The two code fixes are not deployed

§2 and §3 are both **fixed in the worktree and green under `pnpm test`
(55 suites, 1035 tests, 0 failures) and `pnpm run type-check`** — but the
running `download` container was built before either. Neither production
defect has been observed _not_ happening.

Closing this means: rebuild the `download` image, `docker compose up -d
download` from the root compose file, then confirm from inside the container
that `/opt/yt-dlp/yt-dlp` is node-writable and that the backend on `:8081`
came up (per the "a broken backend still reports `Up`" warning below).

### 5. No UI for the video delete

`DELETE /download/videos/:jobId` and `DownloadClient.deleteJob()` exist and
work; nothing in the frontend calls either. `apps/download/src/app` is a
single `page.tsx` with no cancel affordance either, so this is an unexposed
capability rather than a parity gap.

---

## Summary

|                      |                                               |
| -------------------- | --------------------------------------------- |
| Read checks verified | **35 of 42** rows                             |
| Remaining failures   | **0**                                         |
| Write path           | **All three media types verified end to end** |
| Real bugs found      | **9** (all 9 fixed; 2 not yet deployed)       |

The core request → download → cleanup flow works for movies, shows and videos
against real upstreams, and now cleans up after itself completely.

Latest run (2026-08-28, with content kept in the library and
`--include-expensive`):
`42 rows · 39 passed (4 of them validated nothing) · 0 failed · 3 skipped`.
Run before it, on an empty library: `34 passed · 0 failed · 8 skipped`.
The one before that: `31 passed · 1 failed · 10 skipped`.

`pnpm test` is green — **55 suites passed, 1 skipped, 0 failed; 1035 tests
passed, 9 skipped**. The one skipped suite is
`ytdlp-update.integration.spec.ts`, which gates on being able to replace the
yt-dlp binary and correctly declines to run outside a container.

All three mutate passes are clean runs, and the journal drains to **zero
entries and zero residue** — the residue list, which existed because a
finished video could not be torn down, is now always empty.

**What is left is no longer about the sweep.** The read path is as verified as
an empty-ish library allows; the three skipped rows are documented in §4 and
neither is a defect. The real gap is §6: the yt-dlp and migration fixes exist
only in the worktree, and the container is still running the old image.

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

- ~~**`GET /media/:id/releases`**~~ — **now run.** Passed on 2026-08-28 with
  `--include-expensive` (HTTP 200, 3588ms). This was the first exercise of
  that flag, and it is what confirms the library-mutation fix holds in
  practice rather than only in review.
- **`GET /media/:id/seasons`** — still skipped: no _held_ show exists in the
  library to ask about. The kept _Olive Kitteridge_ S1 is in Sonarr but has
  no file on disk yet, so the route has nothing to answer with. Every one of
  the 31 show media keys still comes from a catalogue or history source
  rather than a completed gallery entry.
- **`PATCH /videos/:id/pause` and `/resume`** — untouched.
- **`POST /media/:id/releases/grab`, `/replace`, `/bad-files`** — the remaining
  write routes. Untouched. `grab` pulls real bytes from a real indexer into
  the download client, which `preflight` calls out as needing its own
  deliberate session.
- **Cursor pagination on `activity`** — still one page. `gallery`, `history`
  and `admin/audit-log` all round-trip now (`10 + 1 of 11`, `10 + 10 of 32`,
  `10 + 10 of 69`), so the mechanism is proven; `/activity` lists only movie
  and show jobs, so paginating it needs >10 real Radarr/Sonarr adds.

### Passed, but validated nothing

Four rows (down from six) answered 200 over **empty data**, including
`media-bad-files` and `movie.file-path-is-a-file`. The envelope is verified;
the element schemas inside were never exercised. The report marks these
"validated nothing" so they cannot be misread as coverage.

**`emby.watch-url-is-external` is still in this category** — no `watchUrl`
appeared among 98 media objects, because Emby only annotates titles with a
file on disk and nothing kept has one yet.

**`emby.indexed-carries-a-link` is no longer** — it now checks 2 media
carrying a real `embyStatus`, so the key that was wired in during
verification is proven past the auth handshake and into the annotation path.

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

The library-content work is **done** — see **Remaining work §4**. What is left
is no longer about the read sweep:

1. **Deploy the two fixes** (§6). This is the only item where a real
   production defect is still live.
2. **`media-seasons`** needs the kept show to finish downloading. Waiting on
   an indexer, not on us.
3. **`activity-page2`** needs >10 movie/show adds. Deliberately not doing this.
4. **The five never-run write routes** — `pause`, `resume`, `grab`,
   `replace`, `bad-files`. `grab` in particular pulls real bytes and deserves
   its own session.

There is no unknown failure and no route left behind a flag.

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

✅ **The landmine is defused for every other database too** — as of
2026-08-28, `selfHealMigrationBookkeeping()` in `migrate.ts` performs that
same one-row insert automatically at boot, for any database whose schema
already contains every table a pending migration would create. A dev
database or a restored backup no longer needs manual repair. See
**Remaining work §3** — and note the guard itself is not yet running in the
deployed container.

~~`media-backfill.spec.ts` and `schema.spec.ts` still fail~~ — **resolved in
`b053029`**, which retired both suites. They exercised migrations
`0002`/`0003`/`0006`, which the squash deleted, so there was nothing left for
them to test.

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
