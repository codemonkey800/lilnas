/**
 * The assertions a schema cannot make.
 *
 * `check` mode already parses every captured body against its envelope, which
 * answers "is this the shape we promised?". It cannot answer "is this value
 * *right*?" — and the interesting failures on this surface are all of the
 * second kind. `runtime: 137` parses perfectly as `z.number().int()`; it is
 * also a feature film whose `* 60` went missing. `watchUrl:
 * "http://emby:8096/..."` is a valid string, works in every unit test, and is
 * dead in a browser. Those are the bugs a mocked test suite structurally
 * cannot catch, because the mock author writes the payload.
 *
 * Three rules run through every check here, and they are the substance of this
 * file rather than decoration:
 *
 * 1. **A failure prints evidence, never a verdict.** A check knows that a
 *    value and an expectation disagree. It does *not* know which one is
 *    wrong — `runtime: 240` on a movie is a lost multiplication, or a
 *    legitimately short film, or upstream drift, and the response cannot tell
 *    them apart. So every failure carries the title, the id, the value, and
 *    the capture and path it came from, sized so a human resolves it in
 *    seconds. Deciding which is wrong is a person's job — task E2's, in the
 *    plan this file belongs to.
 * 2. **Absent fixture and empty fixture are different, and both are visible.**
 *    A `SKIPPED` row means the capture this check reads was never taken (or
 *    was a 401, or a transport error) — there was nothing to run against. A
 *    **hollow** `PASS` means the capture *was* there and held zero subjects:
 *    an empty library is a legitimate state of the world, not a failed run,
 *    but it is also not coverage, and `report.ts` counts it apart from a real
 *    pass so a green board cannot be read as a verified one.
 * 3. **The environment gets a hearing before the code does.** `_health.json`
 *    is cross-referenced wherever an upstream could explain the finding —
 *    with the standing caveat that `unprobed` is the *absence* of evidence and
 *    never a clean bill of health.
 *
 * These checks read the **raw** captured JSON, not the schema-parsed result,
 * on purpose: several of them (`radarrId: 0`, an unknown audit `action`) would
 * also trip the envelope parse, and the whole point is that the row above says
 * `items[3].radarrId — Too small` while the row here says which title, from
 * which capture, carries the Radarr id that the SDK's `0`-for-absent
 * convention leaked through.
 */
import { AUDIT_ACTIONS } from '../../../../packages/utils/src/download/schema'
import type { UpstreamLine } from './report'
import { idProvenance, READ_ROUTES, type RouteSpec } from './routes'

// ---------------------------------------------------------------------------
// The input: what C2 already loaded
// ---------------------------------------------------------------------------

/**
 * The subset of C1's `<slug>.meta.json` these checks reason about.
 *
 * Structural rather than imported from `verify-backend.ts`, so the dependency
 * runs one way only: the runner knows about the checks, the checks do not know
 * about the runner. Its `CaptureRecord` satisfies this interface as written.
 */
export interface CaptureMeta {
  slug: string
  outcome: 'captured' | 'skipped' | 'transport-error'
  status?: number | null
  /** What was actually requested — ids and cursor resolved in. */
  resolvedPath?: string | null
  skipReason?: string | null
  idUsed?: { value: string; kind: string; fromSlug: string } | null
}

/** One captured route, as check mode already read it off disk. */
export interface Capture {
  slug: string
  /** The manifest entry, for the query it was issued with. */
  spec: RouteSpec
  meta: CaptureMeta
  /** The raw body, or `null` where none was kept (headers-only, a skip). */
  body: string | null
  /** `JSON.parse(body)`, or `undefined` when absent or unparseable. */
  json: unknown
}

/**
 * Everything the checks may look at. Deliberately a snapshot of what check
 * mode already read — no check opens a file, so the report cannot disagree
 * with itself about what a capture contained.
 */
export interface CaptureSet {
  captures: ReadonlyMap<string, Capture>
  /** `_health.json`, in the report's vocabulary. Empty when it was absent. */
  upstreams: ReadonlyMap<string, UpstreamLine>
}

export type SpotCheckStatus = 'pass' | 'fail' | 'skipped'

export interface SpotCheckResult {
  status: SpotCheckStatus
  /** The parenthetical after the verdict. Say what was actually examined. */
  note?: string
  /** Evidence, one line each. On a failure this is the whole point. */
  details?: readonly string[]
  /** A pass over zero subjects. Green, and not coverage. */
  hollow?: boolean
}

export interface SpotCheck {
  id: string
  /** The expectation, in one line. Printed above the evidence on a failure. */
  describe: string
  run(captures: CaptureSet): SpotCheckResult
}

// ---------------------------------------------------------------------------
// Constants — each verified against the source it mirrors
// ---------------------------------------------------------------------------

/**
 * Below this, a movie's `runtime` is more likely a lost multiplication than a
 * real duration.
 *
 * `toMovie()` (`src/media/radarr.service.ts:123`) is
 * `movie.runtime * 60` — Radarr reports whole minutes and `MediaBaseSchema`
 * documents `runtime` as seconds. So a feature film reads ~7200 and even a
 * 40-minute oddity reads 2400. Five minutes of *seconds* is 300; five minutes
 * of raw *minutes* would be 5. The floor is set at 300 rather than at
 * something tighter because a genuine short film exists, and a check that
 * cries wolf gets ignored.
 *
 * **Movies only.** `toShow()` (`src/media/sonarr.service.ts:161`) maps
 * `SeriesResource.runtime`, which is the *per-episode* runtime, so a
 * short-form series legitimately reads 300 or less and the same floor would
 * be wrong there.
 */
const MOVIE_RUNTIME_FLOOR_SECONDS = 300

/**
 * `TOP_REQUESTERS_LIMIT` — `src/admin/admin-stats.service.ts:22`, applied by
 * `rankRequesters()`'s `.slice(0, TOP_REQUESTERS_LIMIT)`.
 *
 * Duplicated rather than imported: importing the constant would pull
 * `admin-stats.service.ts` — and with it `@nestjs/common` and the `src/*`
 * path-aliased repos — into a script that must run standalone under `tsx`.
 * Deliberately left out of `AdminStatsResponseSchema` too (see that schema's
 * note), so a violation reports as "the limit stopped being applied" instead
 * of as an opaque `too_big`.
 */
const TOP_REQUESTERS_LIMIT = 20

