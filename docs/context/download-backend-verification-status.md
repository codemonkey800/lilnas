# Download Backend — Verification Status

What has actually been proven to work against the real Radarr, Sonarr, Emby and
MinIO, and what has not. Produced by the plan-009 verification script
(`apps/download/scripts/verify/`) run against the live backend on the lilnas
host. Read sweep and all three mutate passes re-run against the deployed
fixed build on **2026-08-28**, with content deliberately **kept** in the
library and `--include-expensive` passed — see **Remaining work §4**.
`PATCH /videos/:id/pause` and `/resume` were exercised for the first time on
**2026-08-30** by a second script, `scripts/verify/pause-resume.ts` — see
**Remaining work §7**. Later the same day the **last three write routes** were
exercised by three more scripts, `bad-files.ts`, `grab.ts` and `replace.ts` —
see **§8**.

**Current state: `42 rows · 40 passed · 0 failed · 2 skipped`** on the read
sweep, plus four focused scripts:

| Script            | Result                          | Covers                             |
| ----------------- | ------------------------------- | ---------------------------------- |
| `pause-resume.ts` | `13 passed · 0 failed`          | `PATCH /videos/:id/{pause,resume}` |
| `bad-files.ts`    | `15 passed · 0 failed`          | `POST /media/:id/bad-files`        |
| `grab.ts`         | `15 passed · 0 failed`          | `POST /media/:id/releases/grab`    |
| `replace.ts`      | `13 passed · 0 failed · 2 skip` | `POST /media/:id/releases/replace` |

The read sweep's two skips are `activity-page2` and its `cursor.activity`
spot-check — one cause, and a deliberate decision rather than a gap. See §4.
`replace.ts`'s two skips are **one real gap** and are described honestly in
§8: everything about that route is proven except that it deletes a real file.

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

Ordered by what actually blocks progress. **§2, §3, §4, §6, §7 and §8 are all
closed and verified against the live backend.** What is left is §1 (merge the
branch), §5 (no UI for the video delete), and **one stated gap inside §8** —
that `replace` deletes a real file, which could not be seeded on this host.
No route is untested any more.

### 1. The branch has never been pushed or merged

`jeremy/download` is **127 commits ahead of `main` and 114 unpushed.** This
is the largest outstanding item and it is not cosmetic: deployment
prerequisite 3 below exists _only_ because of it. `main`'s
`apps/download/deploy.yml` is a 15-line file with no `/data` volume and no
`DATABASE_PATH`, so the moment the shared checkout at `/home/jeremy/lilnas`
lands on `main`, the next `docker compose up -d download` recreates the
container with nothing mounted and Nest dies with `SQLITE_CANTOPEN`. That
hazard disappears on merge and only on merge.

The prod checkout is currently parked **detached at `967bb93`** — a state
nobody can reproduce from a clone. Every deploy so far has had to move this
detached HEAD forward by hand, which is the operational cost of not merging.
The branch tip is `92bfa55`, one commit further on; the difference is a
verify script that is not in the image, so the checkout still matches what
the running container was built from.

### 2. The yt-dlp auto-updater could not work in production ✅ CLOSED

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

`YtdlpUpdateService` installed with
`move(YTDLP_TEMP_PATH, '/usr/bin/yt-dlp', { overwrite: true })`.
`YTDLP_AUTO_UPDATE_ENABLED` defaults to `'true'` and prod sets no `YTDLP_*`
variables, so the job was **live**, on `CronExpression.EVERY_DAY_AT_3AM`, and
would have failed with `EACCES` every night.

It was never observed failing — `/api/ytdlp-update/status` reported
`lastCheck: null` because the container kept restarting after 3 AM — but the
permissions were not in question.

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

✅ **Verified against the live container** (`f36b7a3`, deployed 2026-08-28) —
not just by permission bits, but by driving the real install path. An older
version was planted so an update would be available, then
`POST /api/ytdlp-update/check` was called:

```
performUpdate      currentVersion 2026.01.01 → newVersion 2026.08.19
installNewBinary   Installing new binary
installNewBinary   Installation completed          ← the move() that used to EACCES
performUpdate      yt-dlp update completed successfully (1371ms)
```

No `EACCES`, no rollback, and the planted stub was replaced by the real
3,072,469-byte binary. A `mutate --only video` pass afterwards downloaded,
converted, uploaded and served back a real clip, confirming the four
`spawn('/usr/bin/yt-dlp', …)` call sites still resolve through the symlink.

