/**
 * Live verification for `PATCH /download/videos/:id/pause` and `/resume` —
 * the two write routes the plan-009 sweep left untouched.
 *
 * These are the *cheap* half of the never-run write routes: unlike
 * `releases/{grab,replace,bad-files}`, they touch no indexer and no download
 * client, only this service's own job state. That is what makes them safe to
 * run outside a dedicated session.
 *
 * ### The timing problem this script exists to solve
 *
 * `pauseVideoDownloadJob` refuses anything that is not `Downloading` and
 * requires a live child process (`download.service.ts:344-358`). For the
 * five-second fixture clip the download phase can be over in a couple of
 * seconds, so a 2s poll — what `mutate.ts` uses — can miss the window
 * entirely. This polls at {@link CATCH_INTERVAL_MS} and reports an honest
 * `skipped` with timings when the window closes first, rather than a `fail`
 * that says nothing about the routes.
 *
 * ### What "paused" has to mean to count
 *
 * A 200 from the route is not the assertion. `Pausing` is only an intent —
 * `DownloadSchedulerService`'s interrupt branch is what lands the job in
 * `Paused` once the SIGTERM'd yt-dlp actually exits. So this waits for
 * `Paused`, then holds still for {@link STABILITY_HOLD_MS} and re-reads: a job
 * whose `progress` advances while it claims to be paused was never paused.
 *
 * Cleanup is best-effort in a `finally`, and the job id is printed on every
 * path so a hard crash leaves a human something to delete by hand. Unlike
 * `mutate.ts` there is no journal here, which is the deliberate trade for a
 * script that creates exactly one job.
 *
 * Usage:
 *
 * ```bash
 * pnpm exec tsx scripts/verify/pause-resume.ts --repo-path /home/jeremy/lilnas
 * pnpm exec tsx scripts/verify/pause-resume.ts --base-url http://localhost:8081
 * ```
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { z } from 'zod'

import {
  DownloadJobStatus,
  DownloadType,
} from '../../../../packages/utils/src/download/schema'
import { AuditLogPageSchema, DownloadJobResponseSchema } from './envelopes'
import {
  dockerExecTransport,
  type HttpMethod,
  httpTransport,
  isTransportError,
  type Transport,
} from './transport'

/**
 * Fast enough to land inside a short `Downloading` phase. `mutate.ts` polls at
 * 2s, which is fine for watching a job *progress* and useless for catching it
 * in one specific state.
 */
const CATCH_INTERVAL_MS = 150

/** Ceiling on the wait for `Downloading` to appear. */
const CATCH_WINDOW_MS = 90_000

/** Ceiling on `Pausing` → `Paused`, which waits on a real process exit. */
const PAUSE_WINDOW_MS = 45_000

/** Ceiling on the post-resume run to a terminal status. */
const RESUME_WINDOW_MS = 180_000

/**
 * How long to sit still before re-reading a paused job. Long enough that a
 * download that was never actually stopped would have moved `progress`.
 */
const STABILITY_HOLD_MS = 4_000

const DEFAULT_FIXTURES_FILE = path.join(__dirname, 'fixtures.json')

const VIDEOS_PATH = '/download/videos'

/** Attribution only — none of these routes is admin-gated. */
const PAUSE_RESUME_USER_ID = 'verify-pause-resume'

const FixturesSchema = z.object({
  adminEmail: z.string().email(),
  video: z.object({
    url: z.string().url(),
    timeRange: z.object({ start: z.string(), end: z.string() }),
  }),
})

type RowStatus = 'pass' | 'fail' | 'skipped'

interface Row {
  name: string
  status: RowStatus
  note: string
  details?: string[]
}

interface Attempt<T> {
  ok: boolean
  status: number | null
  data?: T
  reason?: string
  durationMs?: number
}