/**
 * Enough to see the pattern, few enough to stay readable. A check that finds
 * 400 offenders says so and prints the first handful.
 */
const MAX_OFFENDERS_SHOWN = 6

/** Bodies on this surface are shallow; this only stops a pathological walk. */
const MAX_WALK_DEPTH = 8

/**
 * Container extensions Radarr/Sonarr actually import. Used only to tell a
 * media *file* from a *folder* — `SeriesResource.path` is the series
 * directory, where `MovieResource.movieFile.path` is a file.
 */
const MEDIA_FILE_EXTENSIONS = [
  '.avi',
  '.flv',
  '.iso',
  '.m2ts',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ts',
  '.webm',
  '.wmv',
]

/** `mediaId()` — `src/db/media-id.ts`. */
const MEDIA_KEY_PREFIXES = ['tmdb:', 'tvdb:', 'video:']

/** `DiscoverySource` → the upstream that produces it. */
const DEGRADED_SOURCE_UPSTREAMS: Readonly<Record<string, string>> = {
  movies: 'radarr',
  shows: 'sonarr',
}

// ---------------------------------------------------------------------------
// Result constructors
// ---------------------------------------------------------------------------

function pass(note: string, details?: readonly string[]): SpotCheckResult {
  return { status: 'pass', note, details }
}

/** A pass with nothing behind it. Never silently folded into a real pass. */
function hollowPass(
  note: string,
  details?: readonly string[],
): SpotCheckResult {
  return { status: 'pass', hollow: true, note, details }
}

function skip(note: string, details?: readonly string[]): SpotCheckResult {
  return { status: 'skipped', note, details }
}

function fail(note: string, details: readonly string[]): SpotCheckResult {
  return { status: 'fail', note, details }
}

// ---------------------------------------------------------------------------
// Small structural helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isSuccess(status: number | null | undefined): boolean {
  return typeof status === 'number' && status >= 200 && status < 300
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The first {@link MAX_OFFENDERS_SHOWN} lines plus a count of the rest. Every
 * check that can find more than one problem funnels through here so no single
 * failure can bury the next one.
 */
function truncate(lines: readonly string[]): string[] {
  if (lines.length <= MAX_OFFENDERS_SHOWN) {
    return [...lines]
  }
  return [
    ...lines.slice(0, MAX_OFFENDERS_SHOWN),
    `… and ${lines.length - MAX_OFFENDERS_SHOWN} more`,
  ]
}

// ---------------------------------------------------------------------------
// Reading a capture
// ---------------------------------------------------------------------------

type CaptureRead =
  | { kind: 'ok'; capture: Capture; json: Record<string, unknown> }
  /** There is nothing to check against, and that is not this route's fault. */
  | { kind: 'unusable'; reason: string }

/**
 * One capture, or the reason it cannot be read — phrased so the skip note
 * says *why* rather than just "no fixture". "answered HTTP 403" and "was
 * never captured" send a reader to completely different places.
 */
function read(set: CaptureSet, slug: string): CaptureRead {
  const capture = set.captures.get(slug)
  if (!capture) {
    return { kind: 'unusable', reason: `no ${slug} capture in this directory` }
  }

  const { meta } = capture
  if (meta.outcome === 'skipped') {
    return {
      kind: 'unusable',
      reason: `${slug} was skipped at capture time (${
        meta.skipReason ?? 'no reason recorded'
      })`,
    }
  }
  if (meta.outcome === 'transport-error') {
    return { kind: 'unusable', reason: `${slug} could not be reached` }
  }
  if (!isSuccess(meta.status)) {
    return { kind: 'unusable', reason: `${slug} answered HTTP ${meta.status}` }
  }

  const json = asRecord(capture.json)
  if (!json) {
    return {
      kind: 'unusable',
      reason: `${slug} did not answer with a JSON object`,
    }
  }

  return { kind: 'ok', capture, json }
}

/** `path: /download/discover?limit=10` — where the value actually came from. */
function provenance(capture: Capture): string[] {
  const parts: string[] = [`capture: ${capture.slug}.json`]
  const resolved = asString(capture.meta.resolvedPath)
  if (resolved) {
    parts.push(`path: ${resolved}`)
  }
  const id = capture.meta.idUsed
  if (id) {
    parts.push(`id: ${id.value} (from ${id.fromSlug})`)
  }
  return [parts.join('  ·  ')]
}

/** What `_health.json` says about one upstream, in one clause. */
function upstreamEvidence(set: CaptureSet, name: string): string {
  const line = set.upstreams.get(name)
  if (!line) {
    return `${name}: no health snapshot was taken for this run, so there is no evidence either way`
  }
  if (line.state === 'unprobed') {
    return `${name}: never probed — this run carries NO evidence about it, which is not the same as "it was fine"`
  }
  if (line.evidence === 'ok') {
    return `${name}: answered HTTP ${line.status} at capture time, so it was up`
  }
  return `${name}: ${line.state}${
    line.status === null ? '' : ` (HTTP ${line.status})`
  } at capture time — an environmental cause is live`
}

// ---------------------------------------------------------------------------
// Finding every Media in the capture set
// ---------------------------------------------------------------------------

/** One `Media` object, with enough provenance to go and look at it. */
interface MediaSighting {
  media: Record<string, unknown>
  capture: Capture
  /** `discover → items[3]`, `activity → items[0].media`. */
  where: string
  id: string
  title: string
  type: string
}

function hasMediaKeyPrefix(id: string): boolean {
  return MEDIA_KEY_PREFIXES.some(
    prefix => id.startsWith(prefix) && id.length > prefix.length,
  )
}

/**
 * A `Media` is recognised by shape, not by which route returned it: a derived
 * key (`tmdb:`/`tvdb:`/`video:`), a title, and one of the three types. That
 * triple is specific enough that an audit row's free-form `metadata` cannot
 * masquerade as one, and general enough that a new list route needs no change
 * here.
 */
function identifyMedia(
  record: Record<string, unknown>,
): Pick<MediaSighting, 'id' | 'title' | 'type'> | undefined {
  const id = asString(record.id)
  const type = asString(record.type)
  const title = record.title

  if (
    id === undefined ||
    type === undefined ||
    typeof title !== 'string' ||
    !hasMediaKeyPrefix(id) ||
    !['movie', 'show', 'video'].includes(type)
  ) {
    return undefined
  }

  return { id, title, type }
}

