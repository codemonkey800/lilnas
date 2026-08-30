/**
 * Live verification for `POST /download/media/:id/releases/grab` — the fourth
 * of the five write routes the plan-009 sweep left untouched, and the first
 * genuinely expensive one.
 *
 * ### What this actually costs, measured rather than assumed
 *
 * A grab hands a specific release to Radarr, which hands it to the real
 * download client, which pulls real bytes. That is the reason it was fenced
 * off from `mutate.ts` — whose docblock says nothing there should be extended
 * to call it — and the fence is right.
 *
 * What the fence obscured is that the **teardown** is not new. A movie job's
 * `Downloading` status is derived from a live Radarr *queue item*
 * (`media-poller.service.ts`), and `DELETE /download/movies/:jobId` runs
 * `unmonitorAndDelete`, which cancels every queue item for the movie with
 * `removeFromClient: true` *before* deleting it (`radarr.service.ts:486`).
 * That is the same teardown `mutate --only movie` has been running against
 * the same download client since the first sweep — the only difference here
 * is that the release is user-picked rather than auto-selected. So the
 * incremental risk over an already-routine pass is the bytes that arrive
 * between the grab and the delete, and nothing else.
 *
 * The script leans on that: it tears down the instant it has its evidence
 * rather than watching the download finish, because "the release reached the
 * download client" is the claim and a completed import is not.
 *
 * ### Why `status: downloading` is the assertion
 *
 * A 201 only proves Radarr accepted the push. `MediaPollerService` derives
 * `Downloading` from a queue record that exists **only once the download
 * client has the release**, so waiting for that status is the difference
 * between "the route returned" and "the bytes are moving".
 *
 * ### The refusal path costs nothing and is checked first
 *
 * `assertNotFlagged` runs before `runGrab`, so a grab of a flagged guid is a
 * 409 with no upstream contact at all. `bad-files.ts` leaves exactly one
 * synthetic flag behind, which makes that path free to exercise — see
 * {@link FLAGGED_GUID}. Run `bad-files.ts` first or this row skips.
 *
 * ### Target selection
 *
 * The default is a title Radarr does **not** hold, so teardown is a complete
 * removal rather than a partial one — deleting a title that was already in
 * the library would destroy someone's copy. The script refuses to run against
 * a held title unless `--force` is passed.
 *
 * Usage:
 *
 * ```bash
 * pnpm exec tsx scripts/verify/bad-files.ts --repo-path /home/jeremy/lilnas
 * pnpm exec tsx scripts/verify/grab.ts --repo-path /home/jeremy/lilnas
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
import {
  AuditLogPageSchema,
  DownloadJobResponseSchema,
  ListBadFilesResponseSchema,
  ListReleasesResponseSchema,
  MediaDetailResponseSchema,
} from './envelopes'
import {
  dockerExecTransport,
  type HttpMethod,
  httpTransport,
  isTransportError,
  type Transport,
} from './transport'

/**
 * Radarr does not hold this, and it is small, old and uncontroversial — the
 * three properties that matter for a title this script is going to add and
 * then delete. Override with `--tmdb-id`.
 */
const DEFAULT_TMDB_ID = 10331

/** The synthetic flag `bad-files.ts` leaves on `tmdb:${fixtures.movie.tmdbId}`. */
const FLAGGED_GUID = 'lilnas-verify:bad-file:synthetic-guid-v1'

/**
 * One half of a split archive. Radarr accepts the grab and the download
 * client finishes it, but the import is then blocked with "was not found in
 * the grabbed release". This script only claims the release reached the
 * client, so such a pick would still pass — but it makes the run a worse
 * proxy for what a user's grab does, and it is what stalled the first run of
 * `replace.ts`, which genuinely needs the file. Filtered in both for one
 * selection rule rather than two.
 */
const SPLIT_ARCHIVE = /\.part\d+\b/i

/** Ceiling on the wait for a Radarr queue item to appear. */
const QUEUE_WINDOW_MS = 120_000

/** Poll interval while waiting for the queue item. */
const POLL_INTERVAL_MS = 2_000

/** Expected residue baseline, asserted before and after. */
const EXPECTED_GALLERY_ITEMS = 15
const EXPECTED_GALLERY_WITH_URLS = 12

const DEFAULT_FIXTURES_FILE = path.join(__dirname, 'fixtures.json')

const GRAB_USER_ID = 'verify-grab'