~~The suite's docblock tells you to run `pnpm test:ytdlp-update`; no such
script exists.~~ **Wrong — that script does exist**
(`apps/download/package.json:35`, added in `7a32820`). The earlier claim in
this document was incorrect.

### 3. The migration landmine — self-healing guard added ✅ CLOSED

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

✅ **Verified against the live container** (`722915b`, deployed 2026-08-28).
The guard now runs at every boot, and the deploy took the real production
`download.db` — the one whose bookkeeping was repaired by hand — through it.
The backend answered `200` on `:8081` afterwards, which is the check that
matters given a dead backend still reports `Up`.

Note what this does and does not prove: the guard ran and did no harm on a
database whose bookkeeping is already correct. Its self-heal branch is proven
by `db.service.spec.ts`, which builds the broken state deliberately, rather
than by this deploy.

### 4. Library content — 8 skipped rows → 2 ✅ CLOSED

Every one traced to the same cause: the library was empty. Every mutate pass
tears down what it creates _by design_, so these closed only by **keeping**
something. Done on **2026-08-28** via `mutate --keep`, which exists for
exactly this and leaves the journal drained afterwards.

Kept in the library:

| What                           | How                                                                         |
| ------------------------------ | --------------------------------------------------------------------------- |
| 1 movie — _Following_ (1999)   | `mutate --only movie --keep`; Radarr has since **grabbed it to disk**       |
| 1 show — _Olive Kitteridge_ S1 | `mutate --only show --keep`; Sonarr has since **grabbed it to disk**        |
| 11 distinct video clips        | `--only video --keep` over 11 `--fixtures` files with distinct `timeRange`s |

Both the movie and the show have since finished downloading on their own,
which is what turned the Emby and `media-seasons` rows from vacuous into
real coverage. That was worth waiting for and could not have been forced.

The video trick matters: a `video:` key is derived from
`(sourceUrl, timeRange)`, so re-running the same fixture reuses one row.
Walking the time range (`00:00:00–00:00:03`, `00:00:01–00:00:04`, …) mints a
fresh key each time and is what pushes `gallery` past its 10-row page.

**Rows this closed:** `gallery-page2`, `cursor.gallery`, `media-file`,
`media-releases` (run with `--include-expensive`, now safe since `/releases`
takes back any entry it had to add — the first time that flag has ever been
exercised), and — once Sonarr finished the grab — **`media-seasons`**, which
had been skipped since the very first sweep for want of a held show.

**Two rows remain skipped — one cause, and a choice:**

- **`activity-page2` / `cursor.activity`** — `/activity` lists only movie and
  show jobs, never videos, so paginating it needs >10 real Radarr/Sonarr adds.
  The cursor mechanism is already proven four ways over (`gallery`,
  `discover`, `history`, `admin-audit-log`), so this would be library
  pollution buying nothing. **This is a decision, not a gap.**

### 5. No UI for the video delete

`DELETE /download/videos/:jobId` and `DownloadClient.deleteJob()` exist and
work; nothing in the frontend calls either. `apps/download/src/app` is a
single `page.tsx` with no cancel affordance either, so this is an unexposed
capability rather than a parity gap.

### 6. Shipping §2 and §3 ✅ CLOSED

Both deployed on **2026-08-28** and verified live — see §2 and §3. The
sequence, which is the one to repeat because the base-image cache makes the
obvious shortcut wrong:

```bash
cd /home/jeremy/lilnas
git checkout 967bb93                      # prod checkout is detached; see §1
./infra/base-images/build-base-images.sh  # REQUIRED — see below
docker-compose build download
docker-compose up -d download
```

⚠️ **The base-image rebuild is not optional here.** `apps/download/Dockerfile`
copies `.next`, `public` and `src/db/migrations` out of `/source`, which is a
snapshot baked into `lilnas-monorepo-builder`. Skip the rebuild and
`docker-compose build download` cheerfully produces an image from stale
source, with no error to tell you.

**Restart side effect worth knowing.** `reconcileInterruptedJobs()` sweeps
every non-terminal job at boot, so the deploy wiped the in-flight movie and
show jobs that had been kept for §4 and left `/activity` at `total: 0`. This
is correct behaviour, not a regression — a partial download is explicitly not
meant to survive a restart. Completed videos were unaffected. The two job
rows were re-created afterwards to restore the `movie-job` / `show-job`
fixtures.

It happened again on the **2026-08-30** deploy for §7, which swept one
in-flight `movie` job (_Following_) to `failed` at `04:34:49Z`. Expect this
on **every** deploy; it is the documented cost of restarting. The library
content itself is untouched — the 11 kept clips still carry their
`downloadUrls` and the gallery is unchanged at 15 items.