function walk(
  node: unknown,
  capture: Capture,
  where: string,
  out: MediaSighting[],
  depth: number,
): void {
  if (depth > MAX_WALK_DEPTH) {
    return
  }

  const array = asArray(node)
  if (array) {
    array.forEach((element, index) =>
      walk(element, capture, `${where}[${index}]`, out, depth + 1),
    )
    return
  }

  const record = asRecord(node)
  if (!record) {
    return
  }

  const identity = identifyMedia(record)
  if (identity) {
    // A Media never nests another Media, so this branch does not recurse.
    out.push({
      ...identity,
      capture,
      media: record,
      where: where === '' ? '<root>' : where,
    })
    return
  }

  for (const [key, value] of Object.entries(record)) {
    walk(value, capture, where === '' ? key : `${where}.${key}`, out, depth + 1)
  }
}

/**
 * Every `Media` in every usable capture, in capture order.
 *
 * Not deduplicated: the same title legitimately appears in `activity`,
 * `gallery` and `discover`, and *which* capture carries a bad value is part of
 * the evidence — a placeholder in `activity` and a placeholder in `discover`
 * come from different code paths.
 */
function allMedia(set: CaptureSet): MediaSighting[] {
  const out: MediaSighting[] = []
  for (const slug of set.captures.keys()) {
    const state = read(set, slug)
    if (state.kind === 'ok') {
      walk(state.json, state.capture, '', out, 0)
    }
  }
  return out
}

/** How many captures answered 2xx with parseable JSON. */
function usableCount(set: CaptureSet): number {
  return [...set.captures.keys()].filter(slug => read(set, slug).kind === 'ok')
    .length
}

/**
 * "Nothing was captured" and "everything captured was empty" are the two ways
 * a media check ends up with no subject, and they mean opposite things. The
 * first is a run that did not happen — `SKIPPED`. The second is a real,
 * legitimate answer from a library with nothing in it — a **hollow** pass, so
 * it stays green without being counted as coverage.
 */
function noMediaResult(set: CaptureSet): SpotCheckResult {
  const usable = usableCount(set)
  return usable === 0
    ? skip('no usable capture in this directory', [
        'Not one route answered 2xx with parseable JSON, so this check never ' +
          'ran. Read the Routes section above for why.',
      ])
    : hollowPass(`no media in ${plural(usable, 'usable capture')}`, [
        `${plural(usable, 'capture')} parsed and not one carried a Media ` +
          'object. An empty library is a legitimate state of the world — but ' +
          'this row verified nothing.',
      ])
}

/** `"Following" (tmdb:11660) — discover → items[3]`. */
function describeSighting(sighting: MediaSighting): string {
  return `"${sighting.title}" (${sighting.id}) — ${sighting.capture.slug} → ${sighting.where}`
}

/**
 * The shared shape of every media-wide check: walk the sightings, keep the
 * ones that matter, report. Distinguishing "no capture held any media at all"
 * (skip) from "media were examined and none carried the field" (hollow pass)
 * from "N examined, M bad" is the whole reason this is factored out — getting
 * that wrong in nine places is how a board ends up 80% green and 0% verified.
 */
