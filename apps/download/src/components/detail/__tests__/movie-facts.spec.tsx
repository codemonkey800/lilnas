import '@testing-library/jest-dom'

import type { MediaCredits, Movie } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'

import { formatDay } from 'src/components/detail/fact-section'
import {
  fileAudioLine,
  fileVideoLine,
  formatChannels,
  MOVIE_DETAILS_HEADING,
  MOVIE_FILE_HEADING,
  MOVIE_IMDB_LABEL,
  MOVIE_TMDB_LABEL,
  MOVIE_TRAILER_LABEL,
  MOVIE_UPGRADE_LABEL,
  MovieFacts,
  movieInfoFacts,
  MovieLinks,
  movieLinks,
  ratingsLine,
} from 'src/components/detail/movie-facts'

const MOVIE: Movie = {
  collection: { title: 'Street Cops Collection' },
  digitalRelease: '2014-11-16T00:00:00Z',
  file: {
    audio: {
      channels: 5.1,
      codec: 'DTS-HD MA',
      languages: ['English'],
      streamCount: 2,
    },
    quality: 'Remux-1080p',
    qualityCutoffNotMet: false,
    releaseGroup: 'UnKn0wn',
    sceneName: 'End.Of.Watch.2012.1080p.BluRay.REMUX.AVC.DTS-HD-MA.5.1-UnKn0wn',
    size: 33_361_815_167,
    subtitles: ['English', 'Spanish'],
    video: {
      bitDepth: 8,
      codec: 'AVC',
      dynamicRange: 'SDR',
      fps: 23.976,
      resolution: '1920x1080',
    },
  },
  id: 'tmdb:77016',
  imdbId: 'tt1855199',
  inCinemas: '2012-09-20T00:00:00Z',
  originalLanguage: 'English',
  physicalRelease: '2013-03-20T00:00:00Z',
  ratings: {
    imdb: { value: 7.6, votes: 295_369 },
    metacritic: { value: 68 },
    rottenTomatoes: { value: 85 },
    tmdb: { value: 7.36, votes: 3750 },
  },
  studio: '5150 Action',
  title: 'End of Watch',
  tmdbId: 77016,
  trailerYouTubeId: 'TYGXe5ggBx0',
  type: DownloadType.Movie,
  year: 2012,
}

const CREDITS: MediaCredits = {
  cast: [{ character: 'Brian Taylor', name: 'Jake Gyllenhaal' }],
  directors: ['David Ayer'],
  writers: ['David Ayer'],
}

/** A `<dd>`'s text, found by its `<dt>`, within one labelled section. */
function factValue(section: HTMLElement, label: string): string | null {
  const term = within(section).getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent ?? null
}

describe('formatters', () => {
  it('writes a whole channel count the conventional way', () => {
    expect(formatChannels(2)).toBe('2.0')
    expect(formatChannels(5.1)).toBe('5.1')
  })

  it('reads a release date in UTC so it never slips a day', () => {
    expect(formatDay('2012-09-20T00:00:00Z')).toBe('Sep 20, 2012')
    expect(formatDay('not a date')).toBeNull()
    expect(formatDay(undefined)).toBeNull()
  })

  it('spells the video and audio lines', () => {
    expect(fileVideoLine(MOVIE.file!)).toBe(
      'AVC · 1920×1080 · 8-bit · SDR · 23.976\u00a0fps',
    )
    expect(fileAudioLine(MOVIE.file!)).toBe(
      'DTS-HD MA 5.1 · English · 2 tracks',
    )
  })

  it('leaves a single audio track uncounted', () => {
    expect(fileAudioLine({ audio: { codec: 'AAC', streamCount: 1 } })).toBe(
      'AAC',
    )
  })

  it('puts each rating on its own scale', () => {
    expect(ratingsLine(MOVIE.ratings)).toBe(
      'IMDb 7.6 · Rotten Tomatoes 85% · Metacritic 68 · TMDb 7.4',
    )
    expect(ratingsLine(undefined)).toBeNull()
  })
})

