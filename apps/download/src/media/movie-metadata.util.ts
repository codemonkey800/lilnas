import type {
  CreditResource,
  Language,
  MediaInfoResource,
  MovieFileResource,
  MovieResource,
  RatingChild,
} from '@lilnas/media/radarr'
import type {
  CastCredit,
  MediaCredits,
  MovieFile,
  MovieRating,
  MovieRatings,
} from '@lilnas/utils/download/types'

/**
 * How many actors the detail page is handed. `CastRow` draws four and folds
 * the rest into a `+N more` whose `title` lists them, so this bounds that
 * tooltip rather than the row.
 */
export const CAST_CREDIT_LIMIT = 20

/**
 * TMDb's crew jobs that credit the script. `department === 'Writing'` alone
 * would also pull in `Novel` and `Characters`, which credit the source
 * material rather than the film.
 */
const WRITING_JOBS: ReadonlySet<string> = new Set([
  'Screenplay',
  'Story',
  'Writer',
])

/**
 * ISO 639-2 codes that name no language - `und`efined, `zxx` (no linguistic
 * content), `mis`/`mul`. `Intl.DisplayNames` answers `und` with `root`, which
 * is worse than saying nothing.
 */
const NON_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'mis',
  'mul',
  'und',
  'zxx',
])

/**
 * Radarr asks TMDb for the `original` rendition - often several megabytes for
 * a 30px circle. `w185` is TMDb's smallest profile size.
 */
const TMDB_ORIGINAL_SEGMENT = '/t/p/original/'
const TMDB_HEADSHOT_SEGMENT = '/t/p/w185/'

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' })

/** `''`, `null` and whitespace all mean "upstream did not say". */
function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** `0` is how `mediaInfo` spells "not measured" - never a real reading. */
function positive(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** The same list, or `undefined` in place of an empty one. */
function nonEmpty<T>(values: readonly T[]): T[] | undefined {
  return values.length > 0 ? [...values] : undefined
}

/**
 * One ISO 639-2 code (`eng`, or the bibliographic `fre`/`ger`) as an English
 * display name, or `undefined` for a code that names no language. An unknown
 * code comes back as itself — `Intl.DisplayNames`' own fallback — which is
 * more useful than dropping it.
 */
export function languageName(code: string): string | undefined {
  const normalized = code.trim().toLowerCase()

  if (!normalized || NON_LANGUAGE_CODES.has(normalized)) {
    return undefined
  }

  try {
    return languageNames.of(normalized) ?? normalized
  } catch {
    // `of()` throws a RangeError for anything that is not a well-formed
    // language subtag - `mediaInfo` has been seen to carry free text here.
    return normalized
  }
}

/**
 * `mediaInfo`'s slash-joined codes (`eng/eng/spa`) as distinct display names
 * in stream order - `['English', 'Spanish']`.
 */
export function languageList(
  codes: string | null | undefined,
): string[] | undefined {
  const names = (codes ?? '')
    .split('/')
    .map(languageName)
    .filter((name): name is string => name !== undefined)

  return nonEmpty(unique(names))
}

/** Radarr's own `Language` objects, which already carry a display name. */
function radarrLanguageList(
  languages: readonly Language[] | null | undefined,
): string[] | undefined {
  const names = (languages ?? [])
    .map(language => text(language.name))
    .filter((name): name is string => name !== undefined && name !== 'Unknown')

  return nonEmpty(unique(names))
}

/**
 * `mediaInfo`'s two dynamic-range fields folded into one label. The `Type`
 * field is the specific one (`HDR10`, `DV HDR10`, `HLG`) and wins; the plain
 * field only ever says `HDR`. Both empty on a probed file means SDR — but
 * only when the file *was* probed, which a video codec is the witness for.
 */
function dynamicRange(info: MediaInfoResource): string | undefined {
  return (
    text(info.videoDynamicRangeType) ??
    text(info.videoDynamicRange) ??
    (text(info.videoCodec) ? 'SDR' : undefined)
  )
}

/** Drops every `undefined` key, and the object itself when nothing is left. */
function compact<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(
    ([, entry]) => entry !== undefined,
  )

  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined
}

/**
 * Radarr's `movieFile` + `mediaInfo` flattened into the wire's
 * {@link MovieFile}. `undefined` when there is no file resource at all.
 *
 * Audio languages come from `mediaInfo` (what the streams actually are) and
 * fall back to the file's own `languages` (what Radarr parsed from the release
 * name) only when the file has not been probed.
 *
 * `customFormats` is deliberately not read here: `GET /movie` never computes
 * them for the embedded `movieFile` (Radarr's `MovieController` maps the file
 * without its custom formats), so it is always empty. The detail route reads
 * them from `GET /moviefile` instead - see {@link movieFileCustomFormats}.
 */