function overMedia(
  set: CaptureSet,
  options: {
    /** Which sightings this check applies to at all. */
    subject: (sighting: MediaSighting) => boolean
    /** Singular, e.g. `movie with a runtime`. */
    subjectName: string
    /** Plural, spelled out — `${subjectName}s` mangles most of these. */
    subjectPlural: string
    /** The problem with this sighting, or `undefined` if there is none. */
    problem: (sighting: MediaSighting) => string | undefined
    /** Appended to a failure after the offender lines. */
    caveat: (offenders: readonly MediaSighting[]) => readonly string[]
  },
): SpotCheckResult {
  const sightings = allMedia(set)
  if (sightings.length === 0) {
    return noMediaResult(set)
  }

  const subjects = sightings.filter(options.subject)
  if (subjects.length === 0) {
    return hollowPass(
      `no ${options.subjectPlural} among ${plural(sightings.length, 'media object')}`,
      [
        `${plural(sightings.length, 'media object')} were examined and none ` +
          `was ${options.subjectName}, so this check proved nothing. That is ` +
          'a fact about the library, not about the code.',
      ],
    )
  }

  const offenders: MediaSighting[] = []
  const lines: string[] = []
  for (const sighting of subjects) {
    const problem = options.problem(sighting)
    if (problem !== undefined) {
      offenders.push(sighting)
      lines.push(`${describeSighting(sighting)}  ${problem}`)
    }
  }

  if (offenders.length === 0) {
    return pass(
      `${plural(subjects.length, options.subjectName, options.subjectPlural)} checked`,
    )
  }

  return fail(
    `${offenders.length} of ${plural(
      subjects.length,
      options.subjectName,
      options.subjectPlural,
    )}`,
    [...truncate(lines), ...options.caveat(offenders)],
  )
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * The one conversion in the codebase, and the one that a mocked test can
 * never verify: the fixture author writes whichever number makes the
 * assertion pass.
 */
const runtimeIsSeconds: SpotCheck = {
  id: 'media.runtime-is-seconds',
  describe:
    'A movie runtime is seconds, not minutes — toMovie() multiplies Radarr’s ' +
    `minutes by 60, so anything under ${MOVIE_RUNTIME_FLOOR_SECONDS}s on a ` +
    'feature is suspect',
  run: set =>
    overMedia(set, {
      // Catalogue sources are excluded, and that is the whole point of this
      // filter. Proven live 2026-08-27: `/movies/search?query=The Matrix`
      // returns `tmdb:1386216` and `tmdb:1502836` — 4-minute short films that
      // merely match the string — alongside the real feature. Flooring an
      // arbitrary TMDB search result at 300s reports a correct mapper as
      // broken, and a check that cries wolf is worse than no check. Held
      // titles are the only population where "under 5 minutes" is genuinely
      // suspicious.
      subject: sighting =>
        sighting.type === 'movie' &&
        idProvenance(sighting.capture.slug) !== 'catalogue' &&
        (asNumber(sighting.media.runtime) ?? 0) > 0,
      subjectName: 'held movie with a runtime',
      subjectPlural: 'held movies with a runtime',
      problem: sighting => {
        const runtime = asNumber(sighting.media.runtime) ?? 0
        if (runtime >= MOVIE_RUNTIME_FLOOR_SECONDS) {
          return undefined
        }
        const asMinutes = (runtime / 60).toFixed(1)
        const ifMinutes = runtime * 60
        return (
          `runtime: ${runtime} (= ${asMinutes} min if seconds; ` +
          `= ${ifMinutes}s / ${runtime} min if the * 60 was lost)`
        )
      },
      caveat: () => [
        'This cannot tell you which is wrong. Every value above is equally ' +
          'consistent with (a) a lost `* 60` in toMovie() ' +
          '(src/media/radarr.service.ts:123), (b) a genuinely short film, ' +
          'and (c) Radarr changing what it reports. Look up one of the ' +
          'titles above and compare its real length.',
        'Shows are excluded from this check on purpose: toShow() maps the ' +
          'per-episode runtime, so a short-form series is legitimately below ' +
          'the floor.',
      ],
    }),
}

/**
 * `0` is the Radarr/Sonarr SDKs' "not in the library", returned instead of an
 * absent field — which is exactly why the mappers guard with `|| undefined`
 * rather than `?? undefined`. A `0` reaching the wire means that guard was
 * weakened back to a nullish one.
 */
const libraryIdsNeverZero: SpotCheck = {
  id: 'media.ids-never-zero',
  describe:
    'radarrId/sonarrId/tmdbId/tvdbId are never 0 — 0 is the SDK’s ' +
    '"not in the library", which the mappers guard with `|| undefined`',
  run: set =>
    overMedia(set, {
      subject: sighting => sighting.type !== 'video',
      subjectName: 'movie/show',
      subjectPlural: 'movies and shows',
      problem: sighting => {
        const zeroed = ['radarrId', 'sonarrId', 'tmdbId', 'tvdbId'].filter(
          field => asNumber(sighting.media[field]) === 0,
        )
        return zeroed.length === 0 ? undefined : `${zeroed.join(', ')} = 0`
      },
      caveat: offenders => {
        const library = offenders.some(
          sighting =>
            asNumber(sighting.media.radarrId) === 0 ||
            asNumber(sighting.media.sonarrId) === 0,
        )
        const catalogue = offenders.some(
          sighting =>
            asNumber(sighting.media.tmdbId) === 0 ||
            asNumber(sighting.media.tvdbId) === 0,
        )
        return [
          ...(library
            ? [
                'A radarrId/sonarrId of 0 claims the title is in the library ' +
                  'under id 0. toMovie()/toShow() use `movie.id || undefined` ' +
                  'precisely to stop that (radarr.service.ts:118, ' +
                  'sonarr.service.ts:163) — check whether that became `??`.',
              ]
            : []),
          ...(catalogue
            ? [
                'A tmdbId/tvdbId of 0 comes from the mappers’ own ' +
                  '`movie.tmdbId ?? 0` default, so it means the upstream sent ' +
                  'a record with no catalogue id at all — a real upstream ' +
                  'record worth looking at, not necessarily a code bug.',
              ]
            : []),
        ]
      },
    }),
}

/**
 * `MediaResolverService` never throws — a failed lookup becomes a `Media`
 * whose title *is* its own key, so a list endpoint degrades one card instead
 * of failing the page. Useful behaviour; also completely invisible unless
 * something looks for it.
 */
const noPlaceholderMedia: SpotCheck = {
  id: 'media.no-placeholders',
  describe:
    'No Media whose title equals its id — that is the degraded placeholder ' +
    'MediaResolverService emits when a lookup fails',
  run: set =>
    overMedia(set, {
      subject: () => true,
      subjectName: 'media object',
      subjectPlural: 'media objects',
      problem: sighting => {
        if (sighting.title === sighting.id) {
          return 'title === id — this is the resolver placeholder'
        }
        if (
          sighting.type === 'video' &&
          asString(sighting.media.sourceUrl) === undefined &&
          'sourceUrl' in sighting.media
        ) {
          return 'empty sourceUrl — the video placeholder’s other signature'
        }
        return undefined
      },
      caveat: () => [
        'A placeholder is written by resolveMovies()/resolveShows()/' +
          'resolveVideos() (src/media/media-resolver.service.ts:149-265) when ' +
          'the per-id lookup throws or the videos row is missing. The service ' +
          'logs a warning each time — grep the container log for ' +
          '"returning a placeholder" to see which of the three paths fired.',
        ...['radarr', 'sonarr'].map(name => upstreamEvidence(set, name)),
      ],
    }),
}

/**
 * `EMBY_URL` is the container-internal API address; `EMBY_EXTERNAL_URL` is
 * what a browser can reach. Both are strings, both parse, and only one works
 * where it matters.
 */
const watchUrlIsExternal: SpotCheck = {
  id: 'emby.watch-url-is-external',
  describe:
    'embyStatus.watchUrl is built from EMBY_EXTERNAL_URL, not the ' +
    'container-internal EMBY_URL — a dotless host is a Docker service name',
  run: set => {
    const sightings = allMedia(set)
    const links: Array<{ sighting: MediaSighting; url: string }> = []
    for (const sighting of sightings) {
      const url = asString(asRecord(sighting.media.embyStatus)?.watchUrl)
      if (url !== undefined) {
        links.push({ sighting, url })
      }
    }

    if (sightings.length === 0) {
      return noMediaResult(set)
    }
    if (links.length === 0) {
      return hollowPass(
        `no watchUrl among ${plural(sightings.length, 'media object')}`,
        [
          'Emby only annotates titles with a file on disk, and only ' +
            '`state: "indexed"` ever carries a watchUrl ' +
            '(src/emby/emby-status.service.ts:170-176). No link was returned, ' +
            'so nothing here was verified — which is also what an empty ' +
            'library, or an unreachable Emby, looks like.',
        ],
      )
    }

    const lines: string[] = []
    const origins = new Set<string>()
    for (const { sighting, url } of links) {
      const problem = watchUrlProblem(url)
      if (problem === undefined) {
        origins.add(safeOrigin(url) ?? url)
      } else {
        lines.push(`${describeSighting(sighting)}  ${url} — ${problem}`)
      }
    }

    if (lines.length === 0) {
      return pass(
        `${plural(links.length, 'watch link')} · ${[...origins].join(', ')}`,
      )
    }

    return fail(`${lines.length} of ${plural(links.length, 'watch link')}`, [
      ...truncate(lines),
      'buildWatchUrl() (src/emby/emby-status.service.ts:184) composes ' +
        'EMBY_EXTERNAL_URL, read once at construction. A container-internal ' +
        'host here means that variable holds EMBY_URL’s value in the running ' +
        'deployment — an env problem, not a code one, and invisible to every ' +
        'test because the tests supply the variable.',
      `Origins that did look browser-reachable: ${
        origins.size === 0 ? 'none' : [...origins].join(', ')
      }`,
    ])
  },
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function watchUrlProblem(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'not a parseable absolute URL'
  }

  const host = parsed.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return `host "${host}" resolves to whichever machine opens the link, not to Emby`
  }
  if (!host.includes('.')) {
    return `host "${host}" has no dot — that is a Docker service name, reachable only from inside the network`
  }
  return undefined
}