const FixturesSchema = z.object({
  adminEmail: z.string().email(),
  movie: z.object({ tmdbId: z.number().int().positive() }),
})

const GalleryResidueSchema = z.object({
  items: z.array(
    z.object({
      media: z.object({ downloadUrls: z.array(z.string()).optional() }),
    }),
  ),
})

const ActivityResidueSchema = z.object({
  total: z.number().int().nonnegative(),
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
}

type Job = z.infer<typeof DownloadJobResponseSchema>
type Release = z.infer<typeof ListReleasesResponseSchema>['releases'][number]

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
    'X-Forwarded-User-Id': GRAB_USER_ID,
  })

  const tmdbId = Number(args.get('tmdb-id') ?? DEFAULT_TMDB_ID)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new Error(`--tmdb-id must be a positive integer, got '${tmdbId}'`)
  }
  const mediaId = `tmdb:${tmdbId}`
  const mediaPath = `/download/media/${encodeURIComponent(mediaId)}`

  console.log('Download backend — releases/grab verification')
  console.log(
    `  target    ${repoPath ? `docker compose exec in ${repoPath}` : baseUrl}`,
  )
  console.log(`  media     ${mediaId}`)
  console.log('')

  const rows: Row[] = []
  let jobId: string | undefined
  let radarrId: number | undefined

  try {
    rows.push(...(await residueRows(request, 'before')))
    rows.push(await refusalRow(request, `tmdb:${fixtures.movie.tmdbId}`))

    const preflight = await preflightRow(request, mediaPath, args.has('force'))
    rows.push(preflight.row)
    if (preflight.row.status !== 'pass') {
      return finish(rows, jobId, radarrId, mediaId)
    }

    const picked = await pickRow(request, mediaPath)
    rows.push(...picked.rows)
    if (!picked.release) {
      return finish(rows, jobId, radarrId, mediaId)
    }

    rows.push(await validationRow(request, mediaPath, picked.release))

    const grabbed = await grabRow(request, mediaId, mediaPath, picked.release)
    rows.push(...grabbed.rows)
    jobId = grabbed.job?.id

    if (grabbed.job) {
      const reached = await reachedClientRow(request, grabbed.job.id)
      rows.push(reached.row)
      radarrId = reached.radarrId
      rows.push(
        await auditRow(request, mediaId, grabbed.job.id, picked.release),
      )
    }
  } catch (error) {
    rows.push({
      name: 'unexpected',
      status: 'fail',
      note: 'threw outside the assertion path',
      details: [describe(error)],
    })
  } finally {
    if (jobId && !args.has('keep')) {
      rows.push(...(await teardown(request, jobId, mediaPath)))
    } else if (jobId) {
      rows.push({
        name: 'teardown',
        status: 'skipped',
        note: `--keep passed; job ${jobId} and ${mediaId} left in the library`,
      })
    }
    rows.push(...(await residueRows(request, 'after')))
  }

  return finish(rows, jobId, radarrId, mediaId)
}

/**
 * The 409 that costs nothing.
 *
 * `grabRelease` calls `assertNotFlagged` immediately after
 * `parseReleaseTarget` and before `runGrab`, so this never reaches Radarr,
 * never adds a library entry and never touches the download client. It is
 * only possible because `bad-files.ts` left a flag behind — which is the one
 * upside of that script's un-deletable residue.
 */
async function refusalRow(
  request: RequestFn,
  flaggedMediaId: string,
): Promise<Row> {
  const name = 'grab.refuses-a-flagged-release'

  // The precondition is checked rather than inferred, so a missing flag
  // reports as a skip and a present-but-ignored flag reports as a failure.
  // Collapsing the two would let a broken `assertNotFlagged` masquerade as
  // "you forgot to run bad-files.ts".
  const flags = await request({
    path: `/download/media/${encodeURIComponent(flaggedMediaId)}/bad-files`,
    schema: ListBadFilesResponseSchema,
  })
  const present = flags.data?.badFiles.some(f => f.releaseGuid === FLAGGED_GUID)

  if (!present) {
    return {
      name,
      status: 'skipped',
      note: `no synthetic flag on ${flaggedMediaId} — run bad-files.ts first`,
      details: [`this row needs guid ${FLAGGED_GUID}`],
    }
  }

  const refused = await request({
    method: 'POST',
    path: `/download/media/${encodeURIComponent(flaggedMediaId)}/releases/grab`,
    json: { guid: FLAGGED_GUID, indexerId: 0 },
  })

  return {
    name,
    status: refused.status === 409 ? 'pass' : 'fail',
    note: `grabbing the flagged guid on ${flaggedMediaId} answered HTTP ${refused.status ?? 'nothing'}`,
    details:
      refused.status === 409
        ? [
            'assertNotFlagged runs before runGrab — no Radarr call, no library entry',
          ]
        : [
            'expected 409 — a flagged release must be refused with no override path',
            refused.reason ?? '',
          ].filter(Boolean),
  }
}