describe('MovieFacts', () => {
  it('draws the file card from the file on disk', () => {
    render(<MovieFacts movie={MOVIE} />)

    const file = screen.getByRole('region', { name: MOVIE_FILE_HEADING })

    expect(factValue(file, 'Quality')).toBe('Remux-1080p')
    expect(factValue(file, 'Size')).toBe('31 GB')
    expect(factValue(file, 'Video')).toBe(
      'AVC · 1920×1080 · 8-bit · SDR · 23.976\u00a0fps',
    )
    expect(factValue(file, 'Audio')).toBe('DTS-HD MA 5.1 · English · 2 tracks')
    expect(factValue(file, 'Subtitles')).toBe('English, Spanish')
    expect(factValue(file, 'Group')).toBe('UnKn0wn')
    expect(factValue(file, 'Release')).toBe(MOVIE.file?.sceneName)
    // Nothing to say, so no row at all rather than an em dash.
    expect(within(file).queryByText('Edition')).not.toBeInTheDocument()
    expect(
      within(file).queryByText(MOVIE_UPGRADE_LABEL),
    ).not.toBeInTheDocument()
  })

  it('flags a file the quality profile would still upgrade', () => {
    render(
      <MovieFacts
        movie={{
          ...MOVIE,
          file: { ...MOVIE.file, qualityCutoffNotMet: true },
        }}
      />,
    )

    const file = screen.getByRole('region', { name: MOVIE_FILE_HEADING })

    expect(within(file).getByText(MOVIE_UPGRADE_LABEL)).toBeInTheDocument()
  })

  it('draws the details card from the movie and its credits', () => {
    render(<MovieFacts credits={CREDITS} movie={MOVIE} />)

    const details = screen.getByRole('region', { name: MOVIE_DETAILS_HEADING })

    expect(factValue(details, 'Directed by')).toBe('David Ayer')
    expect(factValue(details, 'Written by')).toBe('David Ayer')
    expect(factValue(details, 'Studio')).toBe('5150 Action')
    expect(factValue(details, 'Language')).toBe('English')
    expect(factValue(details, 'Collection')).toBe('Street Cops Collection')
    expect(factValue(details, 'In cinemas')).toBe('Sep 20, 2012')
    expect(factValue(details, 'Digital')).toBe('Nov 16, 2014')
    expect(factValue(details, 'Physical')).toBe('Mar 20, 2013')
    expect(factValue(details, 'Ratings')).toBe(
      'IMDb 7.6 · Rotten Tomatoes 85% · Metacritic 68 · TMDb 7.4',
    )
  })

  it('leaves out the file card for a movie with nothing on disk', () => {
    render(<MovieFacts movie={{ ...MOVIE, file: undefined }} />)

    expect(
      screen.queryByRole('region', { name: MOVIE_FILE_HEADING }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: MOVIE_DETAILS_HEADING }),
    ).toBeInTheDocument()
  })

  it('renders nothing for a movie with nothing to say', () => {
    const { container } = render(
      <MovieFacts
        movie={{
          id: 'tmdb:5',
          title: 'tmdb:5',
          tmdbId: 5,
          type: DownloadType.Movie,
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('omits the credit rows when there are no credits', () => {
    const rows = movieInfoFacts(MOVIE, undefined).map(row => row.label)

    expect(rows).not.toContain('Directed by')
    expect(rows).not.toContain('Written by')
  })
})

describe('movieLinks', () => {
  it('links IMDb, TMDb and the trailer', () => {
    expect(movieLinks(MOVIE)).toEqual([
      {
        href: 'https://www.imdb.com/title/tt1855199/',
        label: MOVIE_IMDB_LABEL,
      },
      {
        href: 'https://www.themoviedb.org/movie/77016',
        label: MOVIE_TMDB_LABEL,
      },
      {
        href: 'https://www.youtube.com/watch?v=TYGXe5ggBx0',
        label: MOVIE_TRAILER_LABEL,
      },
    ])
  })

  it('refuses an id that is not the shape it claims to be', () => {
    const links = movieLinks({
      ...MOVIE,
      imdbId: 'javascript:alert(1)',
      trailerYouTubeId: 'x"><script>',
    })

    expect(links.map(link => link.label)).toEqual([MOVIE_TMDB_LABEL])
  })

  it('opens each link in a new tab', () => {
    render(<MovieLinks movie={MOVIE} />)

    const imdb = screen.getByRole('link', { name: MOVIE_IMDB_LABEL })

    expect(imdb).toHaveAttribute(
      'href',
      'https://www.imdb.com/title/tt1855199/',
    )
    expect(imdb).toHaveAttribute('target', '_blank')
    expect(imdb).toHaveAttribute('rel', 'noreferrer')
  })
})