/**
 * `SeriesResource.path` is the series *directory*; `MovieResource.movieFile
 * .path` is a file. The two are the same field name on the wire and mean
 * different things, which is exactly the kind of thing that quietly swaps.
 */
const showFilePathIsFolder: SpotCheck = {
  id: 'show.file-path-is-a-folder',
  describe:
    'A Show.filePath is the series folder (SeriesResource.path), never a ' +
    'media file',
  run: set =>
    overMedia(set, {
      subject: sighting =>
        sighting.type === 'show' &&
        asString(sighting.media.filePath) !== undefined,
      subjectName: 'show with a filePath',
      subjectPlural: 'shows with a filePath',
      problem: sighting => {
        const filePath = asString(sighting.media.filePath) ?? ''
        const extension = MEDIA_FILE_EXTENSIONS.find(candidate =>
          filePath.toLowerCase().endsWith(candidate),
        )
        return extension === undefined
          ? undefined
          : `filePath: ${filePath} — ends in ${extension}, so this is a file, not the series directory`
      },
      caveat: () => [
        'toShow() maps `series.path` (src/media/sonarr.service.ts:155). A ' +
          'media file here means it now maps an episode file instead — which ' +
          'would also silently change what EmbyStatusService matches against, ' +
          'since it indexes movies by file path and shows by folder path.',
      ],
    }),
}

/** The inverse of the above, and the same swap seen from the other side. */
const movieFilePathIsFile: SpotCheck = {
  id: 'movie.file-path-is-a-file',
  describe:
    'A Movie.filePath is the media file (movieFile.path), never a bare folder',
  run: set =>
    overMedia(set, {
      subject: sighting =>
        sighting.type === 'movie' &&
        asString(sighting.media.filePath) !== undefined,
      subjectName: 'movie with a filePath',
      subjectPlural: 'movies with a filePath',
      problem: sighting => {
        const filePath = asString(sighting.media.filePath) ?? ''
        const looksLikeFile = MEDIA_FILE_EXTENSIONS.some(candidate =>
          filePath.toLowerCase().endsWith(candidate),
        )
        return looksLikeFile
          ? undefined
          : `filePath: ${filePath} — no media-file extension, so this looks like a folder`
      },
      caveat: () => [
        'toMovie() maps `movie.movieFile?.path` and only when `hasFile` ' +
          '(src/media/radarr.service.ts:111). A folder here would break ' +
          'EmbyStatusService’s path index for movies, which keys on the file.',
        `Recognised extensions: ${MEDIA_FILE_EXTENSIONS.join(' ')}. An ` +
          'unrecognised-but-legitimate container would also land here — check ' +
          'the path before believing the verdict.',
      ],
    }),
}

/**
 * `state: 'indexed'` is the only state that carries a link, and it always
 * carries one. The schema types both fields optional because the other two
 * states have neither, so this invariant lives here or nowhere.
 */
const embyIndexedCarriesLink: SpotCheck = {
  id: 'emby.indexed-carries-a-link',
  describe:
    'embyStatus.state === "indexed" always carries both itemId and watchUrl; ' +
    'the other two states carry neither',
  run: set =>
    overMedia(set, {
      subject: sighting => asRecord(sighting.media.embyStatus) !== undefined,
      subjectName: 'media with an embyStatus',
      subjectPlural: 'media with an embyStatus',
      problem: sighting => {
        const status = asRecord(sighting.media.embyStatus) ?? {}
        const state = asString(status.state)
        const itemId = asString(status.itemId)
        const watchUrl = asString(status.watchUrl)

        if (state === 'indexed') {
          const missing = [
            itemId === undefined ? 'itemId' : undefined,
            watchUrl === undefined ? 'watchUrl' : undefined,
          ].filter((field): field is string => field !== undefined)
          return missing.length === 0
            ? undefined
            : `state: indexed but missing ${missing.join(' and ')}`
        }

        const extra = [
          itemId === undefined ? undefined : 'itemId',
          watchUrl === undefined ? undefined : 'watchUrl',
        ].filter((field): field is string => field !== undefined)
        return extra.length === 0
          ? undefined
          : `state: ${state ?? '(absent)'} but carries ${extra.join(' and ')}`
      },
      caveat: () => [
        'The table in EmbyStatusService.annotate() ' +
          '(src/emby/emby-status.service.ts:105-112) is the contract: ' +
          'indexed → {itemId, watchUrl}, indexing → {}, unknown → {}. Both ' +
          'fields are optional in EmbyStatusSchema because two of the three ' +
          'states have neither, so a parse cannot catch this.',
      ],
    }),
}

/**
 * An empty `degradedSources` is the explicit "both upstreams answered" signal.
 * A non-empty one is a page that rendered fine while silently missing half its
 * results — the failure mode this whole script exists to surface.
 */
