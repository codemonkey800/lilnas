import '@testing-library/jest-dom'

import { render, screen, within } from '@testing-library/react'

import {
  episode,
  NOW,
  season,
  show,
  specials,
} from 'src/components/detail/__tests__/fixtures/show'
import {
  airingEpisodes,
  SHOW_ALTERNATE_TITLE_LIMIT,
  SHOW_DETAILS_HEADING,
  SHOW_TMDB_LABEL,
  SHOW_TVDB_LABEL,
  SHOW_TVMAZE_LABEL,
  ShowFacts,
  showInfoFacts,
  ShowLinks,
  showLinks,
} from 'src/components/detail/show-facts'

// NOW is 2026-09-15.
const AIRED = episode({ airDate: '2026-09-08', episodeNumber: 7, id: 1 })
const TODAY = episode({ airDate: '2026-09-15', episodeNumber: 8, id: 2 })
const NEXT = episode({ airDate: '2026-09-22', episodeNumber: 9, id: 3 })
const LATER = episode({ airDate: '2026-09-29', episodeNumber: 10, id: 4 })

const SEASONS = [
  // A special dated between the two - never "next episode".
  specials({
    episodes: [episode({ airDate: '2026-09-18', id: 90, seasonNumber: 0 })],
  }),
  season({ episodes: [LATER, AIRED, NEXT, TODAY] }),
]

/** The card's rows as `label -> text`, in order. */
function rows(): [string, string][] {
  const card = screen.getByRole('region', { name: SHOW_DETAILS_HEADING })

  return within(card)
    .getAllByRole('term')
    .map(term => [
      term.textContent ?? '',
      term.nextElementSibling?.textContent ?? '',
    ])
}

describe('airingEpisodes', () => {
  it('finds the newest aired episode - today counts - and the soonest unaired one', () => {
    expect(airingEpisodes(SEASONS, NOW)).toEqual({
      latest: TODAY,
      next: NEXT,
    })
  })

  it('skips specials and undated episodes', () => {
    expect(
      airingEpisodes(
        [
          specials({ episodes: [episode({ airDate: '2026-09-20' })] }),
          season({ episodes: [episode({ airDate: undefined })] }),
        ],
        NOW,
      ),
    ).toEqual({ latest: null, next: null })
  })
})

describe('showInfoFacts', () => {
  it('lists a running series in reading order', () => {
    render(
      <ShowFacts
        media={show({
          alternateTitles: ['SV', 'Silicon Valley (2014)'],
          network: 'HBO',
          originalLanguage: 'English',
          releaseDate: '2014-04-06T00:00:00Z',
          seriesType: 'daily',
          sizeOnDisk: 5 * 1024 ** 3,
          status: 'continuing',
        })}
        now={NOW}
        seasons={SEASONS}
      />,
    )

    expect(rows()).toEqual([
      ['Network', 'HBO'],
      ['Status', 'Continuing'],
      ['Next episode', 'S01E09 · Sep 22, 2026'],
      ['Latest episode', 'S01E08 · Sep 15, 2026'],
      ['First aired', 'Apr 6, 2014'],
      ['Language', 'English'],
      ['Also known as', 'SV, Silicon Valley (2014)'],
      ['Type', 'Daily'],
      ['Size on disk', '5.0 GB'],
    ])
  })

  it('calls an ended series’ last episode its final one, and offers nothing next', () => {
    const labels = showInfoFacts(show({ status: 'ended' }), SEASONS, NOW).map(
      row => row.label,
    )

    expect(labels).toContain('Final episode')
    expect(labels).not.toContain('Next episode')
  })

  it('falls back to Sonarr’s last-aired day with no seasons to read', () => {
    const latest = showInfoFacts(
      show({ lastAired: '2019-12-08T00:00:00Z' }),
      [],
      NOW,
    ).find(row => row.label === 'Latest episode')

    expect(latest?.value).toBe('Dec 8, 2019')
  })

  it('lists only the first few alternate titles', () => {
    const titles = Array.from({ length: 9 }, (_, i) => `Title ${i}`)
    const aka = showInfoFacts(show({ alternateTitles: titles }), [], NOW).find(
      row => row.label === 'Also known as',
    )

    expect(String(aka?.value).split(', ')).toHaveLength(
      SHOW_ALTERNATE_TITLE_LIMIT,
    )
  })

  it('renders nothing for a show with nothing to say', () => {
    const { container } = render(
      <ShowFacts media={show()} now={NOW} seasons={[]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})

describe('showLinks', () => {
  it('links every id the series has', () => {
    expect(
      showLinks(show({ imdbId: 'tt2575988', tmdbId: 60573, tvMazeId: 125 })),
    ).toEqual([
      { href: 'https://www.imdb.com/title/tt2575988/', label: 'IMDb' },
      {
        href: 'https://www.thetvdb.com/dereferrer/series/277165',
        label: SHOW_TVDB_LABEL,
      },
      { href: 'https://www.themoviedb.org/tv/60573', label: SHOW_TMDB_LABEL },
      { href: 'https://www.tvmaze.com/shows/125', label: SHOW_TVMAZE_LABEL },
    ])
  })

  it('⚠️ drops an IMDb id that is not one rather than putting it in an href', () => {
    expect(
      showLinks(show({ imdbId: 'javascript:alert(1)' })).map(l => l.label),
    ).toEqual([SHOW_TVDB_LABEL])
  })

  it('opens each in a new tab', () => {
    render(<ShowLinks media={show()} />)

    expect(screen.getByRole('link', { name: SHOW_TVDB_LABEL })).toHaveAttribute(
      'target',
      '_blank',
    )
  })
})
