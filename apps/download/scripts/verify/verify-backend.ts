#!/usr/bin/env tsx
/**
 * The backend verification runner — the one CLI entrypoint for
 * `apps/download`'s "does this actually work against the real Radarr,
 * Sonarr, Emby and MinIO?" sweep.
 *
 * ```
 * tsx scripts/verify/verify-backend.ts capture --repo-path /path/to/lilnas
 * ```
 *
 * **Modes are a table, not an if/else chain.** Every mode is a {@link Mode}
 * in {@link MODES}: a name, a summary, a flag list that both `--help` and the
 * argument parser read, and a `run` that returns a process exit code. Later
 * tasks (`check`, `preflight`, `mutate`) add an entry and nothing else moves.
 *
 * ---
 *
 * ### What `capture` does
 *
 * Walks `READ_ROUTES` (`./routes.ts`) against the running container and
 * writes each response to `captures/<slug>.json` (the body verbatim) plus
 * `captures/<slug>.meta.json` (status, headers, duration, the resolved path,
 * and why a route was skipped when it was). Check mode (C2) then runs fully
 * offline against that directory.
 *
 * Four properties are load-bearing:
 *
 * 1. **Two passes, two id pools.** The id-free routes run first and real ids
 *    are mined out of what they returned. `/download/{videos,movies,shows}/:id`
 *    take **job** ids; `/download/media/:id/*` take **media keys**
 *    (`tmdb:`/`tvdb:`/`video:`). They are separate pools — see
 *    {@link IdPools} — and a route that finds no id is `SKIPPED (no fixture)`,
 *    never a failure and never a guessed id.
 * 2. **One bad route never ends the sweep.** A 500 on `/discover` costs
 *    exactly one row. The only abort is a `spawn-failed` transport error,
 *    which cannot be route-specific: `docker` itself did not run.
 * 3. **Non-2xx responses are still captured.** The error body is the
 *    evidence. A `TransportError` is recorded distinctly (with its
 *    `.reason`), because "cannot reach the container" and "the backend
 *    answered badly" are different diagnoses.
 * 4. **Upstream health is snapshotted first** into `captures/_health.json`,
 *    so C2 can tell "the resolver has a bug" from "Sonarr was restarting
 *    during the capture". Status codes only — see {@link probeUpstream} for
 *    why no API key can escape the container.
 *
 * `--dry-run` prints the plan and exits without touching the network, which
 * is how this file is verified without a live run.
 *
 * ⚠️ Captures hold **real requester emails and real library contents**.
 * `captures/` is gitignored; do not paste its contents into an issue or a
 * transcript.
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { READ_ROUTES, type RouteSpec } from './routes'
import {
  type BodyMode,
  dockerExecTransport,
  httpTransport,
  isTransportError,
  type RequestOptions,
  type Transport,
  type TransportFailureReason,
} from './transport'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default output directory, resolved relative to this file. */
const DEFAULT_CAPTURES_DIR = path.join(__dirname, 'captures')

/** Upstream status snapshot, written once at sweep start. */
const HEALTH_FILE = '_health.json'

/**
 * The address `apps/auth` recognises as an admin (its `ADMIN_EMAILS`
 * allowlist). Admin resolution is **email-only** —
 * `AdminCheckService.checkIsAdmin(email)` forwards just the address — so the
 * companion `X-Forwarded-User-Id` below exists purely to satisfy
 * `ForwardedUserGuard`, which requires both headers to be present.
 *
 * D1 introduces `fixtures.json` with an `adminEmail` field; when it lands,
 * this constant should read from there rather than being duplicated.
 */
const ADMIN_EMAIL = 'jeremyasuncion808@gmail.com'

/**
 * Synthetic, and deliberately recognisable in a log line. Nothing on the read
 * surface persists it: no `@Get` route writes an audit row or an attribution
 * record, so this id never lands in the database.
 */
const DEFAULT_USER_ID = 'verify-backend'

/**
 * Ceiling on `expensive: true` requests per run, enforced regardless of how
 * many the manifest carries. Each one is a real interactive indexer search
 * (30s+) that borrows monitoring upstream to run — one per sweep is the
 * intent, two is the outer bound, and they run serially like everything else.
 */
const MAX_EXPENSIVE_REQUESTS = 2

/** An indexer search is nothing like a database read. */
const EXPENSIVE_TIMEOUT_SECONDS = 180

/**
 * `bodyMode: 'headers-only'` sends the body to `/dev/null`, but curl still
 * *receives* every byte — the MinIO branch of `/media/:id/file` deliberately
 * ignores `Range`, so there is no way to ask for less. A timeout here means
 * the object was too large to drain in a minute, which is reported as a
 * transport timeout rather than as a fault in the route.
 */
const HEADERS_ONLY_TIMEOUT_SECONDS = 60

/** Health probes are a single unauthenticated-ish GET against a LAN host. */
const HEALTH_PROBE_TIMEOUT_SECONDS = 20

/** Grace on top of the in-container timeout before the child is killed. */
const SPAWN_GRACE_MS = 15_000

/** Cap on collected probe output. A status code is three bytes. */
const MAX_PROBE_OUTPUT_BYTES = 4096

/** The three media types, as they appear in a key prefix and in `media.type`. */
const MEDIA_KINDS = ['movie', 'show', 'video'] as const