const discoverNotDegraded: SpotCheck = {
  id: 'discover.degraded-sources-empty',
  describe:
    'GET /download/discover reports degradedSources: [] — a non-empty array ' +
    'is an upstream that failed while the page still rendered 200',
  run: set => {
    const slugs = READ_ROUTES.filter(spec =>
      spec.path.startsWith('/download/discover'),
    ).map(spec => spec.slug)

    const usable: Array<{
      slug: string
      json: Record<string, unknown>
      capture: Capture
    }> = []
    const unusable: string[] = []
    for (const slug of slugs) {
      const state = read(set, slug)
      if (state.kind === 'ok') {
        usable.push({ slug, json: state.json, capture: state.capture })
      } else {
        unusable.push(state.reason)
      }
    }

    if (usable.length === 0) {
      return skip('no usable /discover capture', [
        ...unusable,
        'Nothing was learned about upstream health from this route. ' +
          '_health.json is the only other evidence this run carries:',
        ...['radarr', 'sonarr'].map(name => upstreamEvidence(set, name)),
      ])
    }

    const failures: string[] = []
    const degradedUpstreams = new Set<string>()
    const observations: string[] = []
    let badPages = 0

    for (const { slug, json, capture } of usable) {
      const sources = asArray(json.degradedSources)
      if (sources === undefined) {
        badPages += 1
        failures.push(
          `${slug}: no degradedSources field at all — the discovery envelope ` +
            'always carries one (discovery.service.ts:185)',
        )
        continue
      }
      if (sources.length > 0) {
        badPages += 1
        const named = sources.map(source => String(source))
        failures.push(
          `${slug}: degradedSources: [${named.join(', ')}]`,
          ...provenance(capture),
        )
        for (const source of named) {
          const upstream = DEGRADED_SOURCE_UPSTREAMS[source]
          if (upstream) {
            degradedUpstreams.add(upstream)
          }
        }
      }
      if ((asArray(json.items) ?? []).length === 0) {
        observations.push(
          `${slug}: the page carried no items at all, for the manifest's ` +
            'fixed long-established query — worth a look even though it is ' +
            'not what this check asserts.',
        )
      }
    }

    if (badPages === 0) {
      return pass(
        `${plural(usable.length, 'discovery page')}, both upstreams answered`,
        observations,
      )
    }

    return fail(`${plural(badPages, 'degraded discovery page')}`, [
      ...failures,
      ...observations,
      'DiscoveryService.search() pushes a source here only when its ' +
        'Promise.allSettled arm rejected (src/media/discovery.service.ts:' +
        '119-131); it logs the underlying error and answers 200 anyway. The ' +
        'response cannot tell you which it was — the container log can.',
      ...[...degradedUpstreams].map(name => upstreamEvidence(set, name)),
      'If the upstream above was not `answered`, read this as an environment ' +
        'finding rather than a code one. If it was healthy, the swallowed ' +
        'error is in the client or the credentials, not in the network.',
    ])
  },
}

/**
 * The audit `action` column is a closed vocabulary precisely so a filter over
 * it cannot silently drop rows. A value outside it means either a writer that
 * skipped the shared constant or a historical row from a vocabulary that has
 * since changed.
 */
const auditActionsKnown: SpotCheck = {
  id: 'audit.actions-are-known',
  describe: `Every audit action is one of the ${AUDIT_ACTIONS.length} members of AUDIT_ACTIONS`,
  run: set => {
    const slugs = READ_ROUTES.filter(spec =>
      spec.path.startsWith('/download/admin/audit-log'),
    ).map(spec => spec.slug)

    const rows: Array<{ capture: Capture; where: string; action: unknown }> = []
    const unusable: string[] = []

    for (const slug of slugs) {
      const state = read(set, slug)
      if (state.kind !== 'ok') {
        unusable.push(state.reason)
        continue
      }
      const items = asArray(state.json.items) ?? []
      items.forEach((item, index) => {
        rows.push({
          capture: state.capture,
          where: `items[${index}]`,
          action: asRecord(item)?.action,
        })
      })
    }

    if (rows.length === 0) {
      return unusable.length === slugs.length
        ? skip('no usable audit-log capture', unusable)
        : hollowPass('the audit log came back empty', [
            'A 200 with no rows. Nothing was verified — which is also what a ' +
              'service that has never been written to looks like.',
          ])
    }

    const known = new Set<string>(AUDIT_ACTIONS)
    const lines: string[] = []
    for (const row of rows) {
      const action = asString(row.action)
      if (action === undefined || !known.has(action)) {
        lines.push(
          `${row.capture.slug} → ${row.where}: action = ${JSON.stringify(
            row.action,
          )}`,
        )
      }
    }

    if (lines.length === 0) {
      return pass(`${plural(rows.length, 'audit row')} checked`)
    }

    return fail(`${lines.length} of ${plural(rows.length, 'audit row')}`, [
      ...truncate(lines),
      `AUDIT_ACTIONS (packages/utils/src/download/schema.ts:591) is: ${AUDIT_ACTIONS.join(', ')}.`,
      'The list is append-only in practice — rows keep whatever value they ' +
        'were written with — so an unknown action is either a writer that ' +
        'bypassed the constant or a member that was removed from it.',
    ])
  },
}

/**
 * `windowDays` is the response saying which series it describes. If it stops
 * echoing the request, every chart drawn from it is mislabelled and nothing
 * else in the payload says so.
 */
const adminStatsWindow: SpotCheck = {
  id: 'admin.window-days-echoes-request',
  describe:
    'AdminStatsResponse.windowDays echoes the requested ?days= — the manifest ' +
    'asks for a non-default value so an ignored param cannot pass',
  run: set => {
    const state = read(set, 'admin-stats')
    if (state.kind !== 'ok') {
      return skip(state.reason)
    }

    const requested = requestedNumber(state.capture, 'days')
    if (requested === undefined) {
      return hollowPass('the capture recorded no ?days=', [
        'Without the request there is nothing to compare the echo against. ' +
          `The response said windowDays: ${String(state.json.windowDays)}.`,
        ...provenance(state.capture),
      ])
    }

    const echoed = asNumber(state.json.windowDays)
    if (echoed === requested) {
      return pass(`windowDays: ${echoed} === requested days: ${requested}`)
    }

    return fail(
      `windowDays: ${String(state.json.windowDays)} ≠ days: ${requested}`,
      [
        `The request asked for ${requested} days; the response describes a ` +
          `${String(state.json.windowDays)}-day window.`,
        'AdminStatsService.getStats() sets `windowDays: query.days` directly ' +
          '(src/admin/admin-stats.service.ts:89), and AdminStatsQuerySchema ' +
          'clamps days to 1..365 and defaults it to 30 — so a response of 30 ' +
          'here usually means the query never reached the service.',
        ...provenance(state.capture),
      ],
    )
  },
}

/**
 * The leaderboard's `.slice()`, and the arithmetic that makes the panel's
 * headline number and its breakdown incapable of disagreeing. Neither is in
 * the schema; both are one edit away from being lost.
 */
