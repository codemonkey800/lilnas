/**
 * Live verification for `POST /download/media/:id/releases/replace` — the
 * last of the five write routes the plan-009 sweep left untouched, and the
 * only destructive one.
 *
 * ### Why this script seeds its own target instead of picking one
 *
 * `replaceRelease()` runs `deleteExistingFiles()` in its `prepare` step,
 * **before** the grab. The controller's docblock frames the atomicity as the
 * point — "so the user can't be left with a deleted file and no replacement"
 * — which is exactly the state a careless test gambles with. And the library
 * on this host is not a fixture: it is ~288 real movies someone owns. There
 * is no title in it that "nobody minds losing".
 *
 * So the target is **manufactured**: the script grabs a small release, waits
 * for Radarr to import it into a real file on disk, and only then replaces
 * that. The file it destroys is one it created minutes earlier, which is the
 * only way to exercise `deleteExistingFiles` for real without gambling with
 * someone's copy.
 *
 * The consequence worth stating plainly: this script is **long**. Seeding
 * means waiting on a real usenet download and a real Radarr import, so
 * {@link SEED_WINDOW_MS} is generous and a run that outlives it reports an
 * honest skip rather than pretending the route was covered.
 *
 * ### Seeding can fail for reasons that have nothing to do with this app
 *
 * It did, twice, on 2026-08-30. Two different releases for the same title
 * downloaded to completion in SABnzbd and were then refused by **Radarr's**
 * import matcher with `Movie […] was not found in the grabbed release` —
 * once for a `.partNN` split archive (now filtered, see
 * {@link SPLIT_ARCHIVE}) and once for a plain single-file `.avi` sitting
 * correctly named in the completed folder. That is Radarr's release-to-movie
 * matching, not a defect in the route under test, but the effect is the
 * same: no disposable file, so nothing to delete.
 *
 * A failed seed is therefore **not fatal**. `replaceRelease` documents
 * deleting zero files as legal — "nothing to replace just means this is a
 * plain grab" — so the run continues down that path and everything except
 * the deletion is still asserted. `replace.deleted-the-existing-file` then
 * reports **skipped**, which keeps the verdict at `NOT A PASS`. `--no-seed`
 * takes that path deliberately and in seconds rather than minutes.
 *
 * ### What proves the delete actually happened
 *
 * `prepare` runs *inside* the request, so by the time the 201 lands the
 * delete is already done — no polling race. `filePath` is present before the
 * call and absent immediately after it, and `MediaResolverService.invalidate`
 * is what makes that read the post-delete truth rather than a cached copy.
 * A `deletedCount` never reaches the wire (it is only logged), so `filePath`
 * is the observable.
 *
 * ### Order of operations
 *
 * The missing-`indexerId` 400 is asserted before anything is even seeded: a
 * body the pipe rejects must never reach `prepare`, and a 400 that deleted a
 * file first would be the worst failure this route has. The flagged-release
 * 409 comes after the seed instead, because it is only a real assertion once
 * there is a file it could have destroyed — see {@link refusalRow} for why
 * that file is a manufactured one and not the kept _Following_.
 *
 * Usage:
 *
 * ```bash
 * pnpm exec tsx scripts/verify/bad-files.ts --repo-path /home/jeremy/lilnas
 * pnpm exec tsx scripts/verify/replace.ts  --repo-path /home/jeremy/lilnas
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

/** Same throwaway title `grab.ts` uses, and for the same reasons. */
const DEFAULT_TMDB_ID = 10331

/**
 * One half of a split archive. Radarr accepts the grab and the download
 * client finishes it, but the import is then blocked with "was not found in
 * the grabbed release" and no file ever reaches disk.
 *
 * Found the hard way: the first run of this script picked
 * `…3X-audio Remastered x264 aac.part01` as the smallest acceptable release
 * and sat in `importBlocked` until the seed window expired. Smallest-first
 * is the right cost strategy, but "smallest" and "importable" are not the
 * same property, and only the seed needs the second one.
 */