/** `tmdb:` / `tvdb:` / `video:` — `mediaId()` in `src/db/media-id.ts`. */
const MEDIA_KEY_PREFIXES: ReadonlyArray<[string, MediaKind]> = [
  ['tmdb:', 'movie'],
  ['tvdb:', 'show'],
  ['video:', 'video'],
]

// ---------------------------------------------------------------------------
// CLI framework — the mode-dispatch table C2/C3/D1 extend
// ---------------------------------------------------------------------------

/** One flag, described once and consumed by both the parser and `--help`. */
export interface FlagSpec {
  /** Long name without the leading `--`, e.g. `repo-path`. */
  name: string
  kind: 'string' | 'boolean'
  /** Shown in `--help` for a string flag, e.g. `<path>`. */
  placeholder?: string
  describe: string
}

/** Parsed argv for one mode. Unknown flags never reach here. */
export interface ParsedArgs {
  strings: ReadonlyMap<string, string>
  booleans: ReadonlySet<string>
}

/**
 * One subcommand.
 *
 * A new mode is a new entry in {@link MODES} — nothing else in this file
 * changes. `run` returns the process exit code rather than calling
 * `process.exit`, so a mode is testable and composable.
 */
export interface Mode {
  /** Subcommand name, e.g. `capture`. */
  name: string
  /** One line, listed by the top-level `--help`. */
  summary: string
  /** The invocation line shown by `<mode> --help`. */
  usage: string
  flags: readonly FlagSpec[]
  run(args: ParsedArgs): Promise<number>
}

/** A user error: bad flags, missing required values, unknown mode. Exit 2. */
class UsageError extends Error {
  override readonly name = 'UsageError'
}

function parseArgs(
  argv: readonly string[],
  flags: readonly FlagSpec[],
): ParsedArgs {
  const specs = new Map(flags.map(flag => [flag.name, flag]))
  const strings = new Map<string, string>()
  const booleans = new Set<string>()

  // A queue rather than an index, so consuming the value of `--flag value`
  // is a `shift()` instead of index arithmetic that has to stay in sync.
  const queue = [...argv]
  let token = queue.shift()

  while (token !== undefined) {
    if (!token.startsWith('--')) {
      throw new UsageError(`Unexpected argument: ${token}`)
    }

    const separator = token.indexOf('=')
    const name = separator === -1 ? token.slice(2) : token.slice(2, separator)
    const inlineValue =
      separator === -1 ? undefined : token.slice(separator + 1)
    const spec = specs.get(name)

    if (!spec) {
      throw new UsageError(`Unknown flag: --${name}`)
    }

    if (spec.kind === 'boolean') {
      if (inlineValue !== undefined) {
        throw new UsageError(`--${name} takes no value`)
      }
      booleans.add(name)
    } else {
      // `??` short-circuits, so the queue is only consumed for the
      // `--flag value` form.
      const value = inlineValue ?? queue.shift()
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`--${name} needs a value`)
      }
      strings.set(name, value)
    }

    token = queue.shift()
  }

  return { strings, booleans }
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.strings.get(name)
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.booleans.has(name)
}

const SCRIPT = 'tsx scripts/verify/verify-backend.ts'

function topLevelHelp(): string {
  const width = Math.max(...MODES.map(mode => mode.name.length))
  const modes = MODES.map(
    mode => `  ${mode.name.padEnd(width)}  ${mode.summary}`,
  ).join('\n')

  return [
    'verify-backend — does apps/download actually work against the real',
    'Radarr, Sonarr, Emby and MinIO?',
    '',
    'Usage:',
    `  ${SCRIPT} <mode> [flags]`,
    `  ${SCRIPT} <mode> --help`,
    '',
    'Modes:',
    modes,
    '',
    'Run a mode with --help for the flags it takes.',
  ].join('\n')
}

