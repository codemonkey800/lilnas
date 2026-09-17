# Plan 015 — Video Download Progress — `apps/download`

> **Status: stub, not a plan.** No task list, no waves, no dependency graph —
> this file exists to preserve the reasoning behind one deferred item so
> whoever picks it up does not re-derive it. Promote it to a real plan when
> the work is actually scheduled.

Plan 013 (the frontend rewrite) and plan 014 (bad-file reporting backend) each
parked a video-pipeline item that was out of scope where it was found.
Originally there were **two**. The second — a yt-dlp spawn-error wedge — was
**fixed directly on 2026-09-16**, before 014's implementation began, so
**015 is H1-only**. See [Already fixed](#already-fixed--do-not-re-open-the-yt-dlp-spawn-error-wedge)
below so nobody re-opens it from the 013/014 triage.

---

## H1. Video download progress — a backend change, so a separate plan

**Why:** the mockups draw progress the API does not carry, and the gap is real
rather than cosmetic. Discovered by 013's E1, verified independently by 013's
orchestrator on 2026-09-15.

### What is true today

- `DownloadQueueSnapshotSchema` (`packages/utils/src/download/schema.ts:52-56`)
  is `{ progress?, status?, timeLeft? }` and hangs off `queueSnapshot`
  (`schema.ts:175`) — which lives on the **Movie/Show branch of the media union
  only**. It is a Radarr/Sonarr queue entry, so it can never cover videos.
- **A video job has no progress field anywhere in `DownloadJob`**, and **no byte
  counter, transfer rate or fragment counter exists for any type.**
- ⚠️ **The backend does not merely fail to expose video progress — it never
  captures it.** yt-dlp emits progress on stdout, but
  `apps/download/src/download/download-video.service.ts:571` does
  `proc.stdout.pipe(logFileStream)` during the actual download. It goes
  **straight to a log file and is never parsed.** (The stdout handler at
  `download-video.service.ts:88` is a different code path — the `--dump-json`
  metadata probe.) 013 recorded this pipe at `:557`; commit `c7eebc62` shifted
  it to `:571`, the code itself is unchanged.
- So `video-detail.pug`'s `fragment 4 of 9` and `412 MB / 640 MB · 3.1 MB/s` are
  **mockup data with nothing behind them.** Per 013's own rule — where a mockup
  and the API disagree about content, the API wins — they are not rendered.

### What it would take, roughly

1. Run yt-dlp with `--newline` plus a `--progress-template` and parse the
   emitted fields (`downloaded_bytes`, `total_bytes`, `speed`, `eta`,
   `fragment_index`, `fragment_count`) instead of piping stdout to a log file.
2. Persist the latest snapshot per job, and throttle it — yt-dlp emits many
   times a second and the gateway broadcasts to every open tab.
3. Add a video-side progress field to the wire schema, mirroring
   `DownloadQueueSnapshotSchema`'s shape so both branches read alike.
4. Broadcast it on the existing `DOWNLOAD_JOB_EVENT_TYPE` frame — no new route
   needed, since `useJobEvents` already upserts whole jobs by id.

### The frontend side is already built and costs nothing

013's E1 and D4 left the seams in deliberately:

- `jobProgress(job)` (`apps/download/src/components/detail/job-state.ts:177`)
  returns **`null`** meaning "draw no bar at all" — the honest rendering of an
  unknown percentage, because **a `0%` bar is a claim**. It starts returning a
  value the moment the field exists.
- `JobLifecycleProps`
  (`apps/download/src/components/detail/job-lifecycle.tsx:86`) already accepts
  `progressPct`, `progressDetail` and `progressNote`, so a page can feed richer
  data in with no signature change.
- D4's `jobProgressPct(job)`
  (`apps/download/src/components/activity/activity-rows.ts:161`) on the activity
  feed has the same `number | null` shape and the same behaviour.

### Decide it from real use

Movies and shows already show a genuine bar; only videos are bare, and the
lifecycle panel still shows their status word. Worth doing only if that reads as
missing once the detail pages are in daily use — at which point option 3 may be
enough on its own:

| Option                                                                                            | Cost                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------- |
| Ship as-is — videos show status, no bar                                                           | zero, already built          |
| Full backend capture, as above                                                                    | a real feature, its own plan |
| Frontend-only indeterminate indicator for videos — shows _activity_ without claiming a percentage | small, no backend change     |

---

## Already fixed — do not re-open: the yt-dlp spawn-error wedge

⚠️ Plans 013 and 014 both flagged this, and 014 originally instructed that it
lead this stub as the higher-priority of two open items. **It is closed, not
deferred.** It is recorded here only so a future reader who finds that triage
does not re-open it. **There is no work to do.**

- **Fixed in commit `c7eebc62`** — _fix(download): settle the download promise
  when a spawn fails_ (2026-09-16).
- **The symptom it caused:** a video job stuck at `downloading`, with pause and
  cancel then wedging at `pausing`/`cancelling` forever. Three real dev jobs
  showed exactly this.
- **It was production-reachable**, via EACCES (if `/opt/yt-dlp/yt-dlp` loses its
  exec bit), EPERM, ENOMEM under memory pressure, and — most importantly — a
  `YtdlpUpdateService` update that leaves a truncated or non-executable binary
  mid-`move`, **which runs on a daily cron, on by default**.
- **The traced mechanism**, which was _not_ the "missing status transition" the
  earlier triage assumed: `runProcess()`'s `proc.on('error')` listener wrote the
  **raw `Error` object** into the job's log stream. That stream is not in object
  mode, so `write()` **throws** `ERR_INVALID_ARG_TYPE` for a non-string chunk
  rather than emitting. The throw escaped the listener — out through `emit()`,
  out of the `process.nextTick()` node schedules for a failed spawn — as an
  **uncaught exception**. `reject()` on the next line never ran, and node emits
  no `'close'` after an `'error'` listener threw, so **nothing settled the
  promise at all.**
- **Why the scheduler looked broken but wasn't:**
  `apps/download/src/download/download-scheduler.service.ts`'s `Failed` write
  never fired because the scheduler's `catch` was still **suspended inside
  `await download()`** — the promise never settled, so `download()` neither
  returned nor threw. Its `clearProc` call never fired because that sits on the
  pause branch, reached only via `JobInterruptedError` from
  `assertNotInterrupted()`, downstream of the same dead await.
- **Why serialising the error was the whole fix:**
  `DownloadStateService.updateJob()` already releases the proc handle and the
  interrupt note on **every terminal transition**, and `Failed` is terminal — so
  settling the promise repaired the rest of the chain on its own.

---

## ⚠️ Constraint H1 inherits: `/opt/yt-dlp` plus the `/usr/bin` symlink

Whoever executes H1 works directly on top of this, since step 1 changes how
yt-dlp is invoked.

- `apps/download/src/ytdlp-update/ytdlp-update.service.ts:21` hardcodes
  `YTDLP_BINARY_PATH = '/opt/yt-dlp/yt-dlp'` and replaces it with
  `move(…, { overwrite: true })` (`ytdlp-update.service.ts:430`) — a rename,
  which needs write permission on the **directory**, not the file. `/usr/bin` is
  `root:root drwxr-xr-x`, so **installing straight to `/usr/bin` would silently
  break every auto-update.**
- Meanwhile `apps/download/src/download/download.service.ts:70` and
  `apps/download/src/download/download-video.service.ts:69,287` spawn
  `/usr/bin/yt-dlp`, **so the symlink must stay.**
- **Anyone touching either path must keep both.** Do not "tidy" them into one.
- `ffmpeg` is equally required — `download-video.service.ts:392` spawns
  `/usr/bin/ffmpeg`, and yt-dlp shells out to it to merge separate video/audio
  streams.