const SPLIT_ARCHIVE = /\.part\d+\b/i

/**
 * The same guid `bad-files.ts` uses, deliberately: it is not a valid indexer
 * guid, it is idempotent on `(media_id, release_guid)`, and one cleanup
 * (`DELETE FROM bad_files WHERE release_guid LIKE 'lilnas-verify:bad-file:%'`)
 * covers every flag either script writes.
 */
const FLAGGED_GUID = 'lilnas-verify:bad-file:synthetic-guid-v1'

/**
 * Ceiling on "grab a release and have Radarr import it to disk". This is a
 * real usenet download plus a real import, so it is minutes, not seconds.
 */
const SEED_WINDOW_MS = 25 * 60_000

/** Ceiling on the replacement grab reaching a queue-backed status. */
const QUEUE_WINDOW_MS = 150_000

const POLL_INTERVAL_MS = 5_000

/** Expected residue baseline, asserted before and after. */
const EXPECTED_GALLERY_ITEMS = 15
const EXPECTED_GALLERY_WITH_URLS = 12

const DEFAULT_FIXTURES_FILE = path.join(__dirname, 'fixtures.json')

const REPLACE_USER_ID = 'verify-replace'

const FixturesSchema = z.object({ adminEmail: z.string().email() })

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
    'X-Forwarded-User-Id': REPLACE_USER_ID,
  })

  const tmdbId = Number(args.get('tmdb-id') ?? DEFAULT_TMDB_ID)
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new Error(`--tmdb-id must be a positive integer, got '${tmdbId}'`)
  }
  const mediaId = `tmdb:${tmdbId}`
  const mediaPath = `/download/media/${encodeURIComponent(mediaId)}`

  console.log('Download backend — releases/replace verification')
  console.log(
    `  target    ${repoPath ? `docker compose exec in ${repoPath}` : baseUrl}`,
  )
  console.log(`  media     ${mediaId}`)
  console.log(
    args.has('no-seed')
      ? '  note      --no-seed: zero-file path only; the delete half will SKIP'
      : `  note      seeds its own file first; budget up to ${SEED_WINDOW_MS / 60_000} minutes`,
  )
  console.log('')

  const rows: Row[] = []
  const jobIds: string[] = []

  try {
    rows.push(...(await residueRows(request, 'before')))

    const preflight = await preflightRow(request, mediaPath)
    rows.push(preflight)
    if (preflight.status !== 'pass') {
      return finish(rows, jobIds, mediaId)
    }

    const picked = await pickRows(request, mediaPath)
    rows.push(...picked.rows)
    if (!picked.seed || !picked.replacement) {
      return finish(rows, jobIds, mediaId)
    }

    // Cheap and non-destructive, so it happens before anything is deleted.
    rows.push(await validationRow(request, mediaPath, picked.seed))

    // A failed seed is deliberately **not** fatal. `replaceRelease`'s own
    // docblock says deleting zero files is not an error — "nothing to replace
    // just means this is a plain grab" — so the route still has a documented
    // path to exercise without a file. What is lost is the delete half, and
    // `replaceRows` marks that as a skip rather than quietly passing.
    const seeded = args.has('no-seed')
      ? { filePath: undefined, rows: [noSeedRow()] }
      : await seedRows(request, mediaPath, picked.seed, jobIds)
    rows.push(...seeded.rows)

    // Non-destructive, and it needs the seeded file to be meaningful — so it
    // sits between the seed and the replace rather than at the top.
    rows.push(await refusalRow(request, mediaId, mediaPath, seeded.filePath))

    rows.push(
      ...(await replaceRows(
        request,
        mediaId,
        mediaPath,
        picked.replacement,
        seeded.filePath,
        jobIds,
      )),
    )
  } catch (error) {
    rows.push({
      name: 'unexpected',
      status: 'fail',
      note: 'threw outside the assertion path',
      details: [describe(error)],
    })
  } finally {
    if (!args.has('keep')) {
      rows.push(...(await teardown(request, jobIds, mediaPath)))
    } else {
      rows.push({
        name: 'teardown',
        status: 'skipped',
        note: `--keep passed; ${mediaId} and jobs ${jobIds.join(', ')} left in place`,
      })
    }
    rows.push(...(await residueRows(request, 'after')))
  }

  return finish(rows, jobIds, mediaId)
}

