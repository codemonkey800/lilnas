/**
 * Live verification for `POST /download/media/:id/bad-files` — the third of
 * the five write routes the plan-009 sweep left untouched, and the last cheap
 * one.
 *
 * ### Why this is cheap, despite the company it keeps
 *
 * It has been carried next to `releases/{grab,replace}` since the first sweep
 * and inherited their "expensive, needs its own session" caution by
 * association. Re-reading the code says otherwise:
 * `ReleaseService.flagBadFile()` is `insertBadFile(this.dbService.db, …)` and
 * a log line. No Radarr, no Sonarr, no indexer, no download client, no bytes.
 * It is a local SQLite insert behind a guard.
 *
 * ### The one real hazard, and how the target is chosen around it
 *
 * There is **no un-flag route.** `deleteBadFile()` exists
 * (`src/db/bad-files.repo.ts:91`) and nothing exposes it over HTTP, so a flag
 * written here is permanent short of editing SQLite. And a flag has teeth:
 * `assertNotFlagged` makes both `grabRelease` and `replaceRelease` refuse a
 * flagged release outright, with no override path.
 *
 * What that argues for is a careful **guid**, not a careful media id. The
 * refusal, the `flaggedBad` annotation and `MediaDownloadService`'s
 * auto-select exclusion are all keyed on `(mediaId, releaseGuid)`, so a guid
 * no indexer will ever mint cannot poison anything: no real release matches
 * it, so nothing real is ever refused or annotated. {@link SYNTHETIC_GUID} is
 * that guid.
 *
 * The media id is therefore free to be a **real, kept title** — and should
 * be, because that is what turns the read sweep's `media-bad-files` row from
 * a 200 over `[]` into real coverage of `BadFileSchema`. The sweep mines its
 * `tmdb:` keys from live routes and prefers library-backed ones, so flagging
 * against a synthetic `tmdb:999999999` would prove the route here and leave
 * that row exactly as vacuous as it was. Default target is
 * `tmdb:${fixtures.movie.tmdbId}` (_Following_), overridable with
 * `--media-id`.
 *
 * ### Idempotency is load-bearing for residue, not just for correctness
 *
 * {@link SYNTHETIC_GUID} is a constant rather than a per-run value on
 * purpose. `insertBadFile` is `onConflictDoNothing` on
 * `(media_id, release_guid)`, so every re-run of this script reads back the
 * same row instead of accumulating one per run. Residue is capped at exactly
 * one flag no matter how often this is run — which matters a great deal when
 * nothing can delete it.
 *
 * Usage:
 *
 * ```bash
 * pnpm exec tsx scripts/verify/bad-files.ts --repo-path /home/jeremy/lilnas
 * pnpm exec tsx scripts/verify/bad-files.ts --base-url http://localhost:8081
 * ```
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { BadFileSchema } from '../../../../packages/utils/src/download/schema'
import { AuditLogPageSchema, ListBadFilesResponseSchema } from './envelopes'
import {
  dockerExecTransport,
  type HttpMethod,
  httpTransport,
  isTransportError,
  type Transport,
} from './transport'

/**
 * The guid every flag this script writes carries.
 *
 * Deliberately not a valid indexer guid, and deliberately constant. Nothing
 * an indexer returns will ever equal it, so `assertNotFlagged` cannot refuse
 * a real grab and `annotateFlagged` cannot mislabel a real release — which is
 * the whole reason a real media id is safe to use as the target.
 */
const SYNTHETIC_GUID = 'lilnas-verify:bad-file:synthetic-guid-v1'

/** Denormalized copy, written so a human reading the DB knows what this is. */
const SYNTHETIC_TITLE = 'SYNTHETIC — lilnas verification flag, not a release'

const SYNTHETIC_REASON =
  'Written by apps/download/scripts/verify/bad-files.ts to prove POST /media/:id/bad-files against the live backend. Not a real indexer release; matches no grabbable guid.'

/**
 * `0` is a legal `indexerId` (`z.number().int().nonnegative()`) and no real
 * indexer carries it, so it doubles as a marker that the row is synthetic.
 */
const SYNTHETIC_INDEXER_ID = 0

/** `reason` is `z.string().max(500)` — this is one over. */
const OVERSIZED_REASON = 'x'.repeat(501)

/** Expected residue baseline, asserted before and after. See §4 of the doc. */
const EXPECTED_GALLERY_ITEMS = 15
const EXPECTED_GALLERY_WITH_URLS = 12

