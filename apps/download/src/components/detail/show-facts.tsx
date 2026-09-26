import type {
  Episode,
  Season,
  Show,
  ShowSeriesType,
  ShowStatus,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { ExternalLink, Fact } from 'src/components/detail/fact-section'
import {
  ExternalLinks,
  fact,
  FactCards,
  facts,
  formatDay,
  imdbLink,
  joinFacts,
} from 'src/components/detail/fact-section'
import {
  episodeCode,
  SPECIALS_SEASON_NUMBER,
} from 'src/components/detail/show-state'
import { formatBytes, UNKNOWN_VALUE } from 'src/lib/format'

export const SHOW_DETAILS_HEADING = 'Details'

export const SHOW_TVDB_LABEL = 'TVDB'
export const SHOW_TMDB_LABEL = 'TMDb'
export const SHOW_TVMAZE_LABEL = 'TVmaze'

/**
 * How many alternate titles the card lists. Sonarr keeps every scene name a
 * release has been posted under, and past a handful they stop being names a
 * person would know the show by.
 */
export const SHOW_ALTERNATE_TITLE_LIMIT = 4

const STATUS_LABELS: Record<ShowStatus, string> = {
  continuing: 'Continuing',
  ended: 'Ended',
  upcoming: 'Upcoming',
}

const SERIES_TYPE_LABELS: Record<ShowSeriesType, string> = {
  anime: 'Anime',
  daily: 'Daily',
}

/** `S24E15 · May 17, 2026`. */
function episodeLine(episode: Episode): string | null {
  return joinFacts([
    episodeCode(episode.seasonNumber, episode.episodeNumber),
    formatDay(episode.airDate),
  ])
}

/**
 * The most recent episode to have aired and the next one due, off the
 * seasons payload. Specials are skipped - Sonarr dates them too, and a
 * behind-the-scenes special is not what "next episode" means.
 *
 * `airDate` is a bare broadcast-local day (`2026-05-17`), so it is compared
 * against `now`'s UTC day as a string. Around midnight that can be a day off
 * either way; an episode airing today counts as aired.
 */
export function airingEpisodes(
  seasons: readonly Season[],
  now: number,
): { latest: Episode | null; next: Episode | null } {
  const today = new Date(now).toISOString().slice(0, 10)
  let latest: Episode | null = null
  let next: Episode | null = null

  for (const season of seasons) {
    if (season.seasonNumber === SPECIALS_SEASON_NUMBER) {
      continue
    }

    for (const episode of season.episodes) {
      const day = episode.airDate

      if (!day) {
        continue
      }

      if (day <= today) {
        if (!latest || day > (latest.airDate ?? '')) {
          latest = episode
        }
      } else if (!next || day < (next.airDate ?? '')) {
        next = episode
      }
    }
  }

  return { latest, next }
}

/** The `Details` card's rows - where it airs, how far along it is, what else it is called. */
export function showInfoFacts(
  show: Show,
  seasons: readonly Season[],
  now: number,
): Fact[] {
  const { latest, next } = airingEpisodes(seasons, now)
  const size = formatBytes(show.sizeOnDisk)
  const ended = show.status === 'ended'

  return facts([
    fact('Network', show.network),
    fact('Status', show.status ? STATUS_LABELS[show.status] : null),
    // An ended series has nothing next - whatever Sonarr dates past its
    // finale is a special or a data error, not a schedule.
    fact('Next episode', next && !ended ? episodeLine(next) : null),
    fact(
      ended ? 'Final episode' : 'Latest episode',
      latest ? episodeLine(latest) : formatDay(show.lastAired),
    ),
    fact('First aired', formatDay(show.releaseDate)),
    fact('Language', show.originalLanguage),
    fact(
      'Also known as',
      show.alternateTitles?.slice(0, SHOW_ALTERNATE_TITLE_LIMIT).join(', '),
    ),
    fact('Type', show.seriesType ? SERIES_TYPE_LABELS[show.seriesType] : null),
    fact('Size on disk', size === UNKNOWN_VALUE ? null : size),
  ])
}

export type ShowFactsProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  media: Show
  /** The instant `Next episode` and `Latest episode` are measured against. */
  now: number
  seasons: readonly Season[]
}

/**
 * The show page's reference card - **Details**: network, airing status and
 * schedule, language, other titles and what the series takes up on disk.
 * `null` for a show with none of that (the metadata placeholder), so the page
 * adds no gap.
 */
export function ShowFacts({
  media,
  now,
  seasons,
  ...props
}: ShowFactsProps): JSX.Element | null {
  return (
    <FactCards
      {...props}
      sections={[
        {
          facts: showInfoFacts(media, seasons, now),
          heading: SHOW_DETAILS_HEADING,
        },
      ]}
    />
  )
}

/**
 * The series' pages elsewhere - IMDb, TVDB, TMDb and TVmaze. The three numeric
 * ids are integers by schema; the IMDb id is checked before it goes in an
 * `href`.
 */
export function showLinks(show: Show): ExternalLink[] {
  const imdb = imdbLink(show.imdbId)

  return [
    imdb,
    {
      href: `https://www.thetvdb.com/dereferrer/series/${show.tvdbId}`,
      label: SHOW_TVDB_LABEL,
    },
    show.tmdbId
      ? {
          href: `https://www.themoviedb.org/tv/${show.tmdbId}`,
          label: SHOW_TMDB_LABEL,
        }
      : null,
    show.tvMazeId
      ? {
          href: `https://www.tvmaze.com/shows/${show.tvMazeId}`,
          label: SHOW_TVMAZE_LABEL,
        }
      : null,
  ].filter((link): link is ExternalLink => link !== null)
}

export type ShowLinksProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  media: Show
}

/** {@link showLinks} as the header's row of external links. */
export function ShowLinks({
  media,
  ...props
}: ShowLinksProps): JSX.Element | null {
  return <ExternalLinks {...props} links={showLinks(media)} />
}
