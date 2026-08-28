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

## What's left for 100% verification

All four code fixes are **done**. What remains is operational — it needs the
live backend and a decision about what content to keep permanently.

**Fixes (code) — all landed:**

1. ~~**`GET /media/:id/releases` mutates the library**~~ — **fixed.**
   `ensureMovie`/`ensureSeries` now report `wasAdded`, and
   `ReleaseService.withMonitoring()` deletes a title it had to add rather
   than only unmonitoring it (`unmonitorAndDelete(id, false)`).
   `--include-expensive` is safe to pass.
2. ~~**No request body validation**~~ — **fixed.** All six `@Body()` DTOs and
   both `/search` `@Query()` DTOs now carry an explicit
   `ZodValidationPipe`. `download.controller.validation.test.ts` reads Nest's
   own `ROUTE_ARGS_METADATA` and fails for **any** `@Body()`/`@Query()`
   without one, so a future route can't reopen the gap.
3. ~~**`?? 0` mints invalid catalogue ids**~~ — **fixed.** `toMovie()`/
   `toShow()` throw on a missing `tmdbId`/`tvdbId` the way `toEpisode()`
   already threw on a missing episode number; list call sites go through
   `mapCatalogueEntries()`, which drops the record with a warning instead of
   failing the whole listing.
4. ~~**No video delete route**~~ — **fixed.** `DELETE /download/videos/:jobId`
   stops a running job, deletes its MinIO objects and clears the `videos`
   row's `downloadUrls`. Added to `DownloadClient` as `deleteJob()`, audited
   as `video.delete`, and wired into the verification script's teardown
   table, which no longer has a video-shaped residue hole.

**Verification (operational):**

5. Re-run with `--include-expensive` to cover `media-releases`. Now
   unblocked.
6. Download ~10 clips so the library exceeds one page, covering
   `activity-page2`, `gallery-page2`, `history-page2`,
   `admin-audit-log-page2` and their matching `cursor.*` checks.
7. Keep one video with a live MinIO object, to cover `media-file` and the
   currently-empty-fixture passes.
8. Keep one title actually held by Sonarr/Radarr with a file on disk, to
   exercise `media-seasons` and the real Emby `embyStatus` annotation path
   (proven live but never exercised against real content).

Items 5–8 are ~15–20 min plus deciding what content to permanently keep in
the library.

---

## Summary

|                      |                                               |
| -------------------- | --------------------------------------------- |
| Read checks verified | **25 of 42** rows                             |
| Remaining failures   | **1** — an orphaned gallery row, not a route  |
| Write path           | **All three media types verified end to end** |
| Real bugs found      | **6** (all 6 fixed)                           |

The core request → download → cleanup flow works for movies, shows and videos
against real upstreams.

Latest run: `42 rows · 31 passed (6 of them validated nothing) · 1 failed · 10
skipped`.

**Every remaining unverified row traces to one of two causes:** the library is
empty, or the route is gated behind `--include-expensive`. There is no unknown
failure left in the read sweep.

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

### The one remaining failure

`media-file` returns **404** for
`/download/media/video%3AYkgL4RGtgfyO4T8oubhFU/file` — a key mined from
`gallery`.

This is **not a route bug**. It is the (then) missing video `DELETE` route
showing its consequences: the MinIO object was removed by hand after a mutate
run, the job row had no route that could remove it, and the gallery advertised
a `downloadUrl` that 404s. The checker was correctly reporting a real
inconsistency.

`DELETE /download/videos/:jobId` is what closes this properly — it clears
`downloadUrls` in the same operation that removes the objects, so the gallery
can never again point at something that isn't there. The existing orphan row
still has to be cleared once by hand (or by re-running the flow that created
it and deleting it through the route); the fix prevents the next one.

---

## What full verification still requires

| Blocker                                              | Rows it holds                                                                                                     | Cost                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Library has fewer than 10 jobs**                   | `activity-page2`, `gallery-page2`, `history-page2`, `admin-audit-log-page2` + the four matching `cursor.*` checks | ~15 min of clip downloads |
| **No video with a live MinIO object**                | `media-file` (the failure above), plus the empty-fixture passes                                                   | one kept video            |
| **No title Sonarr/Radarr holds with a file on disk** | `media-seasons`, `emby.indexed-carries-a-link`, `emby.watch-url-is-external`                                      | real, permanent content   |
| **~~`/releases` mutation~~ — fixed**                 | `media-releases`                                                                                                  | just re-run with the flag |

The first two tiers need no code and no permanent library content. The third
requires deciding what to actually keep in the library.

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