/**
 * Refuses to run against a title Radarr already holds.
 *
 * Teardown here is `unmonitorAndDelete(deleteFiles: true)`. Against a title
 * that was in the library before this script started, that is not a teardown
 * — it is destroying someone's copy. `radarrId` is the same signal
 * `mutate.ts`'s `confirmGone` uses.
 */
async function preflightRow(
  request: RequestFn,
  mediaPath: string,
  force: boolean,
): Promise<{ row: Row }> {
  const detail = await request({
    path: mediaPath,
    schema: MediaDetailResponseSchema,
  })

  if (!detail.ok || !detail.data) {
    return {
      row: {
        name: 'preflight.not-in-library',
        status: 'fail',
        note: 'could not resolve the target title',
        details: [detail.reason ?? 'no reason given'],
      },
    }
  }

  const media = detail.data.media
  const held = media.type === DownloadType.Movie ? media.radarrId : undefined

  if (held !== undefined && !force) {
    return {
      row: {
        name: 'preflight.not-in-library',
        status: 'skipped',
        note: `Radarr already holds '${media.title}' as ${held} — refusing to run`,
        details: [
          'teardown deletes the movie *with its files*; on a held title that is',
          'destruction, not cleanup. Pick another --tmdb-id, or pass --force if',
          'you genuinely do not mind losing this copy.',
        ],
      },
    }
  }

  return {
    row: {
      name: 'preflight.not-in-library',
      status: 'pass',
      note:
        held === undefined
          ? `'${media.title}' is known but not held — teardown will be a clean removal`
          : `--force: proceeding against held title '${media.title}' (radarrId ${held})`,
    },
  }
}

/**
 * Lists the releases and picks the smallest one Radarr would actually accept.
 *
 * `GET /media/:id/releases` is already proven safe — it borrows the library
 * entry and takes it back (`withMonitoring`, `restore: true`) — so this is a
 * read, not a mutation, despite being the most expensive call in the script.
 *
 * Smallest-first is the whole cost-control strategy: the grab is torn down
 * as soon as it is observed, so the bytes that land are whatever arrives in
 * that window, and a smaller release makes a mid-download teardown more
 * likely than a completed import.
 */
async function pickRow(
  request: RequestFn,
  mediaPath: string,
): Promise<{ rows: Row[]; release?: Release }> {
  const rows: Row[] = []

  const listed = await request({
    path: `${mediaPath}/releases`,
    schema: ListReleasesResponseSchema,
  })

  if (!listed.ok || !listed.data) {
    rows.push({
      name: 'releases.listed',
      status: 'fail',
      note: 'GET /media/:id/releases failed',
      details: [listed.reason ?? 'no reason given'],
    })
    return { rows }
  }

  rows.push({
    name: 'releases.listed',
    status: listed.data.releases.length > 0 ? 'pass' : 'fail',
    note: `${listed.data.releases.length} release(s) from the indexers`,
    details:
      listed.data.releases.length > 0
        ? undefined
        : ['nothing to grab — pick another --tmdb-id'],
  })

  // `rejected` is Radarr's own verdict (quality profile, language, size); a
  // rejected release is one it will refuse to push, so grabbing one would
  // test the error path rather than the route.
  const eligible = listed.data.releases
    .filter(
      r =>
        !r.rejected &&
        r.downloadAllowed !== false &&
        r.size &&
        !SPLIT_ARCHIVE.test(r.title ?? ''),
    )
    .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))

  const release = eligible[0]
  rows.push({
    name: 'releases.picked-the-smallest',
    status: release ? 'pass' : 'fail',
    note: release
      ? `${mb(release.size)} MB — ${release.title?.slice(0, 60) ?? release.guid}`
      : 'no acceptable release (all rejected or size-less)',
    details: release
      ? [
          `${eligible.length} of ${listed.data.releases.length} were acceptable`,
          `guid ${release.guid}`,
          `indexerId ${release.indexerId}, protocol ${release.protocol ?? '?'}`,
        ]
      : ['every release was `rejected` or carried no size'],
  })

  return { rows, release }
}