const DEFAULT_FIXTURES_FILE = path.join(__dirname, 'fixtures.json')

/** Attribution, and the identity the 401 check proves is required. */
const BAD_FILES_USER_ID = 'verify-bad-files'

const FixturesSchema = z.object({
  adminEmail: z.string().email(),
  movie: z.object({ tmdbId: z.number().int().positive() }),
})

/**
 * `FlagBadFileResponse` — `{ badFile }`. Declared here rather than in
 * `envelopes.ts`, which is scoped to the *read* surface; this is the only
 * write envelope any verification script parses.
 */
const FlagBadFileResponseSchema = z.strictObject({ badFile: BadFileSchema })

/**
 * Enough of `GalleryPage` to count residue without pulling in the whole
 * gallery item contract, which the read sweep already validates.
 */
const GalleryResidueSchema = z.object({
  items: z.array(
    z.object({
      media: z.object({ downloadUrls: z.array(z.string()).optional() }),
    }),
  ),
  total: z.number().int().nonnegative(),
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

type BadFile = z.infer<typeof BadFileSchema>

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

  const headers = {
    'X-Forwarded-User': fixtures.adminEmail,
    'X-Forwarded-User-Id': BAD_FILES_USER_ID,
  }
  const request = makeRequest(transport, headers)
  const anonRequest = makeRequest(transport, {})

  const mediaId = args.get('media-id') ?? `tmdb:${fixtures.movie.tmdbId}`
  if (!mediaId.startsWith('tmdb:') && !mediaId.startsWith('tvdb:')) {
    throw new Error(
      `--media-id must be a tmdb:/tvdb: key; '${mediaId}' is a guaranteed 404 from parseReleaseTarget`,
    )
  }
  const badFilesPath = `/download/media/${encodeURIComponent(mediaId)}/bad-files`

  console.log('Download backend — bad-files verification')
  console.log(
    `  target    ${repoPath ? `docker compose exec in ${repoPath}` : baseUrl}`,
  )
  console.log(`  media     ${mediaId}`)
  console.log(`  guid      ${SYNTHETIC_GUID}`)
  console.log('')

  const rows: Row[] = []
  let flagged: BadFile | undefined

  try {
    rows.push(...(await residueRows(request, 'before')))

    // Whether this run is the one that writes the row changes nothing about
    // the assertions, but it changes how to read `createdAt` — say so up
    // front rather than leaving a reader to wonder.
    const existing = await request({
      path: badFilesPath,
      schema: ListBadFilesResponseSchema,
    })
    const preexisting = existing.data?.badFiles.find(
      f => f.releaseGuid === SYNTHETIC_GUID,
    )
    rows.push({
      name: 'flag.prior-state',
      status: 'pass',
      note: preexisting
        ? `the synthetic flag already exists (id ${preexisting.id}, written ${preexisting.createdAt}) — this is a re-run`
        : 'no synthetic flag yet — this run writes it',
      details: [
        `${existing.data?.badFiles.length ?? 0} flag(s) currently on ${mediaId}`,
      ],
    })

    const guarded = await guardRows(anonRequest, request, badFilesPath, mediaId)
    rows.push(...guarded)

    const flagResult = await flagRows(
      request,
      badFilesPath,
      fixtures.adminEmail,
    )
    rows.push(...flagResult.rows)
    flagged = flagResult.flagged

    if (flagged) {
      rows.push(await listRow(request, badFilesPath, flagged))
      rows.push(await idempotencyRow(request, badFilesPath, flagged))
      rows.push(await auditRow(request, mediaId))
    }

    rows.push(...(await residueRows(request, 'after')))
  } catch (error) {
    rows.push({
      name: 'unexpected',
      status: 'fail',
      note: 'threw outside the assertion path',
      details: [describe(error)],
    })
  }

  return finish(rows, mediaId, flagged)
}

/**
 * The three ways this route is supposed to say no.
 *
 * The 401 is the one that distinguishes it from every other Phase 3 route:
 * `flagBadFile` is behind `ForwardedUserGuard`, not `@OptionalCurrentUser()`,
 * because a flag records a judgement *someone* made. Guards run before pipes,
 * so the anonymous call is refused whatever the body says — the body sent
 * here is a valid one precisely so a 401 cannot be a validation error wearing
 * the wrong status.
 */
async function guardRows(
  anonRequest: RequestFn,
  request: RequestFn,
  badFilesPath: string,
  mediaId: string,
): Promise<Row[]> {
  const rows: Row[] = []

  const anon = await anonRequest({
    method: 'POST',
    path: badFilesPath,
    json: { guid: `${SYNTHETIC_GUID}:anon-probe` },
  })
  rows.push({
    name: 'guard.anonymous-is-401',
    status: anon.status === 401 ? 'pass' : 'fail',
    note: `anonymous POST answered HTTP ${anon.status ?? 'nothing'}`,
    details:
      anon.status === 401
        ? ['ForwardedUserGuard — the only Phase 3 route that requires identity']
        : [
            'expected 401; anything else means an unattributable flag can be written',
            anon.reason ?? '',
          ].filter(Boolean),
  })

  // `FlagBadFileInputDto` gained a `ZodValidationPipe` during this exercise
  // (`guid: z.string().min(1)`), and an empty body is the cheapest proof it
  // is actually wired to the handler rather than merely declared.
  const empty = await request({ method: 'POST', path: badFilesPath, json: {} })
  rows.push({
    name: 'validation.rejects-missing-guid',
    status: empty.status === 400 ? 'pass' : 'fail',
    note: `POST {} answered HTTP ${empty.status ?? 'nothing'}`,
    details: empty.status === 400 ? undefined : ['expected 400 Bad Request'],
  })

  // A bound the schema states and nothing else enforces — if the pipe were
  // missing this would land a 501-character reason in the table.
  const oversized = await request({
    method: 'POST',
    path: badFilesPath,
    json: {
      guid: `${SYNTHETIC_GUID}:oversized-probe`,
      reason: OVERSIZED_REASON,
    },
  })
  rows.push({
    name: 'validation.rejects-oversized-reason',
    status: oversized.status === 400 ? 'pass' : 'fail',
    note: `a ${OVERSIZED_REASON.length}-char reason answered HTTP ${oversized.status ?? 'nothing'}`,
    details:
      oversized.status === 400
        ? ['`reason` is z.string().max(500)']
        : [
            'expected 400 — a rejected body must not reach insertBadFile',
            'if this wrote a row, remove it: guid ends `:oversized-probe`',
          ],
  })

  // `parseReleaseTarget` runs for its side effect before the table is
  // touched, so a `video:` key is a 404 rather than a row. Worth asserting
  // here because the `bad_files_media_id_matches_type` CHECK would otherwise
  // be the only thing standing between a video key and a corrupt row.
  const videoKey = await request({
    method: 'POST',
    path: '/download/media/video%3Anot-a-real-video/bad-files',
    json: { guid: `${SYNTHETIC_GUID}:video-probe` },
  })
  rows.push({
    name: 'target.rejects-video-key',
    status: videoKey.status === 404 ? 'pass' : 'fail',
    note: `a video: key answered HTTP ${videoKey.status ?? 'nothing'}`,
    details:
      videoKey.status === 404
        ? [`releases are a movie/show concept; the real target is ${mediaId}`]
        : ['expected 404 from parseReleaseTarget'],
  })

  return rows
}

/** The flag itself, and that the row it returns is the one that was asked for. */
async function flagRows(
  request: RequestFn,
  badFilesPath: string,
  adminEmail: string,
): Promise<{ rows: Row[]; flagged?: BadFile }> {
  const rows: Row[] = []

  const flagged = await request({
    method: 'POST',
    path: badFilesPath,
    json: {
      guid: SYNTHETIC_GUID,
      indexerId: SYNTHETIC_INDEXER_ID,
      reason: SYNTHETIC_REASON,
      title: SYNTHETIC_TITLE,
    },
    schema: FlagBadFileResponseSchema,
  })

  if (!flagged.ok || !flagged.data) {
    rows.push({
      name: 'flag.accepted',
      status: 'fail',
      note: 'POST /media/:id/bad-files failed',
      details: [flagged.reason ?? 'no reason given'],
    })
    return { rows }
  }

  rows.push({
    name: 'flag.accepted',
    status: flagged.status === 201 ? 'pass' : 'fail',
    note: `HTTP ${flagged.status}, flag id ${flagged.data.badFile.id}`,
    details:
      flagged.status === 201
        ? [
            'body parsed as FlagBadFileResponse — BadFileSchema, strict envelope',
          ]
        : ['expected 201 Created'],
  })

  const badFile = flagged.data.badFile
  const echoed: string[] = []
  if (badFile.releaseGuid !== SYNTHETIC_GUID) {
    echoed.push(`releaseGuid: ${badFile.releaseGuid}`)
  }
  if (badFile.releaseTitle !== SYNTHETIC_TITLE) {
    echoed.push(`releaseTitle: ${badFile.releaseTitle}`)
  }
  if (badFile.reason !== SYNTHETIC_REASON) {
    echoed.push(`reason: ${badFile.reason}`)
  }
  if (badFile.indexerId !== SYNTHETIC_INDEXER_ID) {
    echoed.push(`indexerId: ${badFile.indexerId}`)
  }

  rows.push({
    name: 'flag.round-trips-the-input',
    status: echoed.length === 0 ? 'pass' : 'fail',
    note:
      echoed.length === 0
        ? 'guid, title, reason and indexerId all came back as sent'
        : `${echoed.length} field(s) did not round-trip`,
    details: echoed.length === 0 ? undefined : echoed,
  })

  // The reason the route is guarded at all: the row has to name a human.
  // On a re-run this is the *first* flagger, which is the same identity, so
  // the assertion holds either way — see `insertBadFile`'s conflict path.
  const attributed =
    badFile.flaggedBy.email === adminEmail &&
    badFile.flaggedBy.userId === BAD_FILES_USER_ID
  rows.push({
    name: 'flag.attributed-to-the-forwarded-user',
    status: attributed ? 'pass' : 'fail',
    note: `flaggedBy ${badFile.flaggedBy.email} / ${badFile.flaggedBy.userId}`,
    details: attributed
      ? undefined
      : [`expected ${adminEmail} / ${BAD_FILES_USER_ID}`],
  })

  return { rows, flagged: badFile }
}

/**
 * The row this whole script exists to close.
 *
 * `media-bad-files` has passed every sweep over an empty list, because no bad
 * file had ever been flagged — a 200 that validated the envelope and nothing
 * inside it. This asserts the *element*: the flag comes back through
 * `listBadFilesByMediaId` → `toBadFile` identical to what `insertBadFile`
 * returned, parsed as `BadFileSchema`.
 */
async function listRow(
  request: RequestFn,
  badFilesPath: string,
  flagged: BadFile,
): Promise<Row> {
  const listed = await request({
    path: badFilesPath,
    schema: ListBadFilesResponseSchema,
  })

  if (!listed.ok || !listed.data) {
    return {
      name: 'list.returns-the-flag',
      status: 'fail',
      note: 'GET /media/:id/bad-files failed after the flag',
      details: [listed.reason ?? 'no reason given'],
    }
  }

  const found = listed.data.badFiles.find(f => f.id === flagged.id)
  if (!found) {
    return {
      name: 'list.returns-the-flag',
      status: 'fail',
      note: `flag ${flagged.id} is not in the ${listed.data.badFiles.length}-row listing`,
      details: ['the insert returned a row the read path cannot see'],
    }
  }

  const drift = Object.keys(flagged).filter(
    key =>
      JSON.stringify(found[key as keyof BadFile]) !==
      JSON.stringify(flagged[key as keyof BadFile]),
  )

  return {
    name: 'list.returns-the-flag',
    status: drift.length === 0 ? 'pass' : 'fail',
    note:
      drift.length === 0
        ? `flag ${flagged.id} listed identically to the insert, as BadFileSchema`
        : `${drift.length} field(s) differ between the insert and the listing`,
    details:
      drift.length === 0
        ? [
            `${listed.data.badFiles.length} flag(s) on this title — media-bad-files is no longer a 200 over []`,
            `createdAt ${found.createdAt}, flaggedBy ${found.flaggedBy.email}`,
          ]
        : drift.map(
            key =>
              `${key}: insert ${JSON.stringify(flagged[key as keyof BadFile])} vs list ${JSON.stringify(found[key as keyof BadFile])}`,
          ),
  }
}

/**
 * Re-flagging is `onConflictDoNothing` plus a read-back, so the second call
 * must return the *original* row rather than erroring or minting a second
 * one. This is what caps residue at a single flag across every re-run — which
 * matters here more than usual, because nothing can delete it afterwards.
 */
async function idempotencyRow(
  request: RequestFn,
  badFilesPath: string,
  flagged: BadFile,
): Promise<Row> {
  const again = await request({
    method: 'POST',
    path: badFilesPath,
    json: { guid: SYNTHETIC_GUID, reason: 'a second, different reason' },
    schema: FlagBadFileResponseSchema,
  })

  if (!again.ok || !again.data) {
    return {
      name: 'flag.is-idempotent',
      status: 'fail',
      note: 're-flagging the same guid failed',
      details: [again.reason ?? 'no reason given'],
    }
  }

  const same =
    again.data.badFile.id === flagged.id &&
    again.data.badFile.createdAt === flagged.createdAt &&
    // The first flagger's reason sticks; the second call's is discarded.
    again.data.badFile.reason === flagged.reason

  return {
    name: 'flag.is-idempotent',
    status: same ? 'pass' : 'fail',
    note: same
      ? `re-flagging returned the original row (id ${flagged.id}) unchanged`
      : `re-flagging returned id ${again.data.badFile.id} (expected ${flagged.id})`,
    details: same
      ? ['a double-click is harmless and residue stays at one row']
      : [
          `createdAt ${again.data.badFile.createdAt} vs ${flagged.createdAt}`,
          `reason ${again.data.badFile.reason} vs ${flagged.reason}`,
        ],
  }
}

/**
 * `file.flag_bad` — the action name is checked against the live log rather
 * than against `AUDIT_ACTIONS_LOCAL`, because a name that type-checks but is
 * never written is exactly the failure the mocked suites cannot see.
 */
async function auditRow(request: RequestFn, mediaId: string): Promise<Row> {
  const audit = await request({
    path: '/download/admin/audit-log?limit=25&action=file.flag_bad',
    schema: AuditLogPageSchema,
  })

  if (!audit.ok || !audit.data) {
    return {
      name: 'audit.records-flag-bad',
      status: 'fail',
      note: 'could not read the audit log',
      details: [audit.reason ?? 'no reason given'],
    }
  }

  const mine = audit.data.items.find(
    item =>
      item.targetId === mediaId &&
      item.targetType === 'media' &&
      item.metadata?.guid === SYNTHETIC_GUID,
  )

  return {
    name: 'audit.records-flag-bad',
    status: mine ? 'pass' : 'fail',
    note: mine
      ? `\`file.flag_bad\` on ${mediaId} at ${mine.createdAt}, actor ${mine.actor?.email ?? '(none)'}`
      : `no \`file.flag_bad\` row naming ${mediaId} and the synthetic guid`,
    details: mine
      ? [`metadata: ${JSON.stringify(mine.metadata)}`]
      : [
          `${audit.data.items.length} \`file.flag_bad\` row(s) in the last 25`,
          'the flag landed but the audit wiring did not',
        ],
  }
}

/**
 * The library must look exactly as it did. This route touches neither, but
 * asserting it is what makes "the flag changed nothing else" a measured claim
 * rather than an argument from reading the source.
 */
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
          : ['expected 0 — this route creates no jobs'],
    })
  }

  return rows
}

