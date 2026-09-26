import { cns } from '@lilnas/utils/cns'
import type {
  MediaCredits,
  Movie,
  MovieFile,
  MovieRatings,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useId } from 'react'

import { ButtonLink } from 'src/components/ui/button-link'
import { Card } from 'src/components/ui/card'
import { Chip } from 'src/components/ui/chip'
import { formatBytes, UNKNOWN_VALUE } from 'src/lib/format'

export const MOVIE_FILE_HEADING = 'File'
export const MOVIE_DETAILS_HEADING = 'Details'

/**
 * Beside the quality when Radarr's profile would still take a better release -
 * the file is fine to watch, and may be swapped out from under the page.
 */
export const MOVIE_UPGRADE_LABEL = 'upgrade wanted'

export const MOVIE_IMDB_LABEL = 'IMDb'
export const MOVIE_TMDB_LABEL = 'TMDb'
export const MOVIE_TRAILER_LABEL = 'Trailer'

/** `tt` and digits - anything else is not an IMDb title id. */
const IMDB_ID = /^tt\d+$/

/** YouTube's id alphabet. Checked because it lands in an `href`. */
const YOUTUBE_ID = /^[\w-]{6,20}$/

const SEPARATOR = ' · '

/**
 * Upstream dates are midnight UTC (`2012-09-20T00:00:00Z`), so they are read
 * in UTC - in a timezone behind it, local time would print the day before.
 * The locale is pinned for the same reason the zone is: this renders on the
 * server and again in the browser, and the two have to agree.
 */
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

function joined(parts: readonly (string | null | undefined)[]): string | null {
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(SEPARATOR) : null
}

/** `5.1` stays `5.1`; a whole `2` reads as the conventional `2.0`. */
export function formatChannels(channels: number): string {
  return Number.isInteger(channels) ? channels.toFixed(1) : String(channels)
}

/**
 * `23.976 fps`, `24 fps` - never `24.000`. Joined by a no-break space so the
 * unit never wraps away from its number.
 */
function formatFps(fps: number): string {
  return `${Number(fps.toFixed(3))}\u00a0fps`
}

/** `2012-09-20T00:00:00Z` -> `Sep 20, 2012`, or `null` for anything unparseable. */
export function formatReleaseDay(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : DAY_FORMAT.format(date)
}

/** `AVC · 1920×1080 · 8-bit · SDR · 23.976 fps`. */
export function fileVideoLine(file: MovieFile): string | null {
  const video = file.video

  if (!video) {
    return null
  }

  return joined([
    video.codec,
    video.resolution?.replace('x', '×'),
    video.bitDepth ? `${video.bitDepth}-bit` : null,
    video.dynamicRange,
    video.fps ? formatFps(video.fps) : null,
  ])
}

/** `DTS-HD MA 5.1 · English, Spanish · 2 tracks`. */
export function fileAudioLine(file: MovieFile): string | null {
  const audio = file.audio

  if (!audio) {
    return null
  }

  const codec = joinWords(
    audio.codec,
    audio.channels ? formatChannels(audio.channels) : undefined,
  )

  return joined([
    codec,
    audio.languages?.join(', '),
    audio.streamCount && audio.streamCount > 1
      ? `${audio.streamCount} tracks`
      : null,
  ])
}

function joinWords(...words: (string | undefined)[]): string | null {
  const present = words.filter(Boolean)
  return present.length > 0 ? present.join(' ') : null
}

/**
 * Every source that scored the movie, each on its own scale:
 * `['IMDb 7.6', 'Rotten Tomatoes 85%', 'Metacritic 68', 'TMDb 7.4']`.
 * Ordered by how often people quote them rather than alphabetically.
 */
export function ratingParts(ratings: MovieRatings | undefined): string[] {
  if (!ratings) {
    return []
  }

  const tenPoint = (value: number) => value.toFixed(1)

  return [
    ratings.imdb ? `IMDb ${tenPoint(ratings.imdb.value)}` : null,
    ratings.rottenTomatoes
      ? `Rotten Tomatoes ${Math.round(ratings.rottenTomatoes.value)}%`
      : null,
    ratings.metacritic
      ? `Metacritic ${Math.round(ratings.metacritic.value)}`
      : null,
    ratings.tmdb ? `TMDb ${tenPoint(ratings.tmdb.value)}` : null,
    ratings.trakt ? `Trakt ${tenPoint(ratings.trakt.value)}` : null,
  ].filter((part): part is string => part !== null)
}