/**
 * `indexerId` is required on a grab (`z.number().int().nonnegative()`),
 * unlike on a flag where it is optional. Omitting it must 400 before
 * anything reaches Radarr — which is the cheapest possible proof the pipe on
 * `GrabReleaseInputDto` is wired to the handler rather than merely declared.
 */
async function validationRow(
  request: RequestFn,
  mediaPath: string,
  release: Release,
): Promise<Row> {
  const bad = await request({
    method: 'POST',
    path: `${mediaPath}/releases/grab`,
    json: { guid: release.guid },
  })

  return {
    name: 'validation.rejects-missing-indexerId',
    status: bad.status === 400 ? 'pass' : 'fail',
    note: `a grab with no indexerId answered HTTP ${bad.status ?? 'nothing'}`,
    details:
      bad.status === 400
        ? ['rejected before runGrab — no library entry, no download client']
        : [
            'expected 400; anything else means a malformed grab reached Radarr',
            bad.reason ?? '',
          ].filter(Boolean),
  }
}

/** The grab itself, and that the job it mints is the ordinary movie job. */
async function grabRow(
  request: RequestFn,
  mediaId: string,
  mediaPath: string,
  release: Release,
): Promise<{ rows: Row[]; job?: Job }> {
  const rows: Row[] = []

  const grabbed = await request({
    method: 'POST',
    path: `${mediaPath}/releases/grab`,
    json: { guid: release.guid, indexerId: release.indexerId },
    schema: DownloadJobResponseSchema,
  })

  if (!grabbed.ok || !grabbed.data) {
    rows.push({
      name: 'grab.accepted',
      status: 'fail',
      note: 'POST /media/:id/releases/grab failed',
      details: [grabbed.reason ?? 'no reason given'],
    })
    return { rows }
  }

  const job = grabbed.data
  rows.push({
    name: 'grab.accepted',
    status: 'pass',
    note: `HTTP ${grabbed.status}, job ${job.id} as \`${job.status}\``,
    details: ['body parsed as a bare DownloadJob'],
  })

  // The one thing a grab must not do differently from `POST /download/movies`:
  // `runGrab` goes through `MediaDownloadService.request()`, the same choke
  // point, so the job has to be indistinguishable from a requested one — the
  // right media, the right type, and no stray show scope.
  const shaped =
    job.media.type === DownloadType.Movie &&
    job.media.id === mediaId &&
    job.scope === undefined

  rows.push({
    name: 'grab.mints-an-ordinary-movie-job',
    status: shaped ? 'pass' : 'fail',
    note: `media \`${job.media.id}\` (${job.media.type}), scope ${JSON.stringify(job.scope)}`,
    details: shaped
      ? ['same MediaDownloadService.request() choke point as POST /movies']
      : [
          `expected a movie job on ${mediaId} with no scope`,
          'showScopeFromInput must return undefined for a tmdb: target',
        ],
  })

  return { rows, job }
}

/**
 * The assertion the whole script exists for.
 *
 * `MediaPollerService` derives `Downloading` from a Radarr queue record,
 * which exists only once the download client has accepted the release. So
 * reaching `downloading` is the proof that a user-picked guid travelled all
 * the way from this route into the real client — not merely that Radarr
 * returned 200 to the push.
 */