export function toMovieFile(
  file: MovieFileResource | null | undefined,
): MovieFile | undefined {
  if (!file) {
    return undefined
  }

  const info = file.mediaInfo ?? {}

  return compact<MovieFile>({
    audio: compact({
      channels: positive(info.audioChannels),
      codec: text(info.audioCodec),
      languages:
        languageList(info.audioLanguages) ?? radarrLanguageList(file.languages),
      streamCount: positive(info.audioStreamCount),
    }),
    edition: text(file.edition),
    quality: text(file.quality?.quality?.name),
    qualityCutoffNotMet: file.qualityCutoffNotMet ?? undefined,
    releaseGroup: text(file.releaseGroup),
    sceneName: text(file.sceneName),
    size: positive(file.size),
    subtitles: languageList(info.subtitles),
    video: compact({
      bitDepth: positive(info.videoBitDepth),
      codec: text(info.videoCodec),
      dynamicRange: dynamicRange(info),
      fps: positive(info.videoFps),
      resolution: text(info.resolution),
    }),
  })
}

/**
 * The custom formats Radarr matched on a movie's file, as distinct names, from
 * `GET /moviefile?movieId=` - the one endpoint that computes them. `undefined`
 * when the file matched none.
 *
 * Radarr models a movie as one file, but the endpoint is a list, so the first
 * file with an id is the one the library is serving (the same pick as
 * `CurrentReleaseService.forMovie()`). Radarr's JSON omits null keys, so a
 * missing `customFormats` reads as none.
 */
export function movieFileCustomFormats(
  files: readonly MovieFileResource[],
): string[] | undefined {
  const file = files.find(entry => entry.id != null)

  return nonEmpty(
    unique(
      (file?.customFormats ?? [])
        .map(format => text(format.name))
        .filter((name): name is string => name !== undefined),
    ),
  )
}

function toRating(rating: RatingChild | undefined): MovieRating | undefined {
  const value = positive(rating?.value)

  if (value === undefined) {
    return undefined
  }

  const votes = positive(rating?.votes)

  return votes === undefined ? { value } : { value, votes }
}

/**
 * Radarr's `ratings`, keeping only the sources that actually scored the
 * movie. Radarr reports an unscored source as `{ value: 0 }` rather than
 * leaving it out.
 */
export function toMovieRatings(
  ratings: MovieResource['ratings'],
): MovieRatings | undefined {
  if (!ratings) {
    return undefined
  }

  return compact<MovieRatings>({
    imdb: toRating(ratings.imdb),
    metacritic: toRating(ratings.metacritic),
    rottenTomatoes: toRating(ratings.rottenTomatoes),
    tmdb: toRating(ratings.tmdb),
    trakt: toRating(ratings.trakt),
  })
}

/**
 * A headshot's TMDb URL at thumbnail size. Only an `https:` URL is kept - this
 * lands in an `<img src>`.
 */
function headshotUrl(credit: CreditResource): string | undefined {
  const remote = text(
    credit.images?.find(image => image.coverType === 'headshot')?.remoteUrl,
  )

  if (!remote?.startsWith('https://')) {
    return undefined
  }

  return remote.replace(TMDB_ORIGINAL_SEGMENT, TMDB_HEADSHOT_SEGMENT)
}

/**
 * Radarr's flat credit list split into what the detail page draws: actors in
 * billing order (capped at {@link CAST_CREDIT_LIMIT}), then directors and
 * writers as distinct names. A person credited twice as the same thing - a
 * writer on both `Screenplay` and `Story` - is listed once.
 */
export function toMediaCredits(
  credits: readonly CreditResource[],
): MediaCredits {
  const cast: CastCredit[] = []
  const castNames = new Set<string>()

  const billed = credits
    .filter(credit => credit.type === 'cast')
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) -
        (b.order ?? Number.MAX_SAFE_INTEGER),
    )

  for (const credit of billed) {
    const name = text(credit.personName)

    if (!name || castNames.has(name)) {
      continue
    }

    castNames.add(name)
    cast.push(
      compact<CastCredit>({
        character: text(credit.character),
        imageUrl: headshotUrl(credit),
        name,
      }) ?? { name },
    )

    if (cast.length === CAST_CREDIT_LIMIT) {
      break
    }
  }

  const crewNames = (keep: (credit: CreditResource) => boolean): string[] =>
    unique(
      credits
        .filter(credit => credit.type === 'crew' && keep(credit))
        .map(credit => text(credit.personName))
        .filter((name): name is string => name !== undefined),
    )

  return {
    cast,
    directors: crewNames(credit => credit.job === 'Director'),
    writers: crewNames(credit => WRITING_JOBS.has(credit.job ?? '')),
  }
}

/** Radarr's `originalLanguage` object as a display name. */
export function originalLanguageName(
  language: Language | undefined,
): string | undefined {
  const name = text(language?.name)
  return name === 'Unknown' ? undefined : name
}