function modeHelp(mode: Mode): string {
  const entries = mode.flags.map(flag => ({
    label: `--${flag.name}${
      flag.kind === 'string' ? ` ${flag.placeholder ?? '<value>'}` : ''
    }`,
    describe: flag.describe,
  }))
  const width = Math.max(...entries.map(entry => entry.label.length))
  const rows = entries.map(
    entry => `  ${entry.label.padEnd(width)}  ${entry.describe}`,
  )

  return [
    `${mode.name} — ${mode.summary}`,
    '',
    'Usage:',
    `  ${mode.usage}`,
    '',
    'Flags:',
    ...rows,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export type IdentityMode = 'anonymous' | 'user' | 'admin'

/**
 * Traefik's `lilnas-auth` normally sets these headers, and port 8081 has no
 * Traefik router in front of it — so the script sets them itself. `anonymous`
 * is a legitimate, tested case: it is exactly what a peer container on the
 * lilnas network looks like to this backend.
 */
export interface Identity {
  mode: IdentityMode
  email?: string
  userId?: string
  headers: Record<string, string>
}

function resolveIdentity(args: ParsedArgs): Identity {
  const asUser = stringFlag(args, 'as-user')
  const userId = stringFlag(args, 'user-id')
  const asAdmin = boolFlag(args, 'as-admin')

  if (asAdmin && asUser) {
    throw new UsageError('--as-admin and --as-user are mutually exclusive')
  }

  if (asAdmin) {
    return identity('admin', ADMIN_EMAIL, userId ?? DEFAULT_USER_ID)
  }

  if (asUser) {
    if (!userId) {
      throw new UsageError('--as-user also needs --user-id')
    }
    return identity('user', asUser, userId)
  }

  if (userId) {
    throw new UsageError('--user-id only means something with --as-user')
  }

  return { mode: 'anonymous', headers: {} }
}

function identity(mode: IdentityMode, email: string, userId: string): Identity {
  return {
    mode,
    email,
    userId,
    headers: {
      'X-Forwarded-User': email,
      'X-Forwarded-User-Id': userId,
    },
  }
}

// ---------------------------------------------------------------------------
// Manifest validation — runs in --dry-run too, so a manifest bug is caught
// without a live sweep
// ---------------------------------------------------------------------------

function validateManifest(routes: readonly RouteSpec[]): void {
  const bySlug = new Map<string, RouteSpec>()
  const problems: string[] = []

  for (const spec of routes) {
    if (bySlug.has(spec.slug)) {
      problems.push(`duplicate slug: ${spec.slug}`)
    }
    bySlug.set(spec.slug, spec)

    const hasPlaceholder = spec.path.includes(':id')
    if (spec.needsId && !hasPlaceholder) {
      problems.push(`${spec.slug}: needsId is set but path has no ":id"`)
    }
    if (!spec.needsId && hasPlaceholder) {
      problems.push(`${spec.slug}: path has ":id" but needsId is not set`)
    }
    if (spec.mediaKind && spec.needsId !== 'media') {
      problems.push(`${spec.slug}: mediaKind only applies to needsId: 'media'`)
    }
    if (spec.query && 'cursor' in spec.query) {
      problems.push(`${spec.slug}: cursor is injected, never hardcoded`)
    }
  }

  for (const spec of routes) {
    const from = spec.cursorFrom
    if (!from) {
      continue
    }
    const source = bySlug.get(from)
    if (!source) {
      problems.push(`${spec.slug}: cursorFrom names an unknown slug: ${from}`)
    } else if (source === spec) {
      problems.push(`${spec.slug}: cursorFrom points at itself`)
    } else if (source.cursorFrom) {
      problems.push(
        `${spec.slug}: cursorFrom chains off ${from}, which is itself a ` +
          'follow-up page — only page 2 is supported',
      )
    }
  }

  if (problems.length > 0) {
    throw new UsageError(
      `routes.ts is inconsistent:\n  ${problems.join('\n  ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// The two id pools
// ---------------------------------------------------------------------------

export type MediaKind = (typeof MEDIA_KINDS)[number]

/** An id lifted out of a real response, with the capture it came from. */
export interface DiscoveredId {
  value: string
  kind: MediaKind
  fromSlug: string
}

/**
 * The two id spaces, kept apart on purpose.
 *
 * `mediaKeys` are derived keys (`tmdb:438631`, `video:<nanoid>`) minted by
 * `mediaId()`; `jobIds` are `download_jobs` primary keys. Feeding one to a
 * route expecting the other is a guaranteed miss —
 * `GET /download/movies/:id` resolves through
 * `DownloadStateService.resolveJobRecord(id)` and then asserts the job's
 * media type, while `GET /download/media/:id` dispatches on the key prefix.
 *
 * Both arrays are appended in capture order, which is manifest order, so the
 * first match is also the most preferred: `activity` and `gallery` (things
 * the library actually holds) are mined before `discover` and the two
 * `/search` routes (things it merely knows about). That ordering is what
 * makes `/media/:id/seasons` — which 404s any series Sonarr does not hold —
 * land on a usable key.
 */
export interface IdPools {
  mediaKeys: DiscoveredId[]
  jobIds: DiscoveredId[]
}

function mediaKindFromKey(key: string): MediaKind | undefined {
  for (const [prefix, kind] of MEDIA_KEY_PREFIXES) {
    if (key.startsWith(prefix) && key.length > prefix.length) {
      return kind
    }
  }
  return undefined
}

function isMediaKind(value: unknown): value is MediaKind {
  return (
    typeof value === 'string' &&
    (MEDIA_KINDS as readonly string[]).includes(value)
  )
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function addId(pool: DiscoveredId[], candidate: DiscoveredId): void {
  if (!pool.some(existing => existing.value === candidate.value)) {
    pool.push(candidate)
  }
}

/**
 * The kind of a `Media`. The key prefix is authoritative — it is what the
 * media-keyed routes dispatch on — with `media.type` as the fallback for a
 * shape that somehow carries one and not the other.
 */
function mediaKindOf(media: Record<string, unknown>): MediaKind | undefined {
  const id = asString(media.id)
  const fromKey = id ? mediaKindFromKey(id) : undefined
  if (fromKey) {
    return fromKey
  }
  return isMediaKind(media.type) ? media.type : undefined
}

function collectMedia(
  pools: IdPools,
  value: unknown,
  fromSlug: string,
): MediaKind | undefined {
  const media = asRecord(value)
  if (!media) {
    return undefined
  }
  const id = asString(media.id)
  const kind = mediaKindOf(media)
  if (!id || !kind || !mediaKindFromKey(id)) {
    // An id with no recognised prefix cannot be routed to `/media/:id`
    // (`mediaTypeFromKey()` returns undefined and the controller 400s), so
    // it is not a fixture — drop it rather than spend a request proving it.
    return undefined
  }
  addId(pools.mediaKeys, { value: id, kind, fromSlug })
  return kind
}

/**
 * Mines both pools out of one captured body. Called only for the id-free
 * first pass, so the pools are complete before any `needsId` route runs.
 *
 * Four container shapes appear on this surface, and all four are handled
 * structurally rather than by slug, so a new list route needs no change here:
 *
 * - `{ items: DownloadJob[] }` — activity, history. A job carries both a job
 *   id (`item.id`) and a media key (`item.media.id`).
 * - `{ items: GalleryItem[] }` — the gallery. A gallery item has **no** `id`
 *   of its own, which is exactly how it is told apart from a job.
 * - `{ items: Media[] }` — discovery.
 * - `{ results: Media[] }` — the two `/search` routes.
 */
function mineIds(pools: IdPools, fromSlug: string, body: string): void {
  const parsed = safeJsonParse(body)
  const root = asRecord(parsed)
  if (!root) {
    return
  }

  for (const element of asArray(root.items) ?? []) {
    const item = asRecord(element)
    if (!item) {
      continue
    }

    if (item.media !== undefined) {
      const kind = collectMedia(pools, item.media, fromSlug)
      const jobId = asString(item.id)
      // A GalleryItem has no `id`; a DownloadJob does. That is the whole
      // discriminator, and it is the reason gallery rows never pollute the
      // job pool with a media key.
      if (jobId && kind) {
        addId(pools.jobIds, { value: jobId, kind, fromSlug })
      }
      continue
    }

    collectMedia(pools, item, fromSlug)
  }

  for (const element of asArray(root.results) ?? []) {
    collectMedia(pools, element, fromSlug)
  }
}

function pickId(spec: RouteSpec, pools: IdPools): DiscoveredId | undefined {
  if (spec.needsId === 'media') {
    return pools.mediaKeys.find(
      candidate => !spec.mediaKind || candidate.kind === spec.mediaKind,
    )
  }
  return pools.jobIds.find(candidate => candidate.kind === spec.needsId)
}

// ---------------------------------------------------------------------------
// Capture planning
// ---------------------------------------------------------------------------

interface StepPlan {
  spec: RouteSpec
  /** 1 = id-free (mines the pools), 2 = needs an id from pass 1. */
  pass: 1 | 2
  /** Set when the flags alone already rule this route out. */
  staticSkip?: string
}

/**
 * Manifest order, re-grouped into the order the sweep must run in: id-free
 * before `needsId` (two-pass discovery), and within each pass, page 1 before
 * any `cursorFrom` follow-up that reads its `nextCursor`. `Array.sort` is
 * stable, so manifest order survives inside each group.
 */
function buildPlan(includeExpensive: boolean): StepPlan[] {
  const steps: StepPlan[] = READ_ROUTES.map(spec => ({
    spec,
    pass: spec.needsId ? 2 : 1,
    staticSkip:
      spec.expensive && !includeExpensive
        ? 'expensive — pass --include-expensive'
        : undefined,
  }))

  const rank = (step: StepPlan): number =>
    step.pass * 2 + (step.spec.cursorFrom ? 1 : 0)

  return steps.sort((a, b) => rank(a) - rank(b))
}

function requestOptions(spec: RouteSpec): RequestOptions {
  const bodyMode: BodyMode = spec.bodyMode ?? 'json'
  if (spec.expensive) {
    return { bodyMode, timeoutSeconds: EXPENSIVE_TIMEOUT_SECONDS }
  }
  if (bodyMode === 'headers-only') {
    return { bodyMode, timeoutSeconds: HEADERS_ONLY_TIMEOUT_SECONDS }
  }
  return { bodyMode }
}

/**
 * `:id` is substituted with a **function** replacer on purpose: a string
 * replacement would interpret `$&` and friends inside a discovered id.
 */
function resolvePath(
  spec: RouteSpec,
  id: string | undefined,
  cursor: string | undefined,
): string {
  const withId =
    id === undefined
      ? spec.path
      : spec.path.replace(':id', () => encodeURIComponent(id))

  const params = new URLSearchParams(spec.query ?? {})
  if (cursor !== undefined) {
    params.set('cursor', cursor)
  }
  const query = params.toString()
  return query === '' ? withId : `${withId}?${query}`
}

// ---------------------------------------------------------------------------
// Capture execution
// ---------------------------------------------------------------------------

type StepOutcome = 'captured' | 'skipped' | 'transport-error'

interface StepResult {
  slug: string
  outcome: StepOutcome
  status?: number
  durationMs?: number
  resolvedPath?: string
  note?: string
}

/** What lands in `captures/<slug>.meta.json`. */
interface CaptureMeta {
  slug: string
  outcome: StepOutcome
  capturedAt: string
  /** The manifest template, `:id` unsubstituted. */
  routePath: string
  /** What was actually requested, ids and cursor resolved in. */
  resolvedPath: string | null
  status: number | null
  headers: Record<string, string> | null
  durationMs: number | null
  bodyMode: BodyMode
  /** `null` for a skip, and for `headers-only` — there is no body to keep. */
  bodyFile: string | null
  guard: RouteSpec['guard'] | null
  expensive: boolean
  identity: { mode: IdentityMode; email: string | null; userId: string | null }
  idUsed: DiscoveredId | null
  cursor: { from: string; value: string } | null
  skipReason: string | null
  transportError: { reason: TransportFailureReason; message: string } | null
}

interface CaptureContext {
  transport: Transport
  identity: Identity
  outDir: string
  pools: IdPools
  /** Successful pass-1 bodies, so `cursorFrom` can read `nextCursor`. */
  bodies: Map<string, string>
  /**
   * Every step already taken, so a `cursorFrom` skip can say *which* way its
   * source failed — "answered HTTP 403" and "returned nextCursor: null" are
   * very different notes to read in a report three days later.
   */
  results: Map<string, StepResult>
  expensiveIssued: number
}

async function runStep(
  ctx: CaptureContext,
  step: StepPlan,
): Promise<StepResult> {
  const { spec } = step
  const bodyMode: BodyMode = spec.bodyMode ?? 'json'

  const base = {
    slug: spec.slug,
    capturedAt: new Date().toISOString(),
    routePath: spec.path,
    bodyMode,
    guard: spec.guard ?? null,
    expensive: spec.expensive === true,
    identity: {
      mode: ctx.identity.mode,
      email: ctx.identity.email ?? null,
      userId: ctx.identity.userId ?? null,
    },
  }

  const skip = async (reason: string): Promise<StepResult> => {
    await writeMeta(ctx.outDir, {
      ...base,
      outcome: 'skipped',
      resolvedPath: null,
      status: null,
      headers: null,
      durationMs: null,
      bodyFile: null,
      idUsed: null,
      cursor: null,
      skipReason: reason,
      transportError: null,
    })
    return { slug: spec.slug, outcome: 'skipped', note: reason }
  }

  if (step.staticSkip) {
    return skip(step.staticSkip)
  }

  if (spec.expensive && ctx.expensiveIssued >= MAX_EXPENSIVE_REQUESTS) {
    return skip(
      `expensive cap reached (${MAX_EXPENSIVE_REQUESTS} per run) — each is a ` +
        'real indexer search',
    )
  }

  let idUsed: DiscoveredId | null = null
  if (spec.needsId) {
    const found = pickId(spec, ctx.pools)
    if (!found) {
      const pool =
        spec.needsId === 'media'
          ? `media key${spec.mediaKind ? ` (${spec.mediaKind})` : ''}`
          : `${spec.needsId} job id`
      return skip(`no fixture — the first pass found no ${pool}`)
    }
    idUsed = found
  }

  let cursor: { from: string; value: string } | null = null
  if (spec.cursorFrom) {
    const from = spec.cursorFrom
    const failure = cursorSourceFailure(ctx, from)
    if (failure) {
      return skip(`no cursor — ${from} ${failure}`)
    }
    const body = ctx.bodies.get(from) ?? ''
    const next = asString(asRecord(safeJsonParse(body))?.nextCursor)
    if (!next) {
      return skip(
        `no cursor — ${from} returned nextCursor: null (the whole result set ` +
          'fit on page 1)',
      )
    }
    cursor = { from, value: next }
  }

  const resolvedPath = resolvePath(spec, idUsed?.value, cursor?.value)

  if (spec.expensive) {
    ctx.expensiveIssued += 1
  }

  try {
    const response = await ctx.transport(
      resolvedPath,
      ctx.identity.headers,
      requestOptions(spec),
    )

    // headers-only never buffered a body; there is nothing to write, and
    // writing an empty file would look to check mode like an empty response.
    let bodyFile: string | null = null
    if (bodyMode !== 'headers-only') {
      bodyFile = `${spec.slug}.json`
      await writeFile(path.join(ctx.outDir, bodyFile), response.body, 'utf8')
    }

    await writeMeta(ctx.outDir, {
      ...base,
      outcome: 'captured',
      resolvedPath,
      status: response.status,
      headers: response.headers,
      durationMs: response.durationMs,
      bodyFile,
      idUsed,
      cursor,
      skipReason: null,
      transportError: null,
    })

    if (step.pass === 1 && isSuccess(response.status)) {
      ctx.bodies.set(spec.slug, response.body)
      mineIds(ctx.pools, spec.slug, response.body)
    }

    return {
      slug: spec.slug,
      outcome: 'captured',
      status: response.status,
      durationMs: response.durationMs,
      resolvedPath,
    }
  } catch (error) {
    if (!isTransportError(error)) {
      throw error
    }

    await writeMeta(ctx.outDir, {
      ...base,
      outcome: 'transport-error',
      resolvedPath,
      status: null,
      headers: null,
      durationMs: null,
      bodyFile: null,
      idUsed,
      cursor,
      skipReason: null,
      transportError: { reason: error.reason, message: error.message },
    })

    return {
      slug: spec.slug,
      outcome: 'transport-error',
      resolvedPath,
      note: error.reason,
    }
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300
}

/**
 * Why the page-1 capture a `cursorFrom` spec depends on cannot supply a
 * cursor, or `undefined` if it can. Never fabricates one: a cursor is minted
 * under the filter that produced it, so an invented value tests the rejection
 * path rather than the round trip.
 */
function cursorSourceFailure(
  ctx: CaptureContext,
  from: string,
): string | undefined {
  const source = ctx.results.get(from)
  if (!source) {
    return 'did not run'
  }
  if (source.outcome === 'skipped') {
    return `was itself skipped (${source.note})`
  }
  if (source.outcome === 'transport-error') {
    return `could not be reached (${source.note})`
  }
  if (!isSuccess(source.status ?? 0)) {
    return `answered HTTP ${source.status}`
  }
  if (!ctx.bodies.has(from)) {
    return 'kept no body to read a cursor from'
  }
  return undefined
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

async function writeMeta(outDir: string, meta: CaptureMeta): Promise<void> {
  await writeFile(
    path.join(outDir, `${meta.slug}.meta.json`),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  )
}

/**
 * Clears exactly the files this run is about to write, and nothing else.
 *
 * A blanket wipe would take `mutate-journal.json` with it — D1's crash-safe
 * cleanup record, which lives in the same directory and must survive. Leaving
 * stale files behind is equally wrong: a route captured on the last run but
 * skipped on this one would leave check mode validating a body whose own meta
 * says `skipped`.
 */
async function prepareOutputDir(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true })
  const stale = [
    HEALTH_FILE,
    ...READ_ROUTES.flatMap(spec => [
      `${spec.slug}.json`,
      `${spec.slug}.meta.json`,
    ]),
  ]
  await Promise.all(
    stale.map(name => rm(path.join(outDir, name), { force: true })),
  )
}

// ---------------------------------------------------------------------------
// Upstream health snapshot
// ---------------------------------------------------------------------------

interface UpstreamProbe {
  name: string
  /** Env var names, read **inside** the container. Never on the host. */
  urlVar: string
  keyVar: string
  statusPath: string
}

const UPSTREAM_PROBES: readonly UpstreamProbe[] = [
  {
    name: 'radarr',
    urlVar: 'RADARR_URL',
    keyVar: 'RADARR_API_KEY',
    statusPath: '/api/v3/system/status',
  },
  {
    name: 'sonarr',
    urlVar: 'SONARR_URL',
    keyVar: 'SONARR_API_KEY',
    statusPath: '/api/v3/system/status',
  },
]

type HealthState =
  /** Something answered with an HTTP status. 401 is an answer, not a fault. */
  | 'answered'
  /** The container has no URL or no key for this upstream. */
  | 'unconfigured'
  /** curl could not complete the request (`%{http_code}` came back `000`). */
  | 'unreachable'
  /** The probe itself failed — `docker compose exec` did not produce output. */
  | 'probe-failed'
  /**
   * Not attempted: the run used `--base-url`, which has no way into the
   * container to read the keys the running process holds. Check mode must
   * treat this as "no health evidence", never as "the upstream was fine".
   */
  | 'unprobed'

interface UpstreamHealth {
  upstream: string
  /** The **unexpanded** literal probed, so no host or key is recorded. */
  target: string
  state: HealthState
  status: number | null
}

interface HealthSnapshot {
  capturedAt: string
  upstreams: UpstreamHealth[]
}

/**
 * Reads the upstream's `/system/status` **from inside the container**, using
 * the env the running process holds, and brings back a three-digit status
 * code or one fixed token — nothing else.
 *
 * The leak-proofing is structural, not a matter of care:
 *
 * - The API key never exists on the host. `$RADARR_API_KEY` is passed through
 *   as a literal in the script text and expanded by the container's own `sh`,
 *   so it is absent from this process's argv, its environment, and any error
 *   this function can throw.
 * - curl writes the body to `/dev/null` and its own diagnostics to
 *   `/dev/null`, so a URL carrying a key in a query string (some upstreams
 *   accept `?apikey=`) could not surface even if the config used one.
 * - Only `%{http_code}` reaches stdout, and stdout is matched against a
 *   three-digit pattern before it is used. Anything unrecognised becomes
 *   `probe-failed` and is **discarded unread** rather than echoed.
 * - `_health.json` records the unexpanded `$RADARR_URL/...` literal, never
 *   the resolved address.
 */
async function probeUpstream(
  repoPath: string,
  probe: UpstreamProbe,
): Promise<UpstreamHealth> {
  const target = `$${probe.urlVar}${probe.statusPath}`
  const base: Pick<UpstreamHealth, 'upstream' | 'target'> = {
    upstream: probe.name,
    target,
  }

  for (const name of [probe.urlVar, probe.keyVar]) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new UsageError(`Implausible env var name in a probe: ${name}`)
    }
  }

  // Every `$` below is escaped so it survives into the script text and is
  // expanded by the container's `sh`, not by this template literal.
  const curl =
    `curl -s -o /dev/null -w "%{http_code}"` +
    ` --max-time ${HEALTH_PROBE_TIMEOUT_SECONDS}` +
    ` -H "X-Api-Key: $${probe.keyVar}"` +
    ` "$${probe.urlVar}${probe.statusPath}" 2>/dev/null`

  const script = [
    `if [ -z "$${probe.urlVar}" ] || [ -z "$${probe.keyVar}" ]; then`,
    '  printf unconfigured; exit 0',
    'fi',
    `code=$(${curl}) || code=000`,
    'printf %s "$code"',
  ].join('\n')

  const result = await runDockerExec(
    repoPath,
    ['sh', '-c', script],
    HEALTH_PROBE_TIMEOUT_SECONDS * 1000 + SPAWN_GRACE_MS,
  )

  if (result.failed) {
    return { ...base, state: 'probe-failed', status: null }
  }

  const output = result.stdout.trim()
  if (output === 'unconfigured') {
    return { ...base, state: 'unconfigured', status: null }
  }
  if (!/^\d{3}$/.test(output)) {
    // Deliberately not echoed: this is the one place unexpected output from
    // inside the container could carry something it should not.
    return { ...base, state: 'probe-failed', status: null }
  }
  if (output === '000') {
    return { ...base, state: 'unreachable', status: null }
  }
  return { ...base, state: 'answered', status: Number(output) }
}

async function captureHealth(
  repoPath: string | undefined,
  outDir: string,
): Promise<HealthSnapshot> {
  const upstreams: UpstreamHealth[] = []
  for (const probe of UPSTREAM_PROBES) {
    upstreams.push(
      repoPath === undefined
        ? {
            upstream: probe.name,
            target: `$${probe.urlVar}${probe.statusPath}`,
            state: 'unprobed',
            status: null,
          }
        : await probeUpstream(repoPath, probe),
    )
  }

  const snapshot: HealthSnapshot = {
    capturedAt: new Date().toISOString(),
    upstreams,
  }
  await writeFile(
    path.join(outDir, HEALTH_FILE),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    'utf8',
  )
  return snapshot
}

interface ExecResult {
  stdout: string
  failed: boolean
}

/**
 * A deliberately minimal `docker compose exec` runner, separate from
 * `./transport.ts`: `Transport` speaks HTTP to `localhost:8081` inside the
 * container and cannot express "run this shell snippet", which is what
 * reading the upstream env from inside the container requires.
 *
 * `shell: false`, so `script` is one argv element and the host shell never
 * sees it. stderr is collected only to decide `failed` — it is never returned,
 * never written to a capture, and never put in an error message.
 */
function runDockerExec(
  repoPath: string,
  command: readonly string[],
  timeoutMs: number,
): Promise<ExecResult> {
  return new Promise(resolve => {
    const child = spawn(
      'docker',
      ['compose', 'exec', '-T', 'download', ...command],
      { cwd: repoPath, shell: false, stdio: ['ignore', 'pipe', 'ignore'] },
    )

    let stdout = ''
    let settled = false

    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const finish = (result: ExecResult) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_PROBE_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8')
      }
    })

    child.on('error', () => finish({ stdout: '', failed: true }))
    child.on('close', code => finish({ stdout, failed: code !== 0 }))
  })
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function describeSpec(spec: RouteSpec): string {
  const notes: string[] = []
  if (spec.needsId === 'media') {
    notes.push(
      `needs a media key${spec.mediaKind ? ` (${spec.mediaKind})` : ''}`,
    )
  } else if (spec.needsId) {
    notes.push(`needs a ${spec.needsId} job id`)
  }
  if (spec.cursorFrom) {
    notes.push(`cursor from ${spec.cursorFrom}`)
  }
  if (spec.guard) {
    notes.push(`guard: ${spec.guard}`)
  }
  if (spec.bodyMode === 'headers-only') {
    notes.push('headers only')
  }
  if (spec.expensive) {
    notes.push('expensive')
  }
  return notes.join(', ')
}

function printPlan(
  plan: readonly StepPlan[],
  identityMode: IdentityMode,
  outDir: string,
  includeExpensive: boolean,
): void {
  console.log('Plan (dry run — nothing is sent):\n')
  console.log(`  identity   ${identityMode}`)
  console.log(`  captures   ${outDir}`)
  console.log(`  expensive  ${includeExpensive ? 'included' : 'skipped'}`)
  console.log(
    `  health     ${UPSTREAM_PROBES.map(p => p.name).join(', ')} ` +
      '(status codes only, probed inside the container)',
  )
  console.log('')

  const rows = plan.map(step => ({
    step,
    action: step.staticSkip ? `SKIP (${step.staticSkip})` : 'RUN',
  }))
  const slugWidth = Math.max(...rows.map(row => row.step.spec.slug.length))
  const actionWidth = Math.max(...rows.map(row => row.action.length))

  let pass = 0
  for (const { step, action } of rows) {
    if (step.pass !== pass) {
      pass = step.pass
      console.log(
        pass === 1
          ? '  pass 1 — id-free routes; the id pools are mined from these'
          : '  pass 2 — routes needing an id discovered in pass 1',
      )
    }
    const notes = describeSpec(step.spec)
    console.log(
      `    ${step.spec.slug.padEnd(slugWidth)}  ${action.padEnd(actionWidth)}  ` +
        `${step.spec.path}${notes ? `  [${notes}]` : ''}`,
    )
  }

  console.log(
    '\n  A pass-2 route with no matching id, and a cursor page whose source ' +
      'returned\n  nextCursor: null, are decided at run time and reported ' +
      'as SKIPPED then.',
  )
}

function printResults(results: readonly StepResult[]): void {
  console.log('\nResults:\n')
  const width = Math.max(...results.map(result => result.slug.length))
  for (const result of results) {
    const detail =
      result.outcome === 'captured'
        ? `HTTP ${result.status}  ${result.durationMs}ms`
        : result.outcome === 'skipped'
          ? `SKIPPED (${result.note})`
          : `TRANSPORT (${result.note})`
    console.log(`  ${result.slug.padEnd(width)}  ${detail}`)
  }
}

// ---------------------------------------------------------------------------
// capture mode
// ---------------------------------------------------------------------------

const CAPTURE_FLAGS: readonly FlagSpec[] = [
  {
    name: 'repo-path',
    kind: 'string',
    placeholder: '<path>',
    describe:
      'Directory holding the root docker-compose.yml, on the lilnas host. ' +
      'Required unless --dry-run.',
  },
  {
    name: 'base-url',
    kind: 'string',
    placeholder: '<url>',
    describe:
      'Talk to an already-reachable backend (http://localhost:8081) instead ' +
      'of docker compose exec. No way into the container, so the upstream ' +
      'health snapshot is recorded as unprobed. Mutually exclusive with ' +
      '--repo-path.',
  },
  {
    name: 'captures',
    kind: 'string',
    placeholder: '<dir>',
    describe: `Where to write. Default: ${DEFAULT_CAPTURES_DIR}`,
  },
  {
    name: 'as-user',
    kind: 'string',
    placeholder: '<email>',
    describe: 'Send X-Forwarded-User. Needs --user-id.',
  },
  {
    name: 'user-id',
    kind: 'string',
    placeholder: '<id>',
    describe: 'Send X-Forwarded-User-Id. Only with --as-user or --as-admin.',
  },
  {
    name: 'as-admin',
    kind: 'boolean',
    describe: `Identify as ${ADMIN_EMAIL}, which apps/auth treats as admin.`,
  },
  {
    name: 'include-expensive',
    kind: 'boolean',
    describe:
      'Also hit routes that fire a real indexer search. Capped at ' +
      `${MAX_EXPENSIVE_REQUESTS} per run, serial.`,
  },
  {
    name: 'dry-run',
    kind: 'boolean',
    describe: 'Print the plan and exit. Touches no network.',
  },
]

async function runCapture(args: ParsedArgs): Promise<number> {
  validateManifest(READ_ROUTES)

  const identity = resolveIdentity(args)
  const dryRun = boolFlag(args, 'dry-run')
  const includeExpensive = boolFlag(args, 'include-expensive')
  const outDir = path.resolve(
    stringFlag(args, 'captures') ?? DEFAULT_CAPTURES_DIR,
  )
  const plan = buildPlan(includeExpensive)

  if (dryRun) {
    printPlan(plan, identity.mode, outDir, includeExpensive)
    return 0
  }

  const repoPath = stringFlag(args, 'repo-path')
  const baseUrl = stringFlag(args, 'base-url')
  if (repoPath && baseUrl) {
    throw new UsageError('--repo-path and --base-url are mutually exclusive')
  }

  let transport: Transport
  if (repoPath) {
    transport = dockerExecTransport({ repoPath })
  } else if (baseUrl) {
    transport = httpTransport(baseUrl)
  } else {
    throw new UsageError(
      '--repo-path is required (or --base-url) unless --dry-run is set',
    )
  }

  console.log(`Capturing as ${identity.mode} into ${outDir}`)
  await prepareOutputDir(outDir)

  const health = await captureHealth(repoPath, outDir)
  for (const upstream of health.upstreams) {
    const status = upstream.status === null ? '' : ` ${upstream.status}`
    console.log(`  health  ${upstream.upstream}: ${upstream.state}${status}`)
  }

  const ctx: CaptureContext = {
    transport,
    identity,
    outDir,
    pools: { mediaKeys: [], jobIds: [] },
    bodies: new Map(),
    results: new Map(),
    expensiveIssued: 0,
  }

  const results: StepResult[] = []
  for (const step of plan) {
    const result = await runStep(ctx, step)
    ctx.results.set(result.slug, result)
    results.push(result)
    if (
      repoPath !== undefined &&
      result.outcome === 'transport-error' &&
      result.note === 'spawn-failed'
    ) {
      // `docker` itself did not run, so this cannot be about one route.
      // Every remaining request would fail identically and slowly.
      console.error(
        `\nAborting: could not run \`docker\` in ${repoPath}. ` +
          'Is --repo-path the directory holding the root docker-compose.yml?',
      )
      break
    }
  }

  printResults(results)

  const captured = results.filter(r => r.outcome === 'captured')
  const skipped = results.filter(r => r.outcome === 'skipped')
  const transportErrors = results.filter(r => r.outcome === 'transport-error')
  const nonSuccess = captured.filter(r => !isSuccess(r.status ?? 0))

  console.log(
    `\n${captured.length} captured (${nonSuccess.length} non-2xx), ` +
      `${skipped.length} skipped, ${transportErrors.length} unreachable.`,
  )
  console.log(
    `Media keys found: ${ctx.pools.mediaKeys.length}. ` +
      `Job ids found: ${ctx.pools.jobIds.length}.`,
  )
  console.log(
    'Non-2xx responses are captured, not judged — run `check` to read them.',
  )

  // A non-2xx is evidence for check mode, not a failure of the sweep. Being
  // unable to reach the container at all is a failure of the sweep.
  return transportErrors.length > 0 || captured.length === 0 ? 1 : 0
}

const CAPTURE_MODE: Mode = {
  name: 'capture',
  summary: 'Hit every read route and write the raw responses to disk',
  usage: `${SCRIPT} capture --repo-path <path> [flags]`,
  flags: CAPTURE_FLAGS,
  run: runCapture,
}

/**
 * The mode-dispatch table. C2 (`check`), C3 and D1 (`preflight`, `mutate`)
 * each append one entry.
 */
export const MODES: readonly Mode[] = [CAPTURE_MODE]

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const HELP_FLAGS = new Set(['--help', '-h', 'help'])

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const [first, ...rest] = argv

  if (first === undefined || HELP_FLAGS.has(first)) {
    console.log(topLevelHelp())
    return 0
  }

  const mode = MODES.find(candidate => candidate.name === first)
  if (!mode) {
    throw new UsageError(`Unknown mode: ${first}`)
  }

  if (rest.some(token => HELP_FLAGS.has(token))) {
    console.log(modeHelp(mode))
    return 0
  }

  return mode.run(parseArgs(rest, mode.flags))
}

main()
  .then(code => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n`)
      console.error(topLevelHelp())
      process.exitCode = 2
      return
    }
    console.error(error instanceof Error ? error.stack : String(error))
    process.exitCode = 1
  })