// ---------------------------------------------------------------------------
// Plumbing — the same contract `pause-resume.ts` uses.
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
  mediaId: string,
  flagged: BadFile | undefined,
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

  // There is no un-flag route, so the residue is printed on every path —
  // including a crash — with the exact command that removes it. A human who
  // has to clean up should not have to reconstruct this from the source.
  console.log('')
  console.log('  RESIDUE — one permanent row; there is no un-flag route:')
  console.log(`    media  ${mediaId}`)
  console.log(`    guid   ${SYNTHETIC_GUID}`)
  console.log(
    `    id     ${flagged?.id ?? '(unknown — the flag may not exist)'}`,
  )
  console.log('    remove with, from /home/jeremy/lilnas:')
  console.log(
    `      docker compose exec -T download node -e "const D=require('better-sqlite3')('/data/download.db');console.log(D.prepare('DELETE FROM bad_files WHERE release_guid LIKE ?').run('lilnas-verify:bad-file:%'))"`,
  )

  if (counts.fail > 0) {
    console.log('')
    console.log('  VERDICT: FAILED')
    return 1
  }
  if (counts.skipped > 0 || !flagged) {
    console.log('')
    console.log('  VERDICT: NOT A PASS — the flag was never written')
    return 2
  }
  console.log('')
  console.log('  VERDICT: PASS — bad-files verified live, guards and all')
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