/** {@link ratingParts} as one line - `IMDb 7.6 · Rotten Tomatoes 85%`. */
export function ratingsLine(ratings: MovieRatings | undefined): string | null {
  return joined(ratingParts(ratings))
}

/**
 * The ratings as a wrapping run in which no single score splits across lines -
 * `Trakt` at the end of one line and `7.6` at the start of the next reads as
 * two facts.
 */
function Ratings({ parts }: { parts: readonly string[] }): JSX.Element {
  return (
    <>
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 ? SEPARATOR : null}
          <span className={cns('whitespace-nowrap')}>{part}</span>
        </span>
      ))}
    </>
  )
}

/**
 * A release name with a line-break opportunity after each dot, so a long one
 * wraps between its fields (`…DTS-HD-MA.5.1-` / `UnKn0wn`) instead of
 * mid-word the way `break-all` would. `break-all` stays as the fallback for a
 * single field wider than the card.
 */
function ReleaseName({ name }: { name: string }): JSX.Element {
  const fields = name.split('.')

  return (
    <span className={cns('font-mono text-mono-sm [overflow-wrap:anywhere]')}>
      {fields.map((field, index) => (
        <span key={index}>
          {field}
          {index < fields.length - 1 ? (
            <>
              .<wbr />
            </>
          ) : null}
        </span>
      ))}
    </span>
  )
}

/** One `<dt>`/`<dd>` pair. A row with nothing to say is not drawn. */
type Fact = { label: string; value: ReactNode }

function facts(rows: readonly (Fact | null)[]): Fact[] {
  return rows.filter((row): row is Fact => row !== null)
}

function fact(label: string, value: ReactNode | null | undefined): Fact | null {
  return value === null || value === undefined || value === ''
    ? null
    : { label, value }
}

/** The `File` card's rows, in the order someone checking a file reads them. */
export function movieFileFacts(file: MovieFile): Fact[] {
  const size = formatBytes(file.size)

  return facts([
    fact(
      'Quality',
      file.quality ? (
        <span className={cns('flex flex-wrap items-center gap-2')}>
          <span>{file.quality}</span>
          {file.qualityCutoffNotMet ? (
            <Chip label={MOVIE_UPGRADE_LABEL} tone="warn" />
          ) : null}
        </span>
      ) : null,
    ),
    fact('Size', size === UNKNOWN_VALUE ? null : size),
    fact('Video', fileVideoLine(file)),
    fact('Audio', fileAudioLine(file)),
    fact('Subtitles', file.subtitles?.join(', ')),
    fact('Edition', file.edition),
    fact('Formats', file.customFormats?.join(', ')),
    fact('Group', file.releaseGroup),
    fact(
      'Release',
      file.sceneName ? <ReleaseName name={file.sceneName} /> : null,
    ),
  ])
}

/** The `Details` card's rows - who made it, where it came from, how it scored. */
export function movieInfoFacts(
  movie: Movie,
  credits: MediaCredits | undefined,
): Fact[] {
  const ratings = ratingParts(movie.ratings)

  return facts([
    fact('Directed by', credits?.directors.join(', ')),
    fact('Written by', credits?.writers.join(', ')),
    fact('Studio', movie.studio),
    fact('Original title', movie.originalTitle),
    fact('Language', movie.originalLanguage),
    fact('Collection', movie.collection?.title),
    fact('In cinemas', formatReleaseDay(movie.inCinemas)),
    fact('Digital', formatReleaseDay(movie.digitalRelease)),
    fact('Physical', formatReleaseDay(movie.physicalRelease)),
    fact('Ratings', ratings.length > 0 ? <Ratings parts={ratings} /> : null),
  ])
}

type FactSectionProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> & {
  facts: readonly Fact[]
  heading: string
}

/**
 * A heading over a sunk card of label/value rows - the same heading weight and
 * card the attempts and release sections use, so the page reads as one set.
 * The label column is sized to its longest label and the value column takes
 * the rest, at every width: a release name is the only long value, and it
 * wraps between its fields rather than pushing the card wider than the phone.
 */