type Job = z.infer<typeof DownloadJobResponseSchema>

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  const repoPath = args.get('repo-path')
  const baseUrl = args.get('base-url')
  if (repoPath && baseUrl) {
    throw new Error('--repo-path and --base-url are mutually exclusive')
  }
  if (!repoPath && !baseUrl) {
    throw new Error('--repo-path is required (or --base-url)')
  }

  const fixtures = FixturesSchema.parse(
    JSON.parse(
      await readFile(
        path.resolve(args.get('fixtures') ?? DEFAULT_FIXTURES_FILE),
        'utf8',
      ),
    ),
  )

  const transport = repoPath
    ? dockerExecTransport({ repoPath })
    : httpTransport(baseUrl as string)

  const request = makeRequest(transport, {
    'X-Forwarded-User': fixtures.adminEmail,
    'X-Forwarded-User-Id': PAUSE_RESUME_USER_ID,
  })

  // Overridable because the whole test hinges on the download phase lasting
  // long enough to catch, and that is a property of the clip, not the code.
  const url = args.get('url') ?? fixtures.video.url
  const timeRange = {
    start: args.get('start') ?? fixtures.video.timeRange.start,
    end: args.get('end') ?? fixtures.video.timeRange.end,
  }

  console.log('Download backend — pause/resume verification')
  console.log(
    `  target    ${repoPath ? `docker compose exec in ${repoPath}` : baseUrl}`,
  )
  console.log(`  clip      ${url} [${timeRange.start} → ${timeRange.end}]`)
  console.log('')

  const rows: Row[] = []
  let jobId: string | undefined

  try {
    const created = await request({
      method: 'POST',
      path: VIDEOS_PATH,
      json: { url, timeRange },
      schema: DownloadJobResponseSchema,
    })

    if (!created.ok || !created.data) {
      rows.push({
        name: 'create',
        status: 'fail',
        note: 'POST /download/videos failed',
        details: [created.reason ?? 'no reason given'],
      })
      return finish(rows, jobId)
    }

    jobId = created.data.id
    rows.push({
      name: 'create',
      status: 'pass',
      note: `job ${jobId} created as ${created.data.status}`,
    })

    console.log(`  job       ${jobId}`)
    console.log('')

    rows.push(...(await runPauseResume(request, jobId)))
  } catch (error) {
    rows.push({
      name: 'unexpected',
      status: 'fail',
      note: 'threw outside the assertion path',
      details: [describe(error)],
    })
  } finally {
    if (jobId && !args.has('keep')) {
      rows.push(await cleanup(request, jobId))
    } else if (jobId) {
      rows.push({
        name: 'cleanup',
        status: 'skipped',
        note: `--keep passed; job ${jobId} left in place`,
      })
    }
  }

  return finish(rows, jobId)
}