### 7. `PATCH /videos/:id/pause` and `/resume` ✅ CLOSED

Two of the five never-run write routes, closed on **2026-08-30**. They are
the cheap half: unlike `releases/{grab,replace,bad-files}` they touch no
indexer and no download client, only this service's own job state, which is
what made them safe to run outside a dedicated session.

**Why the read sweep could never have covered this.** `mutate.ts` polls at
2s, which is right for watching a job _progress_ and useless for catching it
in one specific state — and pause is refused outside `Downloading`
(`download.service.ts`). A separate script,
`apps/download/scripts/verify/pause-resume.ts`, polls at 150ms for exactly
that reason.

**It found a real bug on the first run.** `download()` writes `Downloading`
(`download-video.service.ts:236`) and only registers the yt-dlp handle at
`:292`, with a whole `yt-dlp --dump-json` metadata probe in between. For that
window the job advertised `downloading` and pause answered **409
`has no running process to pause`**. Measured at **1189ms and 1198ms across
three consecutive pre-fix runs**, and confirmed in the container's own logs:

```
.628  pending → downloading
.628  "Fetching video metadata"
.841  PATCH /pause → 409 "Job has no running process"
```

`cancelVideoDownloadJob` had the identical `getProc` guard and answered
**404** in the same window.

**The fix (`967bb93`, deployed 2026-08-30).** Pause records the intent when
there is no handle yet, and `download()` delivers that signal the instant it
registers one. The ordering is what makes it airtight: `setInterruption()`
and `setProc()` cannot interleave, so either the handle is already there and
pause signals it directly, or the spawn finds the note and signals for us.
Cancel's "has not started" guard is relaxed **only** for `Downloading` —
every other status with no process really has not started.

✅ **Verified against the live container**, both paths, because the fix moved
the default path and would otherwise have left the previously-working one
uncovered:

| Path                              | Result           | Tell                          |
| --------------------------------- | ---------------- | ----------------------------- |
| Pre-spawn (pause immediately)     | **12/12 passed** | `pausing → paused` in 884ms   |
| Post-spawn (`--pause-after 2000`) | **13/13 passed** | straight to `paused` in 105ms |

The two settle times are the evidence that two distinct code paths ran, not
one path twice. `pause.proc-registration-lag` — the row that failed three
times pre-fix — now reads _"pausable as soon as the job read `downloading`"_.

Beyond the 200s, the run asserts what a 200 cannot: a paused job is **really
stopped** (held 4s, re-read, still `paused` and `updatedAt` unchanged), a
second pause is refused with 409, resume runs to `completed` with a real
`downloadUrl`, and both `video.pause` and `video.resume` land in the audit
log. The job is deleted afterwards, so the pass leaves no residue.

### 8. The three remaining write routes ✅ CLOSED (one with a stated gap)

They had been carried as a single bullet — "the remaining write routes,
untouched, `grab` needs its own session" — since the first sweep. **That
grouping was wrong**, and re-reading the code on 2026-08-30 is what showed
it. All three were then run live the same day, by three separate scripts.

| Route       | Script         | Result                       | What it actually touches                         |
| ----------- | -------------- | ---------------------------- | ------------------------------------------------ |
| `bad-files` | `bad-files.ts` | **15/15** ✅                 | **Local SQLite only** — `insertBadFile`          |
| `grab`      | `grab.ts`      | **15/15** ✅                 | Real indexer → real download client → real bytes |
| `replace`   | `replace.ts`   | **13 passed · 2 skipped** ⚠️ | **Deletes files on disk**, _then_ grabs          |

#### `POST /media/:id/bad-files` — closed, and it was always cheap

`ReleaseService.flagBadFile()` calls `insertBadFile(this.dbService.db, …)`
and returns. No Radarr, no Sonarr, no indexer, no download client, no bytes.
It ended up in the expensive bucket because it lives on the Phase 3 releases
surface and shares the word "releases" with its neighbours.

The genuine catch was narrower than the caution it inherited, and it is what
the test was designed around:

- **There is no un-flag route.** `deleteBadFile()` exists at
  `apps/download/src/db/bad-files.repo.ts:91` and nothing exposes it over
  HTTP. A flag placed by a test is permanent unless someone edits SQLite.
- **`assertNotFlagged` gives the flag teeth.** Both `grabRelease` and
  `replaceRelease` refuse a flagged release, with no override path.