const adminStatsInvariants: SpotCheck = {
  id: 'admin.stats-internally-consistent',
  describe:
    `topRequesters is capped at ${TOP_REQUESTERS_LIMIT} and sorted by count ` +
    'descending, and totalsByStatus sums to totalJobs',
  run: set => {
    const state = read(set, 'admin-stats')
    if (state.kind !== 'ok') {
      return skip(state.reason)
    }

    const requesters = asArray(state.json.topRequesters) ?? []
    const byStatus = asArray(state.json.totalsByStatus) ?? []
    const totalJobs = asNumber(state.json.totalJobs)
    const problems: string[] = []

    if (requesters.length > TOP_REQUESTERS_LIMIT) {
      problems.push(
        `topRequesters carries ${requesters.length} rows, over the ` +
          `${TOP_REQUESTERS_LIMIT}-row cap that rankRequesters() applies with ` +
          '.slice(0, TOP_REQUESTERS_LIMIT) (admin-stats.service.ts:114).',
      )
    }

    const counts = requesters.map(row => asNumber(asRecord(row)?.count) ?? -1)
    const descending = counts.every(
      (count, index) => index === 0 || count <= (counts[index - 1] ?? count),
    )
    if (!descending) {
      problems.push(
        `topRequesters is not ordered by count descending: [${counts.join(', ')}]. ` +
          'rankRequesters() sorts by count then email precisely so the cut at ' +
          'the limit is deterministic — an unsorted list means the 20 rows ' +
          'shown are not the top 20.',
      )
    }

    const summed = byStatus.reduce<number>(
      (total, row) => total + (asNumber(asRecord(row)?.count) ?? 0),
      0,
    )
    if (totalJobs === undefined) {
      problems.push('totalJobs is absent or not a number.')
    } else if (byStatus.length > 0 && summed !== totalJobs) {
      problems.push(
        `totalsByStatus sums to ${summed} but totalJobs is ${totalJobs}. ` +
          'Both run over the same unfiltered set (allTimeFilter, ' +
          'admin-stats.service.ts:78-88) and a job has exactly one status, ' +
          'so the two are the same population counted twice — unless a job ' +
          'was written between the two queries, which a live capture can do.',
      )
    }

    if (problems.length > 0) {
      return fail(`${plural(problems.length, 'broken invariant')}`, [
        ...problems,
        ...provenance(state.capture),
      ])
    }

    if (requesters.length === 0 && byStatus.length === 0) {
      return hollowPass('the stats payload is empty', [
        `totalJobs: ${String(state.json.totalJobs)}, with no requesters and ` +
          'no status rows. Every invariant here held vacuously.',
      ])
    }

    return pass(
      `${plural(requesters.length, 'requester')} (cap ${TOP_REQUESTERS_LIMIT}), ` +
        `${plural(byStatus.length, 'status row')} summing to ${summed}`,
    )
  },
}

/**
 * The route catches its own failure and answers `{version: 'error'}` with a
 * **200**, which is deliberately outside the schema: rejecting it would report
 * a successful request as contract drift. So it is reported here instead,
 * where it can say what it actually means.
 */
const ytdlpVersionNotError: SpotCheck = {
  id: 'ytdlp.version-is-not-the-error-sentinel',
  describe:
    'GET /api/ytdlp-update/version does not answer { version: "error" } — the ' +
    'handler’s 200-with-a-sentinel failure path',
  run: set => {
    const state = read(set, 'ytdlp-version')
    if (state.kind !== 'ok') {
      return skip(state.reason)
    }

    const version = asString(state.json.version)
    if (version === undefined) {
      return fail('no version string in the response', [
        `body: ${JSON.stringify(state.json).slice(0, 200)}`,
        ...provenance(state.capture),
      ])
    }
    if (version !== 'error') {
      return pass(`version: ${version}`)
    }

    return fail('version: "error"', [
      'YtdlpUpdateController.getCurrentVersion() ' +
        '(src/ytdlp-update/ytdlp-update.controller.ts:80-86) catches its own ' +
        'failure and returns { version: "error" } with HTTP 200. So the ' +
        'request succeeded and the yt-dlp binary could not be interrogated — ' +
        'a missing binary, a broken install, or a spawn that timed out.',
      'Nothing else on this surface reports that, and the 200 means no ' +
        'monitor would either.',
      ...provenance(state.capture),
    ])
  },
}

// ---------------------------------------------------------------------------
// Cursor round-trip — one check per paginated route
// ---------------------------------------------------------------------------

/**
 * The identity of a list row.
 *
 * Three shapes appear across the paginated routes and only two have an `id`:
 * a `DownloadJob` has a nanoid, an `AuditLogEntry` has an integer, a
 * `GalleryItem` has none at all and is identified by the media it groups. A
 * discovery item *is* a `Media`, so its own `id` is the key.
 */
function rowIdentity(item: unknown): string | undefined {
  const record = asRecord(item)
  if (!record) {
    return undefined
  }
  if (typeof record.id === 'string' && record.id !== '') {
    return record.id
  }
  if (typeof record.id === 'number') {
    return String(record.id)
  }
  return asString(asRecord(record.media)?.id)
}

/** The `limit` this pair was actually issued with, off the recorded path. */
function requestedNumber(capture: Capture, param: string): number | undefined {
  const resolved = asString(capture.meta.resolvedPath)
  const fromPath = resolved?.includes('?')
    ? new URLSearchParams(resolved.slice(resolved.indexOf('?') + 1)).get(param)
    : undefined
  const raw = fromPath ?? capture.spec.query?.[param]
  if (raw === undefined || raw === null || raw.trim() === '') {
    return undefined
  }
  const parsed = Number(raw)
  return Number.isInteger(parsed) ? parsed : undefined
}