/** Everything between "the job exists" and "the job is cleaned up". */
async function runPauseResume(
  request: RequestFn,
  jobId: string,
): Promise<Row[]> {
  const rows: Row[] = []

  // --- catch it in Downloading -------------------------------------------
  const caught = await waitForStatus(
    request,
    jobId,
    s => s === DownloadJobStatus.Downloading,
    CATCH_WINDOW_MS,
  )

  if (!caught.job || caught.job.status !== DownloadJobStatus.Downloading) {
    // Not a failure of the routes. The clip finished downloading before a
    // 150ms poll could see it, which says nothing about pause/resume.
    rows.push({
      name: 'pause.catch-downloading',
      status: 'skipped',
      note: 'never observed `downloading` — cannot exercise pause',
      details: [
        `observed: ${caught.observed.join(' → ') || '(nothing)'}`,
        `waited ${caught.elapsedMs}ms at a ${CATCH_INTERVAL_MS}ms interval`,
        'retry with a longer clip: --url <long video> --start 00:00:00 --end 00:02:00',
      ],
    })
    return rows
  }

  rows.push({
    name: 'pause.catch-downloading',
    status: 'pass',
    note: `reached \`downloading\` after ${caught.elapsedMs}ms`,
    details: [`observed: ${caught.observed.join(' → ')}`],
  })

  // --- pause --------------------------------------------------------------
  //
  // Retried, because `downloading` does not yet imply pausable. `download()`
  // writes `Downloading` (`download-video.service.ts:236`) and only registers
  // the yt-dlp handle at line 292, with a whole `yt-dlp --dump-json` metadata
  // fetch in between. For that entire window the job reports `downloading` and
  // pause answers 409 `has no running process to pause`. Measuring that lag is
  // half the point of this script.
  const attemptStartedAt = Date.now()
  let paused = await request({
    method: 'PATCH',
    path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}/pause`,
    schema: DownloadJobResponseSchema,
  })
  let attempts = 1

  while (
    paused.status === 409 &&
    Date.now() - attemptStartedAt < CATCH_WINDOW_MS
  ) {
    const current = await request({
      path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}`,
      schema: DownloadJobResponseSchema,
    })
    // Left `Downloading` on its own — the clip finished before pause ever
    // became possible, which is a timing miss, not a route failure.
    if (current.data?.status !== DownloadJobStatus.Downloading) {
      break
    }

    await sleep(CATCH_INTERVAL_MS)
    paused = await request({
      method: 'PATCH',
      path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}/pause`,
      schema: DownloadJobResponseSchema,
    })
    attempts += 1
  }

  const procLagMs = Date.now() - attemptStartedAt

  rows.push({
    name: 'pause.proc-registration-lag',
    status: attempts === 1 ? 'pass' : 'fail',
    note:
      attempts === 1
        ? 'pausable as soon as the job read `downloading`'
        : `\`downloading\` but not pausable for ${procLagMs}ms (${attempts - 1} × 409)`,
    details:
      attempts === 1
        ? undefined
        : [
            'the job advertises `downloading` before yt-dlp is registered',
            'download-video.service.ts:236 sets the status; :292 sets the process',
            'a user pausing inside this window gets 409 with no way to know why',
          ],
  })

  if (!paused.ok || !paused.data) {
    rows.push({
      name: 'pause.accepted',
      status: 'fail',
      note: 'PATCH /videos/:id/pause failed',
      details: [paused.reason ?? 'no reason given'],
    })
    return rows
  }

  // `Pausing` is what the route writes; `Paused` is legal too if the process
  // died between the write and the response being serialised.
  const acceptedStatuses = new Set<string>([
    DownloadJobStatus.Pausing,
    DownloadJobStatus.Paused,
  ])
  rows.push({
    name: 'pause.accepted',
    status: acceptedStatuses.has(paused.data.status) ? 'pass' : 'fail',
    note: `HTTP ${paused.status}, job now \`${paused.data.status}\``,
    details: acceptedStatuses.has(paused.data.status)
      ? undefined
      : ['expected `pausing` or `paused`'],
  })

  // --- Pausing → Paused ---------------------------------------------------
  const settled = await waitForStatus(
    request,
    jobId,
    s => s === DownloadJobStatus.Paused,
    PAUSE_WINDOW_MS,
  )

  if (!settled.job || settled.job.status !== DownloadJobStatus.Paused) {
    rows.push({
      name: 'pause.settles-to-paused',
      status: 'fail',
      note: `never reached \`paused\` within ${PAUSE_WINDOW_MS}ms`,
      details: [`observed: ${settled.observed.join(' → ') || '(no change)'}`],
    })
    return rows
  }

  rows.push({
    name: 'pause.settles-to-paused',
    status: 'pass',
    note: `\`paused\` after ${settled.elapsedMs}ms`,
    details: [`observed: ${settled.observed.join(' → ')}`],
  })

  // --- it is really stopped, not just labelled -----------------------------
  //
  // The job carries no `progress` field, so the assertion is the status
  // holding. That is not a weaker check than it looks: the fixture clip runs
  // the whole `converting → uploading → cleaning → completed` tail in a couple
  // of seconds, so a job whose yt-dlp was never actually killed would have
  // moved well off `paused` inside the hold. `updatedAt` comes along as
  // corroboration, not as the assertion.
  const updatedAtPause = settled.job.updatedAt
  await sleep(STABILITY_HOLD_MS)
  const after = await request({
    path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}`,
    schema: DownloadJobResponseSchema,
  })

  if (!after.ok || !after.data) {
    rows.push({
      name: 'pause.actually-stopped',
      status: 'fail',
      note: 'could not re-read the job after the hold',
      details: [after.reason ?? 'no reason given'],
    })
  } else {
    const stillPaused = after.data.status === DownloadJobStatus.Paused
    rows.push({
      name: 'pause.actually-stopped',
      status: stillPaused ? 'pass' : 'fail',
      note: `still \`${after.data.status}\` after a ${STABILITY_HOLD_MS}ms hold`,
      details: stillPaused
        ? [
            after.data.updatedAt === updatedAtPause
              ? 'updatedAt unchanged'
              : `updatedAt moved ${updatedAtPause} → ${after.data.updatedAt}`,
          ]
        : [
            'status moved off `paused` on its own — the process was not stopped',
          ],
    })
  }

  // --- the guard: resume is the only legal move out of Paused --------------
  const badPause = await request({
    method: 'PATCH',
    path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}/pause`,
    schema: DownloadJobResponseSchema,
  })
  rows.push({
    name: 'pause.rejects-when-paused',
    status: badPause.status === 409 ? 'pass' : 'fail',
    note: `pausing a paused job answered HTTP ${badPause.status ?? 'nothing'}`,
    details: badPause.status === 409 ? undefined : ['expected 409 Conflict'],
  })

  // --- resume -------------------------------------------------------------
  const resumed = await request({
    method: 'PATCH',
    path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}/resume`,
    schema: DownloadJobResponseSchema,
  })

  if (!resumed.ok || !resumed.data) {
    rows.push({
      name: 'resume.accepted',
      status: 'fail',
      note: 'PATCH /videos/:id/resume failed',
      details: [resumed.reason ?? 'no reason given'],
    })
    return rows
  }

  // `resumeVideoDownloadJob` writes `Pending` then re-reads, because
  // `requeue()` can reach `Downloading` synchronously. Both are correct.
  const resumeStatuses = new Set<string>([
    DownloadJobStatus.Pending,
    DownloadJobStatus.Downloading,
  ])
  rows.push({
    name: 'resume.accepted',
    status: resumeStatuses.has(resumed.data.status) ? 'pass' : 'fail',
    note: `HTTP ${resumed.status}, job now \`${resumed.data.status}\``,
    details: resumeStatuses.has(resumed.data.status)
      ? undefined
      : ['expected `pending` or `downloading`'],
  })

  // --- and it finishes ----------------------------------------------------
  const finished = await waitForStatus(
    request,
    jobId,
    s =>
      s === DownloadJobStatus.Completed ||
      s === DownloadJobStatus.Failed ||
      s === DownloadJobStatus.Cancelled,
    RESUME_WINDOW_MS,
  )

  const finalStatus = finished.job?.status
  rows.push({
    name: 'resume.runs-to-completion',
    status: finalStatus === DownloadJobStatus.Completed ? 'pass' : 'fail',
    note: `ended \`${finalStatus ?? 'unknown'}\` after ${finished.elapsedMs}ms`,
    details: [
      `observed: ${finished.observed.join(' → ') || '(no change)'}`,
      ...(finished.job?.error ? [`error: ${finished.job.error}`] : []),
    ],
  })

  if (finalStatus === DownloadJobStatus.Completed) {
    const urls = videoUrls(finished.job)
    rows.push({
      name: 'resume.produced-output',
      status: urls.length > 0 ? 'pass' : 'fail',
      note: `${urls.length} download URL(s) on the completed job`,
      details:
        urls.length > 0 ? undefined : ['a resumed job produced no output'],
    })
  }

  // --- audit trail --------------------------------------------------------
  rows.push(await auditRow(request, jobId))

  return rows
}