/**
 * A flagged release must be refused by `replace` exactly as by `grab` — and
 * refused **before** `prepare`, so the refusal cannot delete a file first.
 *
 * That is the sharpest assertion in this script, and also the one it would be
 * easiest to make dangerously. The obvious target is the kept _Following_,
 * which already carries `bad-files.ts`'s synthetic flag — but pointing
 * `replace` at a real Criterion remux to find out whether `assertNotFlagged`
 * fires is exactly the gamble this whole script is built to avoid. If the
 * guard were broken, the cost of learning that would be someone's copy.
 *
 * So the check runs against the **manufactured** title, after it has been
 * seeded with a file this script created. A fresh synthetic flag is written
 * here (idempotent, and covered by the same cleanup as `bad-files.ts`'s), the
 * replace is refused, and the seeded file is still on disk afterwards. Same
 * claim, and the worst case is losing a file we made ten minutes ago.
 */
async function refusalRow(
  request: RequestFn,
  mediaId: string,
  mediaPath: string,
  seededFilePath: string | undefined,
): Promise<Row> {
  const name = 'replace.refuses-a-flagged-release'

  const flagged = await request({
    method: 'POST',
    path: `${mediaPath}/bad-files`,
    json: {
      guid: FLAGGED_GUID,
      reason: 'synthetic flag from replace.ts — proves the pre-prepare refusal',
      title: 'SYNTHETIC — lilnas verification flag, not a release',
    },
  })

  if (!flagged.ok) {
    return {
      name,
      status: 'skipped',
      note: `could not flag a synthetic guid on ${mediaId}`,
      details: [flagged.reason ?? 'no reason given'],
    }
  }

  const refused = await request({
    method: 'POST',
    path: `${mediaPath}/releases/replace`,
    json: { guid: FLAGGED_GUID, indexerId: 0 },
  })

  const after = await request({
    path: mediaPath,
    schema: MediaDetailResponseSchema,
  })
  const fileAfter =
    after.data?.media.type === DownloadType.Movie
      ? after.data.media.filePath
      : undefined

  const intact = fileAfter === seededFilePath
  const ok = refused.status === 409 && intact

  return {
    name,
    status: ok ? 'pass' : 'fail',
    note: seededFilePath
      ? `flagged replace answered HTTP ${refused.status ?? 'nothing'}; seeded file ${intact ? 'untouched' : 'CHANGED'}`
      : `flagged replace answered HTTP ${refused.status ?? 'nothing'} (no file to protect)`,
    details: ok
      ? [
          'assertNotFlagged precedes prepare — a refusal cannot delete a file first',
          seededFilePath
            ? `still on disk: ${fileAfter}`
            : 'with no seeded file this proves the 409 but not the ordering',
        ]
      : [
          seededFilePath
            ? 'expected 409 with the seeded file untouched'
            : 'expected 409',
          `before: ${seededFilePath ?? '(none)'}`,
          `after:  ${fileAfter ?? '(none)'}`,
          refused.reason ?? '',
        ].filter(Boolean),
  }
}

/** Stands in for the seed rows when `--no-seed` skips that phase outright. */
function noSeedRow(): Row {
  return {
    name: 'seed.imported-a-real-file',
    status: 'skipped',
    note: '--no-seed: no disposable file was manufactured',
    details: [
      'the delete half of this route is therefore NOT exercised — see',
      '`replace.deleted-the-existing-file`',
    ],
  }
}