**The resolution: the guid is what has to be careful, not the media id.** The
refusal, the `flaggedBad` annotation and `MediaDownloadService`'s auto-select
exclusion are all keyed on `(mediaId, releaseGuid)`. A guid no indexer will
ever mint therefore cannot poison anything — nothing real matches it, so
nothing real is ever refused or annotated. That freed the _media id_ to be a
real, kept title, which is what makes the sweep's `media-bad-files` row real
coverage rather than a 200 over `[]`.

The guid is `lilnas-verify:bad-file:synthetic-guid-v1`, and it is a constant
rather than a per-run value, so `insertBadFile`'s `onConflictDoNothing` makes
re-runs read back the same row instead of accumulating one each time.

✅ **15/15 live.** Beyond the 201: anonymous is `401` (the only Phase 3 route
behind `ForwardedUserGuard`), a missing `guid` and a 501-character `reason`
are both `400` — which is the cheapest proof `FlagBadFileInputDto`'s pipe is
wired to the handler and not merely declared — a `video:` key is `404` from
`parseReleaseTarget`, the flag round-trips every field, it is attributed to
the forwarded user, it comes back through `GET /bad-files` byte-identical and
parsed as `BadFileSchema`, re-flagging returns the original row unchanged,
and `file.flag_bad` lands in the audit log.

⚠️ **Two corrections to what this document used to say.**

1. **The action is `file.flag_bad`**, not `release.bad_file`. Checked against
   `AUDIT_ACTIONS_LOCAL` (`schema.ts:305`) and against the live log.
2. **"No bad file has ever been flagged" was false.** The audit log holds two
   `file.flag_bad` rows against `tmdb:11660` from **2026-08-29 06:01 UTC** —
   so the route _had_ been called, and the `bad_files` rows were later deleted
   by hand (the autoincrement gap is the tell: this exercise's first flag got
   `id 3`). One of those two carried a **real nzbgeek guid for _Following_**,
   which is exactly the poisoning hazard described above; removing it was the
   right call, but the document was never corrected. The table is now clean
   apart from the two synthetic rows this exercise left, and **no real release
   is flagged**.

#### `POST /media/:id/releases/grab` — closed

The fence around this route was right about the bytes and wrong about the
teardown. `DELETE /download/movies/:jobId` runs `unmonitorAndDelete`, which
cancels every queue item for the movie with `removeFromClient: true` _before_
deleting it (`radarr.service.ts:486`) — the same teardown `mutate --only
movie` has used against the same download client since the first sweep. The
only difference is that the release is user-picked rather than auto-selected,
so the incremental cost is the bytes that land between the grab and the
delete, and nothing else.

**The assertion is `status: downloading`, not the 201.** `MediaPollerService`
derives that status from a live Radarr _queue record_, which exists only once
the download client holds the release. A 201 proves Radarr accepted the push;
`downloading` proves the bytes are moving. The script tears down the instant
it has that, rather than watching an import finish.

✅ **15/15 live** against `tmdb:10331` (_Night of the Living Dead_, 1968) —
a title Radarr did not hold. It refuses to run against a held one, because
teardown deletes files. Reached `downloading` in 60s; afterwards the Radarr
queue was empty, the title was gone (`resolves without a radarrId`), and the
gallery was unchanged. Also covers the `409` on a flagged release — free,
because `assertNotFlagged` precedes any upstream call, using the flag
`bad-files.ts` leaves behind — and the `400` on a missing `indexerId`.

#### `POST /media/:id/releases/replace` — run, with one honest gap

This is the destructive one, and the library on this host is **not a
fixture**: it is ~288 real movies someone owns. There is no title in it that
"nobody minds losing", so the script does not pick a victim — it
**manufactures** one: grab a small release, wait for Radarr to import it to a
real file, then replace that. The file it destroys is one it created minutes
earlier.