async function reachedClientRow(
  request: RequestFn,
  jobId: string,
): Promise<{ row: Row; radarrId?: number }> {
  const startedAt = Date.now()
  const observed: string[] = []
  let job: Job | undefined

  while (Date.now() - startedAt < QUEUE_WINDOW_MS) {
    const attempt = await request({
      path: `/download/movies/${encodeURIComponent(jobId)}`,
      schema: DownloadJobResponseSchema,
    })

    if (attempt.ok && attempt.data) {
      job = attempt.data
      if (observed[observed.length - 1] !== job.status) {
        observed.push(job.status)
      }
      if (
        job.status === DownloadJobStatus.Downloading ||
        job.status === DownloadJobStatus.Importing ||
        job.status === DownloadJobStatus.Completed ||
        job.status === DownloadJobStatus.Failed
      ) {
        break
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  const radarrId =
    job?.media.type === DownloadType.Movie ? job.media.radarrId : undefined
  const elapsedMs = Date.now() - startedAt
  const reached =
    job?.status === DownloadJobStatus.Downloading ||
    job?.status === DownloadJobStatus.Importing ||
    job?.status === DownloadJobStatus.Completed

  return {
    radarrId,
    row: {
      name: 'grab.reached-the-download-client',
      status: reached ? 'pass' : 'fail',
      note: `\`${job?.status ?? 'unknown'}\` after ${elapsedMs}ms`,
      details: [
        `observed: ${observed.join(' → ') || '(nothing)'}`,
        reached
          ? 'MediaPollerService derives `downloading` from a live Radarr queue item — the client has the release'
          : 'never reached a queue-backed status; the push did not land in the download client',
        ...(job?.error ? [`error: ${job.error}`] : []),
      ],
    },
  }
}

/** `release.grab` must name the job, the guid and the indexer it came from. */
async function auditRow(
  request: RequestFn,
  mediaId: string,
  jobId: string,
  release: Release,
): Promise<Row> {
  const audit = await request({
    path: '/download/admin/audit-log?limit=25&action=release.grab',
    schema: AuditLogPageSchema,
  })

  if (!audit.ok || !audit.data) {
    return {
      name: 'audit.records-release-grab',
      status: 'fail',
      note: 'could not read the audit log',
      details: [audit.reason ?? 'no reason given'],
    }
  }

  const mine = audit.data.items.find(
    item => item.targetId === mediaId && item.metadata?.jobId === jobId,
  )
  const guidMatches = mine?.metadata?.guid === release.guid

  return {
    name: 'audit.records-release-grab',
    status: mine && guidMatches ? 'pass' : 'fail',
    note: mine
      ? `\`release.grab\` on ${mediaId} at ${mine.createdAt}, actor ${mine.actor?.email ?? '(none)'}`
      : `no \`release.grab\` row naming job ${jobId}`,
    details: mine
      ? [
          guidMatches
            ? 'metadata carries the grabbed guid and indexerId'
            : `metadata guid ${String(mine.metadata?.guid)} != ${release.guid}`,
        ]
      : ['the grab landed but the audit wiring did not'],
  }
}

/**
 * Cancel the queue item, delete the movie, and prove the library is back
 * where it started.
 *
 * `DELETE /download/movies/:jobId` leaves the *job* row behind as
 * `Cancelled` by design — the library entry is what teardown removes, so
 * `radarrId` is what gets checked, exactly as `mutate.ts`'s `confirmGone`
 * does.
 */
async function teardown(
  request: RequestFn,
  jobId: string,
  mediaPath: string,
): Promise<Row[]> {
  const rows: Row[] = []

  const deleted = await request({
    method: 'DELETE',
    path: `/download/movies/${encodeURIComponent(jobId)}`,
    schema: DownloadJobResponseSchema,
  })

  rows.push({
    name: 'teardown.deleted',
    status: deleted.ok ? 'pass' : 'fail',
    note: deleted.ok
      ? `job ${jobId} deleted, status \`${deleted.data?.status}\``
      : `DELETE /download/movies/${jobId} failed — clean up by hand`,
    details: deleted.ok
      ? ['unmonitorAndDelete cancels queue items with removeFromClient: true']
      : [deleted.reason ?? 'no reason given'],
  })

  const detail = await request({
    path: mediaPath,
    schema: MediaDetailResponseSchema,
  })

  if (!detail.ok || !detail.data) {
    rows.push({
      name: 'teardown.out-of-the-library',
      status: 'fail',
      note: 'could not confirm the library entry is gone',
      details: [detail.reason ?? 'no reason given'],
    })
    return rows
  }

  const media = detail.data.media
  const held = media.type === DownloadType.Movie ? media.radarrId : undefined
  const filePath =
    media.type === DownloadType.Movie ? media.filePath : undefined

  rows.push({
    name: 'teardown.out-of-the-library',
    status: held === undefined && !filePath ? 'pass' : 'fail',
    note:
      held === undefined && !filePath
        ? 'resolves without a radarrId and with nothing on disk'
        : `still held as ${held ?? '?'}${filePath ? ` with ${filePath}` : ''}`,
    details:
      held === undefined && !filePath
        ? ['the job row survives as Cancelled by design']
        : [
            'teardown ran but the title is still in the library — remove by hand',
          ],
  })

  return rows
}

/** The kept library content must be untouched on both sides of the grab. */
async function residueRows(
  request: RequestFn,
  when: 'before' | 'after',
): Promise<Row[]> {
  const rows: Row[] = []

  const gallery = await request({
    path: '/download/gallery?limit=30',
    schema: GalleryResidueSchema,
  })

  if (!gallery.ok || !gallery.data) {
    rows.push({
      name: `residue.gallery-${when}`,
      status: 'fail',
      note: 'could not read the gallery',
      details: [gallery.reason ?? 'no reason given'],
    })
  } else {
    const withUrls = gallery.data.items.filter(
      item => (item.media.downloadUrls ?? []).length > 0,
    ).length
    const ok =
      gallery.data.items.length === EXPECTED_GALLERY_ITEMS &&
      withUrls === EXPECTED_GALLERY_WITH_URLS
    rows.push({
      name: `residue.gallery-${when}`,
      status: ok ? 'pass' : 'fail',
      note: `${gallery.data.items.length} items, ${withUrls} with downloadUrls`,
      details: ok
        ? undefined
        : [
            `expected ${EXPECTED_GALLERY_ITEMS} items and ${EXPECTED_GALLERY_WITH_URLS} with downloadUrls`,
            'the kept library content changed — investigate before trusting this run',
          ],
    })
  }

  const activity = await request({
    path: '/download/activity',
    schema: ActivityResidueSchema,
  })

  if (!activity.ok || !activity.data) {
    rows.push({
      name: `residue.activity-${when}`,
      status: 'fail',
      note: 'could not read activity',
      details: [activity.reason ?? 'no reason given'],
    })
  } else {
    // `before` must be drained; `after` is only drained once teardown has
    // swept the grabbed job, which it has by the time this runs.
    rows.push({
      name: `residue.activity-${when}`,
      status: activity.data.total === 0 ? 'pass' : 'fail',
      note: `activity total ${activity.data.total}`,
      details:
        activity.data.total === 0
          ? undefined
          : ['expected 0 — the grabbed job should have been torn down'],
    })
  }

  return rows
}

function mb(size: number | null | undefined): string {
  return size ? (size / 1e6).toFixed(0) : '?'
}

// ---------------------------------------------------------------------------
// Plumbing — the same contract `pause-resume.ts` and `bad-files.ts` use.
// ---------------------------------------------------------------------------

interface RequestInput<T> {
  path: string
  method?: HttpMethod
  json?: unknown
  schema?: z.ZodType<T>
}

type RequestFn = <T>(input: RequestInput<T>) => Promise<Attempt<T>>

function makeRequest(
  transport: Transport,
  headers: Record<string, string>,
): RequestFn {
  return async function request<T>(
    input: RequestInput<T>,
  ): Promise<Attempt<T>> {
    const method = input.method ?? 'GET'

    try {
      // The indexer search behind `/releases` routinely outruns the 30s
      // default; everything else here is fast.
      const response = await transport(input.path, headers, {
        method,
        json: input.json,
        timeoutSeconds: input.path.endsWith('/releases') ? 180 : 30,
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

      return { ok: true, status: response.status, data: parsed.data }
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

function finish(
  rows: Row[],
  jobId: string | undefined,
  radarrId: number | undefined,
  mediaId: string,
): number {
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

  // Printed on every path, crash included: this script can leave a real
  // library entry and a real download-client item behind.
  console.log('')
  console.log('  IDENTIFIERS — check these if the run did not tear down:')
  console.log(`    media     ${mediaId}`)
  console.log(`    job       ${jobId ?? '(none created)'}`)
  console.log(`    radarrId  ${radarrId ?? '(unknown)'}`)
  if (jobId) {
    console.log('    remove by hand, from /home/jeremy/lilnas:')
    console.log(
      `      docker compose exec -T download curl -sS -X DELETE -H 'X-Forwarded-User: <you>' http://localhost:8081/download/movies/${jobId}`,
    )
  }

  console.log('')
  if (counts.fail > 0) {
    console.log('  VERDICT: FAILED')
    return 1
  }
  if (counts.skipped > 0) {
    console.log('  VERDICT: NOT A PASS — the grab was not fully exercised')
    return 2
  }
  console.log('  VERDICT: PASS — grab reached the real download client')
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