/**
 * Refuses to run against a title Radarr already holds — the same guard
 * `grab.ts` has, and non-negotiable here. There is no `--force`: this route
 * deletes files, and a flag that lets someone point it at a real title is a
 * footgun with no legitimate use in a verification script.
 */
async function preflightRow(
  request: RequestFn,
  mediaPath: string,
): Promise<Row> {
  const detail = await request({
    path: mediaPath,
    schema: MediaDetailResponseSchema,
  })

  if (!detail.ok || !detail.data) {
    return {
      name: 'preflight.not-in-library',
      status: 'fail',
      note: 'could not resolve the target title',
      details: [detail.reason ?? 'no reason given'],
    }
  }

  const media = detail.data.media
  const held = media.type === DownloadType.Movie ? media.radarrId : undefined

  if (held !== undefined) {
    return {
      name: 'preflight.not-in-library',
      status: 'skipped',
      note: `Radarr already holds '${media.title}' as ${held} — refusing to run`,
      details: [
        'this script deletes the file it finds. It will only do that to a file',
        'it created itself, so the target must not be in the library first.',
        'Pick another --tmdb-id.',
      ],
    }
  }

  return {
    name: 'preflight.not-in-library',
    status: 'pass',
    note: `'${media.title}' is known but not held — safe to seed and destroy`,
  }
}

/**
 * Two distinct releases: the smallest to seed with, the next smallest to
 * replace it with.
 *
 * They must differ, or the replace would delete a file and re-grab the
 * identical release, which tests nothing about the "swap what's on disk"
 * behaviour and would very likely be rejected as a non-upgrade.
 */
async function pickRows(
  request: RequestFn,
  mediaPath: string,
): Promise<{ rows: Row[]; seed?: Release; replacement?: Release }> {
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

  const eligible = listed.data.releases
    .filter(
      r =>
        !r.rejected &&
        r.downloadAllowed !== false &&
        r.size &&
        !SPLIT_ARCHIVE.test(r.title ?? ''),
    )
    .sort((a, b) => (a.size ?? 0) - (b.size ?? 0))

  rows.push({
    name: 'releases.listed',
    status: eligible.length >= 2 ? 'pass' : 'fail',
    note: `${eligible.length} acceptable of ${listed.data.releases.length} release(s)`,
    details:
      eligible.length >= 2
        ? undefined
        : ['need two distinct acceptable releases to seed and then replace'],
  })

  if (eligible.length < 2) {
    return { rows }
  }

  const [seed, replacement] = eligible
  rows.push({
    name: 'releases.picked-two',
    status: 'pass',
    note: `seed ${mb(seed.size)} MB → replacement ${mb(replacement.size)} MB`,
    details: [
      `seed        ${seed.title?.slice(0, 60) ?? seed.guid}`,
      `replacement ${replacement.title?.slice(0, 60) ?? replacement.guid}`,
    ],
  })

  return { rows, seed, replacement }
}

/**
 * `indexerId` is required on a replace exactly as on a grab
 * (`ReplaceReleaseInputSchema` is an alias of `GrabReleaseInputSchema`).
 * Asserted before anything is seeded, because a body rejected by the pipe
 * must never reach `prepare` — a 400 that deleted a file first would be the
 * worst possible failure of this route.
 */
async function validationRow(
  request: RequestFn,
  mediaPath: string,
  release: Release,
): Promise<Row> {
  const bad = await request({
    method: 'POST',
    path: `${mediaPath}/releases/replace`,
    json: { guid: release.guid },
  })

  return {
    name: 'validation.rejects-missing-indexerId',
    status: bad.status === 400 ? 'pass' : 'fail',
    note: `a replace with no indexerId answered HTTP ${bad.status ?? 'nothing'}`,
    details:
      bad.status === 400
        ? ['rejected by the pipe — prepare never ran, nothing was deleted']
        : [
            'expected 400; a malformed replace must not reach deleteExistingFiles',
            bad.reason ?? '',
          ].filter(Boolean),
  }
}