/**
 * Both actions must be on record. These routes write `video.pause` /
 * `video.resume` through the same helper as `video.delete`, so a missing row
 * means the audit wiring, not the route, is broken.
 */
async function auditRow(request: RequestFn, jobId: string): Promise<Row> {
  const audit = await request({
    path: '/download/admin/audit-log?limit=50',
    schema: AuditLogPageSchema,
  })

  if (!audit.ok || !audit.data) {
    return {
      name: 'audit.records-both',
      status: 'fail',
      note: 'could not read the audit log',
      details: [audit.reason ?? 'no reason given'],
    }
  }

  const mine = audit.data.items.filter(item => item.targetId === jobId)
  const actions = new Set<string>(mine.map(item => item.action))
  const missing = ['video.pause', 'video.resume'].filter(a => !actions.has(a))

  return {
    name: 'audit.records-both',
    status: missing.length === 0 ? 'pass' : 'fail',
    note:
      missing.length === 0
        ? 'both `video.pause` and `video.resume` recorded'
        : `missing: ${missing.join(', ')}`,
    details: [`actions for this job: ${[...actions].join(', ') || '(none)'}`],
  }
}

async function cleanup(request: RequestFn, jobId: string): Promise<Row> {
  const deleted = await request({
    method: 'DELETE',
    path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}`,
    schema: DownloadJobResponseSchema,
  })

  if (!deleted.ok) {
    return {
      name: 'cleanup',
      status: 'fail',
      note: `DELETE /download/videos/${jobId} failed — clean up by hand`,
      details: [deleted.reason ?? 'no reason given'],
    }
  }

  const urls = videoUrls(deleted.data)
  return {
    name: 'cleanup',
    status: urls.length === 0 ? 'pass' : 'fail',
    note: `job deleted, status \`${deleted.data?.status}\``,
    details:
      urls.length === 0
        ? undefined
        : [`downloadUrls not cleared: ${urls.length} left`],
  }
}