/**
 * Page 2, fetched with page 1's own `nextCursor`, against page 1.
 *
 * Four things are asserted, and each maps to a line of production code rather
 * than to a hunch:
 *
 * - **`total` is identical.** Every producer computes it over the *filtered*
 *   set, not over what remains after the cursor, so it does not move between
 *   pages of one query.
 * - **No overlap.** A keyset cursor carries the last row's sort key and id
 *   (`encodeListCursor`); an offset cursor carries the offset. Either way a
 *   row cannot appear on both pages.
 * - **Page 1 was full.** `hasMore` is only set when the fetch of `limit + 1`
 *   came back over-full (`src/db/jobs.repo.ts:138`), and discovery's is
 *   `offset + limit < results.length` (`discovery-ranking.ts:197`). A short
 *   page that still minted a cursor means rows vanished between the count and
 *   the read.
 * - **Nothing fell in the gap.** When page 2 ends the set (`nextCursor:
 *   null`), the two pages must account for exactly `total` rows.
 *
 * Every one of these can also be explained by a write landing between the two
 * requests — this runs against a live service — so the failure says so
 * instead of pretending otherwise.
 */
function cursorRoundTrip(page2Spec: RouteSpec): SpotCheck {
  const page1Slug = page2Spec.cursorFrom ?? ''
  return {
    id: `cursor.${page1Slug}`,
    describe:
      `Page 2 of ${page2Spec.path}, fetched with page 1's nextCursor, ` +
      'overlaps page 1 in nothing, leaves no gap, and reports the same total',
    run: set => {
      const first = read(set, page1Slug)
      const second = read(set, page2Spec.slug)

      if (first.kind !== 'ok') {
        return skip(first.reason)
      }
      if (second.kind !== 'ok') {
        return skip(second.reason, [
          'Page 1 was captured; page 2 was not, so the round trip was never ' +
            'exercised. A page-1 nextCursor of null is the ordinary reason — ' +
            'the whole result set fit on one page.',
          ...provenance(first.capture),
        ])
      }

      const items1 = asArray(first.json.items)
      const items2 = asArray(second.json.items)
      if (items1 === undefined || items2 === undefined) {
        return fail('one of the two pages has no items array', [
          `${page1Slug}: items is ${typeof first.json.items}`,
          `${page2Spec.slug}: items is ${typeof second.json.items}`,
        ])
      }

      const total1 = asNumber(first.json.total)
      const total2 = asNumber(second.json.total)
      const limit = requestedNumber(first.capture, 'limit')
      const ids1 = items1.map(rowIdentity)
      const ids2 = items2.map(rowIdentity)
      const unidentified =
        ids1.filter(id => id === undefined).length +
        ids2.filter(id => id === undefined).length

      const problems: string[] = []

      if (total1 !== total2) {
        problems.push(
          `total moved between the pages: ${String(first.json.total)} → ` +
            `${String(second.json.total)}. total is the size of the filtered ` +
            'set and is meant to be identical on every page of one query.',
        )
      }

      const set1 = new Set(ids1.filter((id): id is string => id !== undefined))
      const overlap = ids2.filter(
        (id): id is string => id !== undefined && set1.has(id),
      )
      if (overlap.length > 0) {
        problems.push(
          `page 2 repeats ${plural(overlap.length, 'row')} from page 1: ` +
            `${[...new Set(overlap)].slice(0, MAX_OFFENDERS_SHOWN).join(', ')}`,
        )
      }

      const duplicates = [...findDuplicates(ids1), ...findDuplicates(ids2)]
      if (duplicates.length > 0) {
        problems.push(
          `${plural(duplicates.length, 'id')} repeated within a single ` +
            'page: ' +
            `${duplicates.slice(0, MAX_OFFENDERS_SHOWN).join(', ')}`,
        )
      }

      if (limit !== undefined && items1.length !== limit) {
        problems.push(
          `page 1 minted a cursor but returned ${items1.length} of a ` +
            `requested ${limit} rows. A cursor is only minted when the page ` +
            'came back full, so a short page with a cursor points at rows ' +
            'disappearing between the count and the read.',
        )
      }

      const seen = items1.length + items2.length
      if (total1 !== undefined && seen > total1) {
        problems.push(
          `the two pages carry ${seen} rows but total is ${total1} — more ` +
            'rows were served than the query says exist.',
        )
      }
      const lastPage = second.json.nextCursor === null
      if (lastPage && total1 !== undefined && seen !== total1) {
        problems.push(
          `page 2 ends the set (nextCursor: null) but the two pages account ` +
            `for ${seen} of ${total1} rows — ${total1 - seen} unaccounted for.`,
        )
      }

      if (problems.length > 0) {
        return fail(`${plural(problems.length, 'problem')}`, [
          ...problems,
          ...(unidentified > 0
            ? [
                `${unidentified} row(s) carried no id or media.id, so the ` +
                  'overlap comparison did not see them.',
              ]
            : []),
          'This runs against a live service: a job created or deleted between ' +
            'the two requests reproduces every symptom above. Re-run the ' +
            'capture before reading this as a pagination bug.',
          ...provenance(first.capture),
          ...provenance(second.capture),
        ])
      }

      if (items1.length === 0 && items2.length === 0) {
        return hollowPass('both pages came back empty', [
          'A cursor was followed and neither page carried a row, so nothing ' +
            'about the round trip was actually exercised.',
        ])
      }

      return pass(
        `${items1.length} + ${items2.length} of ${String(first.json.total)} rows, ` +
          `no overlap${lastPage ? ', page 2 ends the set' : ''}`,
        unidentified > 0
          ? [
              `${unidentified} row(s) carried no id or media.id and were left ` +
                'out of the overlap comparison.',
            ]
          : undefined,
      )
    },
  }
}

function findDuplicates(ids: ReadonlyArray<string | undefined>): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const id of ids) {
    if (id === undefined) {
      continue
    }
    if (seen.has(id)) {
      duplicated.add(id)
    }
    seen.add(id)
  }
  return [...duplicated]
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Every semantic check `check` mode runs, in the order they are reported.
 *
 * The cursor checks are generated from the manifest rather than listed, so a
 * paginated route that gains a `cursorFrom` follow-up spec gains a round-trip
 * check for free — and, more to the point, cannot gain one without it.
 */
export const SPOT_CHECKS: SpotCheck[] = [
  runtimeIsSeconds,
  libraryIdsNeverZero,
  noPlaceholderMedia,
  watchUrlIsExternal,
  embyIndexedCarriesLink,
  showFilePathIsFolder,
  movieFilePathIsFile,
  discoverNotDegraded,
  ...READ_ROUTES.filter(spec => spec.cursorFrom !== undefined).map(
    cursorRoundTrip,
  ),
  auditActionsKnown,
  adminStatsWindow,
  adminStatsInvariants,
  ytdlpVersionNotError,
]