/**
 * Manufactures the file this script is allowed to destroy: grab, then wait
 * for Radarr to import it to disk.
 *
 * `filePath` appearing is the completion signal, not the job status — the job
 * can report `completed` on the queue's say-so slightly before the import has
 * landed, and it is the file on disk that `deleteExistingFiles` will act on.
 */
async function seedRows(
  request: RequestFn,
  mediaPath: string,
  seed: Release,
  jobIds: string[],
): Promise<{ rows: Row[]; filePath?: string }> {
  const rows: Row[] = []

  const grabbed = await request({
    method: 'POST',
    path: `${mediaPath}/releases/grab`,
    json: { guid: seed.guid, indexerId: seed.indexerId },
    schema: DownloadJobResponseSchema,
  })

  if (!grabbed.ok || !grabbed.data) {
    rows.push({
      name: 'seed.grabbed',
      status: 'fail',
      note: 'could not seed a file to replace',
      details: [grabbed.reason ?? 'no reason given'],
    })
    return { rows }
  }

  jobIds.push(grabbed.data.id)
  rows.push({
    name: 'seed.grabbed',
    status: 'pass',
    note: `job ${grabbed.data.id} grabbing ${mb(seed.size)} MB`,
  })

  const startedAt = Date.now()
  let filePath: string | undefined
  const observed: string[] = []

  while (Date.now() - startedAt < SEED_WINDOW_MS) {
    const detail = await request({
      path: mediaPath,
      schema: MediaDetailResponseSchema,
    })
    if (
      detail.ok &&
      detail.data?.media.type === DownloadType.Movie &&
      detail.data.media.filePath
    ) {
      filePath = detail.data.media.filePath
      break
    }

    const job = await request({
      path: `/download/movies/${encodeURIComponent(grabbed.data.id)}`,
      schema: DownloadJobResponseSchema,
    })
    if (job.ok && job.data) {
      if (observed[observed.length - 1] !== job.data.status) {
        observed.push(job.data.status)
      }
      if (
        job.data.status === DownloadJobStatus.Failed ||
        job.data.status === DownloadJobStatus.Cancelled
      ) {
        break
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  const elapsedMs = Date.now() - startedAt

  rows.push({
    name: 'seed.imported-a-real-file',
    status: filePath ? 'pass' : 'skipped',
    note: filePath
      ? `on disk after ${Math.round(elapsedMs / 1000)}s: ${filePath}`
      : `no file on disk after ${Math.round(elapsedMs / 1000)}s — cannot exercise the delete`,
    details: filePath
      ? ['this is the file the replace is allowed to destroy']
      : [
          `observed: ${observed.join(' → ') || '(nothing)'}`,
          'the replace half is NOT a skip of convenience — without a file,',
          'deleteExistingFiles has nothing to delete and would be a plain grab.',
          'Retry, or raise SEED_WINDOW_MS.',
        ],
  })

  return { rows, filePath }
}

/** The destructive call, and the proof the delete-then-grab really happened. */
async function replaceRows(
  request: RequestFn,
  mediaId: string,
  mediaPath: string,
  replacement: Release,
  seededFilePath: string | undefined,
  jobIds: string[],
): Promise<Row[]> {
  const rows: Row[] = []

  const replaced = await request({
    method: 'POST',
    path: `${mediaPath}/releases/replace`,
    json: { guid: replacement.guid, indexerId: replacement.indexerId },
    schema: DownloadJobResponseSchema,
  })

  if (!replaced.ok || !replaced.data) {
    rows.push({
      name: 'replace.accepted',
      status: 'fail',
      note: 'POST /media/:id/releases/replace failed',
      details: [
        replaced.reason ?? 'no reason given',
        seededFilePath
          ? `the seeded file may already be deleted: ${seededFilePath}`
          : 'no file was seeded, so nothing was at risk',
      ],
    })
    return rows
  }

  jobIds.push(replaced.data.id)
  rows.push({
    name: 'replace.accepted',
    status: 'pass',
    note: `HTTP ${replaced.status}, job ${replaced.data.id} as \`${replaced.data.status}\``,
    details: [
      seededFilePath
        ? `replacing ${seededFilePath}`
        : 'no existing file — the documented zero-delete path',
    ],
  })

  // `prepare` runs inside the request, so this is a settled fact by now —
  // deliberately not polled, because a poll would turn a synchronous
  // guarantee into a timing question.
  const detail = await request({
    path: mediaPath,
    schema: MediaDetailResponseSchema,
  })
  const filePathNow =
    detail.data?.media.type === DownloadType.Movie
      ? detail.data.media.filePath
      : undefined

  // Without a seeded file there is nothing for `deleteExistingFiles` to
  // delete, so this reports a skip. That is the honest outcome: `prepare`
  // ran and returned zero, which the service documents as legal, but zero
  // deletions is not evidence that a real deletion works.
  if (seededFilePath === undefined) {
    rows.push({
      name: 'replace.deleted-the-existing-file',
      status: 'skipped',
      note: 'no file existed, so the delete half was not exercised',
      details: [
        "prepare ran and deleted zero files — legal per replaceRelease's own",
        'docblock ("nothing to replace just means this is a plain grab"), but',
        'it does not prove deleteExistingFiles removes a real file.',
        'This is the one claim this script could not make; see the status doc.',
      ],
    })
  } else {
    rows.push({
      name: 'replace.deleted-the-existing-file',
      status: filePathNow === undefined ? 'pass' : 'fail',
      note:
        filePathNow === undefined
          ? 'the seeded file is gone, read straight after the 201'
          : `still reports ${filePathNow}`,
      details:
        filePathNow === undefined
          ? [
              `was ${seededFilePath}`,
              'deleteExistingFiles ran in prepare, and invalidate() is why this',
              'read sees the post-delete truth rather than a cached entry',
            ]
          : [
              'prepare should have deleted the file before grabbing',
              'a stale read here would mean invalidate() is not doing its job',
            ],
    })
  }

  // Same claim `grab.ts` makes, and the other half of the atomicity: the
  // delete is only acceptable because a replacement really was pushed.
  const reached = await reachedClientRow(request, replaced.data.id)
  rows.push(reached)

  rows.push(await auditRow(request, mediaId, replaced.data.id, replacement))

  return rows
}

/** Waits for a queue-backed status — the download client has the release. */
async function reachedClientRow(
  request: RequestFn,
  jobId: string,
): Promise<Row> {
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

  const reached =
    job?.status === DownloadJobStatus.Downloading ||
    job?.status === DownloadJobStatus.Importing ||
    job?.status === DownloadJobStatus.Completed

  return {
    name: 'replace.replacement-reached-the-download-client',
    status: reached ? 'pass' : 'fail',
    note: `\`${job?.status ?? 'unknown'}\` after ${Date.now() - startedAt}ms`,
    details: [
      `observed: ${observed.join(' → ') || '(nothing)'}`,
      reached
        ? 'the delete was not left dangling — a replacement really is coming'
        : 'the file was deleted and no replacement reached the client — the exact state this route exists to prevent',
      ...(job?.error ? [`error: ${job.error}`] : []),
    ],
  }
}

/** `release.replace`, not `release.grab` — the two must not be conflated. */
async function auditRow(
  request: RequestFn,
  mediaId: string,
  jobId: string,
  release: Release,
): Promise<Row> {
  const audit = await request({
    path: '/download/admin/audit-log?limit=25&action=release.replace',
    schema: AuditLogPageSchema,
  })

  if (!audit.ok || !audit.data) {
    return {
      name: 'audit.records-release-replace',
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
    name: 'audit.records-release-replace',
    status: mine && guidMatches ? 'pass' : 'fail',
    note: mine
      ? `\`release.replace\` on ${mediaId} at ${mine.createdAt}, actor ${mine.actor?.email ?? '(none)'}`
      : `no \`release.replace\` row naming job ${jobId}`,
    details: mine
      ? [
          guidMatches
            ? 'metadata carries the replacement guid and indexerId'
            : `metadata guid ${String(mine.metadata?.guid)} != ${release.guid}`,
        ]
      : ['the replace landed but the audit wiring did not'],
  }
}

/**
 * Removes the manufactured title entirely — queue items, library entry and
 * whatever landed on disk.
 *
 * Every job minted against the title is deleted, because a run can create two
 * (the seed and the replacement) and either one's teardown removes the movie.
 * The second delete is expected to be a no-op and is not failed for it.
 */
async function teardown(
  request: RequestFn,
  jobIds: string[],
  mediaPath: string,
): Promise<Row[]> {
  const rows: Row[] = []

  if (jobIds.length === 0) {
    rows.push({
      name: 'teardown',
      status: 'pass',
      note: 'nothing was created',
    })
    return rows
  }

  const outcomes: string[] = []
  for (const jobId of jobIds) {
    const deleted = await request({
      method: 'DELETE',
      path: `/download/movies/${encodeURIComponent(jobId)}`,
      schema: DownloadJobResponseSchema,
    })
    outcomes.push(
      `${jobId}: ${deleted.ok ? (deleted.data?.status ?? 'deleted') : `HTTP ${deleted.status ?? 'error'}`}`,
    )
  }

  const detail = await request({
    path: mediaPath,
    schema: MediaDetailResponseSchema,
  })

  if (!detail.ok || !detail.data) {
    rows.push({
      name: 'teardown.out-of-the-library',
      status: 'fail',
      note: 'could not confirm the library entry is gone',
      details: [...outcomes, detail.reason ?? 'no reason given'],
    })
    return rows
  }

  const media = detail.data.media
  const held = media.type === DownloadType.Movie ? media.radarrId : undefined
  const filePath =
    media.type === DownloadType.Movie ? media.filePath : undefined
  const clean = held === undefined && !filePath

  rows.push({
    name: 'teardown.out-of-the-library',
    status: clean ? 'pass' : 'fail',
    note: clean
      ? 'resolves without a radarrId and with nothing on disk'
      : `still held as ${held ?? '?'}${filePath ? ` with ${filePath}` : ''}`,
    details: clean
      ? outcomes
      : [...outcomes, 'remove the title from Radarr by hand'],
  })

  return rows
}

/** The kept library content must be untouched on both sides. */
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
    rows.push({
      name: `residue.activity-${when}`,
      status: activity.data.total === 0 ? 'pass' : 'fail',
      note: `activity total ${activity.data.total}`,
      details:
        activity.data.total === 0
          ? undefined
          : ['expected 0 — every job this script minted should be torn down'],
    })
  }

  return rows
}

function mb(size: number | null | undefined): string {
  return size ? (size / 1e6).toFixed(0) : '?'
}

// ---------------------------------------------------------------------------
// Plumbing — the same contract `pause-resume.ts`, `bad-files.ts` and `grab.ts`
// use.
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
      // `/releases` fires a real indexer search, and a replace additionally
      // deletes every existing file *before* grabbing — both routinely
      // outrun the 30s default.
      const slow =
        input.path.endsWith('/releases') || input.path.endsWith('/replace')

      const response = await transport(input.path, headers, {
        method,
        json: input.json,
        timeoutSeconds: slow ? 180 : 30,
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

function finish(rows: Row[], jobIds: string[], mediaId: string): number {
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

  console.log('')
  console.log('  IDENTIFIERS — check these if the run did not tear down:')
  console.log(`    media  ${mediaId}`)
  console.log(`    jobs   ${jobIds.join(', ') || '(none created)'}`)
  for (const jobId of jobIds) {
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
    console.log('  VERDICT: NOT A PASS — replace was not fully exercised')
    return 2
  }
  console.log('  VERDICT: PASS — replace deleted and re-grabbed, verified live')
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