/**
 * `downloadUrls` hangs off the `Video` arm of the media union, not off the job,
 * so it has to be reached through the discriminant.
 */
function videoUrls(job: Job | undefined): string[] {
  if (!job || job.media.type !== DownloadType.Video) {
    return []
  }
  return job.media.downloadUrls ?? []
}

interface WaitResult {
  job?: Job
  observed: string[]
  elapsedMs: number
}

/** Polls until `predicate` holds, the job goes terminal, or the window closes. */
async function waitForStatus(
  request: RequestFn,
  jobId: string,
  predicate: (status: string) => boolean,
  windowMs: number,
): Promise<WaitResult> {
  const startedAt = Date.now()
  const observed: string[] = []
  let job: Job | undefined

  while (Date.now() - startedAt < windowMs) {
    const attempt = await request({
      path: `${VIDEOS_PATH}/${encodeURIComponent(jobId)}`,
      schema: DownloadJobResponseSchema,
    })

    if (attempt.ok && attempt.data) {
      job = attempt.data
      if (observed[observed.length - 1] !== job.status) {
        observed.push(job.status)
      }
      if (predicate(job.status)) {
        break
      }
    }

    await sleep(CATCH_INTERVAL_MS)
  }

  return { job, observed, elapsedMs: Date.now() - startedAt }
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

interface RequestInput<T> {
  path: string
  method?: HttpMethod
  json?: unknown
  schema?: z.ZodType<T>
}

type RequestFn = <T>(input: RequestInput<T>) => Promise<Attempt<T>>

/** The same collapse-everything-into-a-sentence contract `mutate.ts` uses. */
function makeRequest(
  transport: Transport,
  headers: Record<string, string>,
): RequestFn {
  return async function request<T>(
    input: RequestInput<T>,
  ): Promise<Attempt<T>> {
    const method = input.method ?? 'GET'

    try {
      const response = await transport(input.path, headers, {
        method,
        json: input.json,
      })

      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          status: response.status,
          reason: `${method} ${input.path} answered HTTP ${response.status}: ${response.body.slice(0, 300)}`,
        }
      }

      if (!input.schema) {
        return { ok: true, status: response.status }
      }

      const parsed = input.schema.safeParse(JSON.parse(response.body))
      if (!parsed.success) {
        return {
          ok: false,
          status: response.status,
          reason: `${method} ${input.path} answered a shape the contract does not allow: ${parsed.error.issues
            .slice(0, 4)
            .map(i => `${i.path.join('.')}: ${i.message}`)
            .join('; ')}`,
        }
      }

      return {
        ok: true,
        status: response.status,
        data: parsed.data,
        durationMs: response.durationMs,
      }
    } catch (error) {
      if (isTransportError(error)) {
        return {
          ok: false,
          status: null,
          reason: `${method} ${input.path} could not be delivered (${error.reason}): ${error.message}`,
        }
      }
      return { ok: false, status: null, reason: describe(error) }
    }
  }
}

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out.set(name, next)
      i += 1
    } else {
      out.set(name, 'true')
    }
  }
  return out
}

function finish(rows: Row[], jobId: string | undefined): number {
  const width = Math.max(...rows.map(r => r.name.length), 10)
  const counts = { pass: 0, fail: 0, skipped: 0 }

  console.log('')
  for (const row of rows) {
    counts[row.status] += 1
    const mark =
      row.status === 'pass' ? 'PASS' : row.status === 'fail' ? 'FAIL' : 'SKIP'
    console.log(`  ${mark}  ${row.name.padEnd(width)}  ${row.note}`)
    for (const detail of row.details ?? []) {
      console.log(`        ${' '.repeat(width)}  ${detail}`)
    }
  }

  console.log('')
  console.log(
    `  ${rows.length} rows · ${counts.pass} passed · ${counts.fail} failed · ${counts.skipped} skipped`,
  )
  if (jobId) {
    console.log(`  job ${jobId}`)
  }

  // A run that skipped the catch never exercised the routes at all — saying
  // "0 failed" about that would be the exact misreading `mutate.ts` warns of.
  if (counts.fail > 0) {
    console.log('  VERDICT: FAILED')
    return 1
  }
  if (counts.skipped > 0) {
    console.log('  VERDICT: NOT A PASS — pause was never exercised')
    return 2
  }
  console.log('  VERDICT: PASS — pause and resume both verified live')
  return 0
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main()
  .then(code => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(describe(error))
    process.exitCode = 1
  })