**Seeding failed, twice, for reasons outside this app.** Two different
releases for `tmdb:10331` downloaded to completion in SABnzbd and were then
refused by **Radarr's** import matcher with `Movie […] was not found in the
grabbed release`:

| Attempt | Release                                    | Outcome                                   |
| ------- | ------------------------------------------ | ----------------------------------------- |
| 1       | `…3X-audio Remastered x264 aac.part01`     | `importBlocked` — half of a split archive |
| 2       | `Night.of.the.Living.Dead.1968.DVDRip…iLS` | `importPending` → same matcher refusal    |

The first is a real selection bug in the script and is fixed: `.partNN` is
now filtered out of release selection in both `replace.ts` and `grab.ts`,
because "smallest" and "importable" are not the same property. The second is
Radarr's release-to-movie matching on a correctly-named single-file `.avi`
sitting in the completed folder — not a defect in the route under test, but
the effect is the same: no disposable file, so nothing to delete.

**So a failed seed is not fatal, and not silently glossed.**
`replaceRelease`'s own docblock says deleting zero files is legal — _"nothing
to replace just means this is a plain grab"_ — so the run continues down that
documented path and asserts everything else. The two rows it cannot make then
report **`skipped`**, and the verdict stays `NOT A PASS` with exit 2.

| Proven                                                                        | Not proven                                         |
| ----------------------------------------------------------------------------- | -------------------------------------------------- |
| `400` on a missing `indexerId` — **before** `prepare`, so nothing was deleted | That `deleteExistingFiles` removes a **real** file |
| `409` on a flagged release, also before `prepare`                             | The delete-then-grab ordering under a real file    |
| `201`, and the job is an ordinary movie job                                   |                                                    |
| `release.replace` in the audit log with the guid and job id                   |                                                    |
| The replacement reached a live Radarr queue item (`downloading`)              |                                                    |
| Clean teardown — queue empty, title gone, gallery unchanged                   |                                                    |

That first "not proven" row is **the one real gap left in the backend's
coverage.** It is not a decision not to test, the way `activity-page2` is
(§4) — it is a test that was written, run, and blocked by an upstream that
would not produce a disposable file. It closes the moment any title Radarr
will actually import is available to seed with; `pnpm exec tsx
scripts/verify/replace.ts --repo-path /home/jeremy/lilnas --tmdb-id <other>`
is the whole retry.

⚠️ **Residue this left, deliberately.** Two `bad_files` rows, both carrying
`lilnas-verify:bad-file:synthetic-guid-v1` — `id 3` on `tmdb:11660`
(_Following_, kept) and `id 5` on `tmdb:10331` (no longer in the library).
Neither can poison anything, because no indexer mints that guid. There is no
un-flag route, so they are permanent until someone runs:

```bash
docker compose exec -T download node -e "const D=require('better-sqlite3')('/data/download.db');console.log(D.prepare('DELETE FROM bad_files WHERE release_guid LIKE ?').run('lilnas-verify:bad-file:%'))"
```

Leaving `id 3` in place is the better default: it is what keeps
`media-bad-files` non-vacuous and what lets `grab.ts` and `replace.ts` assert
their 409s for free.

**The pattern to notice.** This is the second and third time in two days that
something filed under "expensive, needs its own session" turned out not to
be, and each time the tell was the same: nobody re-read the code after the
label was applied. `pause`/`resume` was the first (§7); `bad-files` was
mislabelled outright, and `grab`'s teardown had been solved for months by the
movie mutate pass. Labels age; the code is the only thing that answers the
question. Note the counter-example too — `replace` was labelled the most
dangerous, and re-reading the code confirmed it.

---

## Summary

|                          |                                                          |
| ------------------------ | -------------------------------------------------------- |
| Read checks verified     | **39 of 42** rows (40 passed, 1 vacuous)                 |
| Remaining failures       | **0**, on every script                                   |
| Read-sweep skips         | **2** — one cause, deliberate; see §4                    |
| Write path               | **All three media types verified end to end**            |
| Pause / resume           | **13 of 13**, both code paths; see §7                    |
| Never-run write routes   | **0**, down from 5 — all three closed 2026-08-30; see §8 |
| Behaviour still unproven | **1** — that `replace` deletes a real file; see §8       |
| Real bugs found          | **10** (all 10 fixed and deployed)                       |

The core request → download → cleanup flow works for movies, shows and videos
against real upstreams, and now cleans up after itself completely.

Latest read sweep (2026-08-28, against the **deployed** fixed build, with
content kept and `--include-expensive`):
`42 rows · 40 passed · 0 failed · 2 skipped` — and as of 2026-08-30 only one
of those passes still validates nothing, so **39 of 42 rows verified
something.** The sweep itself was not re-run; what changed is that
`bad-files.ts` put a real element behind `media-bad-files`.

The progression, each step being a real change in what is known:

| Run                           | Result                                        |
| ----------------------------- | --------------------------------------------- |
| Original sweep                | `31 passed · 1 failed · 10 skipped`           |
| After the four fixes          | `34 passed · 0 failed · 8 skipped`            |
| After keeping library content | `39 passed (4 validated nothing) · 3 skipped` |
| After deploying §2/§3         | `39 passed (2 validated nothing) · 3 skipped` |
| After the grabs completed     | `40 passed (2 validated nothing) · 2 skipped` |

The four focused scripts are counted separately, because each is a separate
script against separate routes:

| Script / run                           | Result                                   |
| -------------------------------------- | ---------------------------------------- |
| `pause-resume` first run, pre-fix      | `11 passed · 1 failed` — found the bug   |
| `pause-resume` after deploying the fix | `12 passed · 0 failed` (pre-spawn path)  |
| `pause-resume --pause-after 2000`      | `13 passed · 0 failed` (post-spawn path) |
| `bad-files`                            | `15 passed · 0 failed`                   |
| `grab`                                 | `15 passed · 0 failed`                   |
| `replace` seeded run ×2                | seed blocked by Radarr's import matcher  |
| `replace --no-seed`                    | `13 passed · 0 failed · 2 skipped`       |

Two of those steps are worth reading carefully. Deploying §2/§3 moved no
counts but closed two rows that had been passing _vacuously_. The last step
was not our doing at all — Radarr and Sonarr finished grabbing the kept
titles, which put files on disk and turned the Emby checks and
`media-seasons` into real coverage.

`pnpm test` is green — **55 suites passed, 1 skipped, 0 failed; 1037 tests
passed, 9 skipped**. The one skipped suite is
`ytdlp-update.integration.spec.ts`, which gates on being able to replace the
yt-dlp binary and correctly declines to run outside a container.

All three mutate passes are clean runs, and the journal drains to **zero
entries and zero residue** — the residue list, which existed because a
finished video could not be torn down, is now always empty.

Every fix is deployed and proven against the live backend. The two
still-skipped rows share one cause and are a deliberate decision not to
pollute the library (§4), not a defect, and no route is left behind a flag.

**No write route is unverified any more.** All five that started this
exercise untouched have now been run against the live backend:
`PATCH /videos/:id/{pause,resume}` (§7) and
`POST /media/:id/{bad-files,releases/grab,releases/replace}` (§8).

**One behaviour inside `replace` is still unproven** — that
`deleteExistingFiles` removes a real file. The test for it exists and runs;
it was blocked by Radarr refusing to import either of two disposable releases,
so there was never a file to delete. That is a genuine gap, and it is
deliberately reported as `skipped` rather than folded into a pass. Retrying it
needs nothing but a title Radarr will actually import.

The rest of the remaining work is §1 (merge the branch) and §5 (surface the
video delete in the UI) — neither of which any verification script can speak
to.

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
- **All 24 captured routes answered 200 and parsed** — every route in the
  manifest except `activity-page2`, which has no second page to fetch. That
  includes `media-seasons` and `media-releases`, the two that spent the whole
  exercise skipped.
- **Cursor pagination round-trips on four routes** — `discover`
  (10 + 10 of 40), `gallery` (10 + 4 of 14), `history` (10 + 10 of 35) and
  `admin-audit-log` (10 + 10 of 78). No overlap, stable `total`.
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
end of the sweep are below; the two fixed _during_ it follow, and the one
found **after** it by the pause/resume script comes last.

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

### Found after the sweep — pause was refused on a job that was downloading

The tenth bug, and the only one the read sweep and all three mutate passes
could not have found, because none of them ever calls pause. Full detail in
**Remaining work §7**; the short version:

`download()` writes `Downloading` before it fetches metadata and only
registers the yt-dlp handle afterwards, so for **~1.2s** a job was genuinely
downloading with nothing to signal. `pauseVideoDownloadJob` demanded both,
and answered `409 has no running process to pause` on a job the UI was
showing as downloading — with nothing to tell the user why pause only
"sometimes" works. `cancelVideoDownloadJob` answered `404` in the same
window.

Fixed in `967bb93` by recording the pause intent when there is no handle yet
and having `download()` deliver it the moment it registers one. What makes
this safe rather than another race is that `setInterruption()` and
`setProc()` cannot interleave: a pause either precedes both and is picked up
by the spawn, or follows both and finds the handle itself.

Worth noting for its own sake: **the bug was in the reachability graph all
along.** `VIDEO_TRANSITIONS` in `mutate.ts` already modelled
`Downloading → Pausing`, so the state machine said this should work. Only
driving it live showed that it didn't.

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
requires. **Both the key and the `embyStatus` path are now proven** — 12 media
carry an `embyStatus` and 12 carry a real `emby.lilnas.io` watch link. See
"The Emby path is now proven end to end" below.

---

## ⚠️ Never exercised

**Do not read these as working.** They were skipped, and the report counts them
apart from passes for exactly that reason.

- ~~**`GET /media/:id/releases`**~~ — **now run.** Passed on 2026-08-28 with
  `--include-expensive` (HTTP 200, 3588ms). This was the first exercise of
  that flag, and it is what confirms the library-mutation fix holds in
  practice rather than only in review.
- ~~**`GET /media/:id/seasons`**~~ — **now run.** Passed on 2026-08-28
  (HTTP 200, 101ms) once Sonarr finished grabbing _Olive Kitteridge_ S1 and
  the show had a file on disk. This row had been skipped since the very first
  sweep for want of a held show; it is the last one the library content
  unblocked.
- ~~**`PATCH /videos/:id/pause` and `/resume`**~~ — **now run.** Both paths
  passed on 2026-08-30 (`13/13`) via `scripts/verify/pause-resume.ts`, which
  found and then proved the fix for the pre-spawn 409. See **Remaining work
  §7**.
- ~~**`POST /media/:id/releases/grab`**~~ — **now run.** `15/15` on
  2026-08-30 via `scripts/verify/grab.ts`, against a title Radarr did not
  hold. Reached `downloading` — a live Radarr queue item, so the real
  download client really had the release — and tore down completely. See §8.
- ~~**`POST /media/:id/bad-files`**~~ — **now run.** `15/15` on 2026-08-30
  via `scripts/verify/bad-files.ts`. There was never a good reason it was
  untested: it is a local SQLite insert that contacts nothing upstream, and
  it was grouped with its neighbours by name rather than by behaviour. See
  §8.
- **`POST /media/:id/releases/replace`** — **run, but one claim is still
  unmade.** `13 passed · 2 skipped` on 2026-08-30 via
  `scripts/verify/replace.ts`. Everything except the deletion is proven; that
  Radarr's import matcher would not produce a disposable file to delete is
  why. **This is the only genuinely unverified behaviour left in the
  backend.** See §8 for the exact split and the one-line retry.
- **Cursor pagination on `activity`** — still one page, and the only cause of
  the two remaining skips. `gallery`, `history` and `admin/audit-log` all
  round-trip now (`10 + 4 of 14`, `10 + 10 of 35`, `10 + 10 of 78`), so the
  mechanism is proven; `/activity` lists only movie and show jobs, so
  paginating it needs >10 real Radarr/Sonarr adds.

### Passed, but validated nothing

**One row** (down from six, and from two): `media-file` — headers only, no
body captured. The envelope is verified; the element schema inside was not.
The report marks it "validated nothing" so it cannot be misread as coverage.

~~`media-bad-files`~~ — **no longer vacuous.** It answered 200 over `[]` on
every sweep because the `bad_files` table was empty. As of 2026-08-30 the
kept _Following_ (`tmdb:11660`) carries a flag, so the row returns a real
element and `BadFileSchema` is exercised rather than merely composed into an
envelope. `bad-files.ts` asserts that element field by field against what the
insert returned; the sweep's own row now has something to parse.

The reason a **real** media id was chosen for that flag, rather than a
throwaway one, is precisely this row: the sweep mines its `tmdb:` keys from
live routes and prefers library-backed ones, so a flag on a synthetic key
would have proven the route and left this row exactly as empty as before.
Safety comes from the _guid_ being synthetic, not the media id — see §8.

### ✅ The Emby path is now proven end to end

This document previously said: _"The key is proven; the `embyStatus` path is
not."_ **That is no longer true.** Radarr and Sonarr both finished grabbing
the kept titles, so titles with a file on disk finally exist, and the Emby
spot-checks stopped being vacuous:

| Check                         | Was                            | Now                                  |
| ----------------------------- | ------------------------------ | ------------------------------------ |
| `emby.indexed-carries-a-link` | 0 media with an `embyStatus`   | **12 media** with an `embyStatus`    |
| `emby.watch-url-is-external`  | no `watchUrl` among 98 objects | **12 watch links**, `emby.lilnas.io` |
| `movie.file-path-is-a-file`   | no movie carried a `filePath`  | **4 movies** with a `filePath`       |
| `show.file-path-is-a-folder`  | 2 shows with a `filePath`      | **8 shows** with a `filePath`        |

That closes the loop opened when `EMBY_API_KEY` was found set to
`PLACEHOLDER_REPLACE_ME`: the real key authenticates, `emby-status.service.ts`
resolves the user, annotates the title, and emits an external
`https://emby.lilnas.io` link that the frontend can actually follow.

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
isn't there. `media-file` now **passes** against a real kept video —
`application/mp4`, 82,943 bytes served back out of MinIO.

