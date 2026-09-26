import { cns } from '@lilnas/utils/cns'
import type {
  MediaCredits,
  Movie,
  MovieFile,
  MovieRatings,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { ExternalLink, Fact } from 'src/components/detail/fact-section'
import {
  ExternalLinks,
  fact,
  FactCards,
  FactRun,
  facts,
  formatDay,
  IMDB_LABEL,
  imdbLink,
  joinFacts,
} from 'src/components/detail/fact-section'
import { Chip } from 'src/components/ui/chip'
import { formatBytes, UNKNOWN_VALUE } from 'src/lib/format'

export const MOVIE_FILE_HEADING = 'File'
export const MOVIE_DETAILS_HEADING = 'Details'

/**
 * Beside the quality when Radarr's profile would still take a better release -
 * the file is fine to watch, and may be swapped out from under the page.
 */
export const MOVIE_UPGRADE_LABEL = 'upgrade wanted'

export const MOVIE_IMDB_LABEL = IMDB_LABEL
export const MOVIE_TMDB_LABEL = 'TMDb'
export const MOVIE_TRAILER_LABEL = 'Trailer'

/** YouTube's id alphabet. Checked because it lands in an `href`. */
const YOUTUBE_ID = /^[\w-]{6,20}$/

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

/** `AVC · 1920×1080 · 8-bit · SDR · 23.976 fps`. */
export function fileVideoLine(file: MovieFile): string | null {
  const video = file.video

  if (!video) {
    return null
  }

  return joinFacts([
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

  return joinFacts([
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
  return joinFacts(ratingParts(ratings))
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
    fact('In cinemas', formatDay(movie.inCinemas)),
    fact('Digital', formatDay(movie.digitalRelease)),
    fact('Physical', formatDay(movie.physicalRelease)),
    fact('Ratings', ratings.length > 0 ? <FactRun parts={ratings} /> : null),
  ])
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
  credits,
  movie,
  ...props
}: MovieFactsProps): JSX.Element | null {
  return (
    <FactCards
      {...props}
      sections={[
        {
          facts: movie.file ? movieFileFacts(movie.file) : [],
          heading: MOVIE_FILE_HEADING,
        },
        {
          facts: movieInfoFacts(movie, credits),
          heading: MOVIE_DETAILS_HEADING,
        },
      ]}
    />
  )
}

/**
 * The movie's pages elsewhere - IMDb, TMDb, and its trailer on YouTube. Each
 * id is checked against its own alphabet before it is put in an `href`: they
 * come from Radarr, which got them from TMDb, and neither is this app.
 */
export function movieLinks(movie: Movie): ExternalLink[] {
  const links: ExternalLink[] = []
  const imdb = imdbLink(movie.imdbId)

  if (imdb) {
    links.push(imdb)
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

/** {@link movieLinks} as the header's row of external links. */
export function MovieLinks({
  movie,
  ...props
}: MovieLinksProps): JSX.Element | null {
  return <ExternalLinks {...props} links={movieLinks(movie)} />
}