function FactSection({
  className,
  facts: rows,
  heading,
  ...props
}: FactSectionProps): JSX.Element {
  const headingId = useId()

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={cns('flex min-w-0 flex-col gap-3', className)}
    >
      <h2 className={cns('text-h2')} id={headingId}>
        {heading}
      </h2>
      <Card className={cns('px-[14px] py-3.5 sm:px-4')} sunk>
        <dl
          className={cns(
            'grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2.5 text-sm',
          )}
        >
          {rows.map(row => (
            <div className={cns('contents')} key={row.label}>
              <dt className={cns('text-ink-3')}>{row.label}</dt>
              <dd className={cns('min-w-0 break-words text-ink')}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  )
}

export type MovieFactsProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  credits?: MediaCredits
  movie: Movie
}

/**
 * The movie page's two reference cards: **File** - what is on disk, from
 * Radarr's `movieFile` and `mediaInfo` - and **Details** - credits, studio,
 * release dates and every source's rating.
 *
 * Either card is left out when it has no rows (nothing downloaded; a movie
 * Radarr knows nothing about), and the pair sits side by side from `lg` only
 * when both are drawn - a lone card at half width would leave a hole beside
 * it. `null` when neither has anything to say, so the page adds no gap.
 */
export function MovieFacts({
  className,
  credits,
  movie,
  ...props
}: MovieFactsProps): JSX.Element | null {
  const fileRows = movie.file ? movieFileFacts(movie.file) : []
  const infoRows = movieInfoFacts(movie, credits)

  if (fileRows.length === 0 && infoRows.length === 0) {
    return null
  }

  const both = fileRows.length > 0 && infoRows.length > 0

  return (
    <div
      {...props}
      className={cns(
        'grid items-start gap-7 sm:gap-8',
        both && 'lg:grid-cols-2',
        className,
      )}
    >
      {fileRows.length > 0 ? (
        <FactSection facts={fileRows} heading={MOVIE_FILE_HEADING} />
      ) : null}
      {infoRows.length > 0 ? (
        <FactSection facts={infoRows} heading={MOVIE_DETAILS_HEADING} />
      ) : null}
    </div>
  )
}

/** An external link, or `null` when the id upstream sent is not one. */
type MovieLink = { href: string; label: string }

/**
 * The movie's pages elsewhere - IMDb, TMDb, and its trailer on YouTube. Each
 * id is checked against its own alphabet before it is put in an `href`: they
 * come from Radarr, which got them from TMDb, and neither is this app.
 */
export function movieLinks(movie: Movie): MovieLink[] {
  const links: MovieLink[] = []

  if (movie.imdbId && IMDB_ID.test(movie.imdbId)) {
    links.push({
      href: `https://www.imdb.com/title/${movie.imdbId}/`,
      label: MOVIE_IMDB_LABEL,
    })
  }

  links.push({
    href: `https://www.themoviedb.org/movie/${movie.tmdbId}`,
    label: MOVIE_TMDB_LABEL,
  })

  if (movie.trailerYouTubeId && YOUTUBE_ID.test(movie.trailerYouTubeId)) {
    links.push({
      href: `https://www.youtube.com/watch?v=${movie.trailerYouTubeId}`,
      label: MOVIE_TRAILER_LABEL,
    })
  }

  return links
}

export type MovieLinksProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  movie: Movie
}

/**
 * {@link movieLinks} as a row of quiet external links for the header's `links`
 * slot - the video page's "View original post" treatment, several abreast.
 * The negative margin cancels the first link's padding so its label lines up
 * with the synopsis above it.
 */
export function MovieLinks({
  className,
  movie,
  ...props
}: MovieLinksProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns('-ml-[11px] flex flex-wrap items-center gap-1', className)}
    >
      {movieLinks(movie).map(link => (
        <ButtonLink
          href={link.href}
          icon="external"
          key={link.label}
          rel="noreferrer"
          size="sm"
          target="_blank"
          variant="ghost"
        >
          {link.label}
        </ButtonLink>
      ))}
    </div>
  )
}