---

## What full verification still requires

The library-content work is **done** (§4) and both fixes are **deployed and
verified** (§6). The read sweep has nothing left to give: 40 of 42 rows pass
and the two skips are a choice. What remains cannot be closed by running the
script again:

1. ~~**`POST /media/:id/bad-files`**~~ — **done**, `15/15` (§8).
2. ~~**`POST /media/:id/releases/grab`**~~ — **done**, `15/15` (§8).
3. **`POST /media/:id/releases/replace` — the delete half only.** The route
   is run and everything else about it is proven; what is missing is a real
   file for `deleteExistingFiles` to remove. This needs **a title Radarr will
   actually import**, which is the whole blocker — two disposable releases
   for `tmdb:10331` were downloaded in full and refused by Radarr's matcher.
   Retry is one command with a different `--tmdb-id` (§8). Do **not** solve
   it by pointing the script at the real library; it deletes what it finds.
4. **`activity-page2` / `cursor.activity`** — needs >10 movie/show adds.
   Deliberately not doing this: the cursor mechanism is proven four other
   ways, so this would be library pollution buying nothing.

There is no unknown failure and no route left behind a flag. Items 3 and 4
are different kinds of open: 4 is a decision, 3 is a test that ran and could
not reach its assertion.

**What §7 changed about how to read this list.** `pause`/`resume` sat here as
"untouched" through the whole exercise and looked like a formality. The first
run of a script written for them found a real 409 on a path the UI exercises
constantly. Treat the three remaining entries as unknowns, not as
near-certain passes.

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
database or a restored backup no longer needs manual repair. The guard is
deployed and ran clean against the real production database — see
**Remaining work §3**.

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
   above — an existing `download.db` written before `57c1409` would kill the
   container at boot until one row was inserted into `__drizzle_migrations`.
   As of `722915b` the guard in `migrate.ts` does this automatically, so this
   prerequisite is now self-servicing.

5. **`./infra/base-images/build-base-images.sh` must run before
   `docker-compose build download`.** The Dockerfile's builder stage copies
   `.next`, `public` and `src/db/migrations` out of `/source`, a snapshot
   baked into `lilnas-monorepo-builder`. Build without refreshing it and you
   get an image built from stale source — silently, with a successful build
   and no warning. This is the general monorepo gotcha in `CLAUDE.md`, but
   `download` is one of the apps where it actually bites.

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

# Pause/resume — a separate script; see §7 for why it cannot live in the sweep
pnpm exec tsx scripts/verify/pause-resume.ts --repo-path /home/jeremy/lilnas
pnpm exec tsx scripts/verify/pause-resume.ts --repo-path /home/jeremy/lilnas --pause-after 2000

# The three Phase 3 write routes — §8. Run bad-files first: the flag it
# leaves is what lets the other two assert their 409s for free.
pnpm exec tsx scripts/verify/bad-files.ts --repo-path /home/jeremy/lilnas
pnpm exec tsx scripts/verify/grab.ts      --repo-path /home/jeremy/lilnas
pnpm exec tsx scripts/verify/replace.ts   --repo-path /home/jeremy/lilnas
pnpm exec tsx scripts/verify/replace.ts   --repo-path /home/jeremy/lilnas --no-seed
```

⚠️ **`bad-files.ts` writes a row nothing can delete.** There is no un-flag
route, so the flag is permanent until someone edits SQLite; the script prints
the exact removal command on every path, crash included. It is safe because
the guid is one no indexer mints — read §8 before changing either the guid or
the `--media-id`, because the reasoning is not symmetric between them.

⚠️ **`grab.ts` and `replace.ts` pull real bytes into the real download
client** and add a real Radarr entry. Both refuse to run against a title
Radarr already holds, because teardown deletes the movie _with its files_.
Both tear down in a `finally` and print every identifier they created. Budget
a minute or two for `grab`; `replace` without `--no-seed` waits on a real
usenet download and import and can run to 25 minutes before giving up.

⚠️ **`replace.ts` exits 2 unless it seeded a file.** `--no-seed` — and any
seeded run Radarr declines to import — takes the documented zero-delete path
and marks the deletion rows `skipped`. That is not a pass, and the verdict
line says so. See §8.

⚠️ **Run `pause-resume.ts` both ways or you have only covered half of it.**
With no flag it pauses the instant the job reads `downloading`, which lands
in the pre-spawn window; `--pause-after 2000` waits past the metadata fetch
so the yt-dlp handle is already registered. Those are two different branches
in `pauseVideoDownloadJob`. It creates one video job and deletes it in a
`finally`, printing the job id on every path so a hard crash still leaves you
something to clean up by hand.

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
