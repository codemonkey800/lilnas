import '@testing-library/jest-dom'

import type { Media, Movie, Show, Video } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  canSaveLocal,
  mediaFileHref,
  SAVE_LOCAL_LABEL,
  SaveLocal,
} from 'src/components/detail/save-local'

const MOVIE: Movie = {
  filePath: '/storage/media-library/movies/Following (1999)/following.mkv',
  id: 'tmdb:11660',
  title: 'Following',
  tmdbId: 11660,
  type: DownloadType.Movie,
}

const SHOW: Show = {
  filePath: '/storage/media-library/shows/The Wire',
  id: 'tvdb:121361',
  title: 'The Wire',
  tvdbId: 121361,
  type: DownloadType.Show,
}

const VIDEO: Video = {
  downloadUrls: ['https://storage.lilnas.io/videos/abc123.mp4'],
  id: 'video:abc123',
  sourceUrl: 'https://youtube.com/watch?v=abc',
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

function link(): HTMLElement {
  return screen.getByRole('link', { name: SAVE_LOCAL_LABEL })
}

describe('mediaFileHref', () => {
  it('builds a relative /api URL the browser can actually reach', () => {
    // NOT http://localhost:8081 — that is the Nest process, which has no
    // Traefik router and which no browser can resolve.
    expect(mediaFileHref('tmdb:11660')).toBe(
      '/api/download/media/tmdb%3A11660/file',
    )
  })

  it('percent-encodes the colon in a media key', () => {
    expect(mediaFileHref('video:abc123')).toContain('video%3Aabc123')
  })

  it('carries an episode id for a show', () => {
    expect(mediaFileHref('tvdb:121361', { episodeId: 4823 })).toBe(
      '/api/download/media/tvdb%3A121361/file?episodeId=4823',
    )
  })

  it('carries a part for a video', () => {
    expect(mediaFileHref('video:abc123', { part: 2 })).toBe(
      '/api/download/media/video%3Aabc123/file?part=2',
    )
  })

  it('omits a query entirely when there is no scope', () => {
    expect(mediaFileHref('tmdb:11660')).not.toContain('?')
  })
})

describe('canSaveLocal', () => {
  it('allows a movie that has a file on disk', () => {
    expect(canSaveLocal(MOVIE)).toBe(true)
  })

  it('refuses a movie that is requested but not yet downloaded', () => {
    // Radarr populates `filePath` only once `hasFile`, so absent covers both
    // "not in the library" and "still downloading" — the two cases that 404.
    expect(canSaveLocal({ ...MOVIE, filePath: undefined })).toBe(false)
  })

  it('refuses a show with no episode named', () => {
    // A series is a folder, not a file — the backend answers 400, not 404.
    expect(canSaveLocal(SHOW)).toBe(false)
  })

  it('allows a show once an episode is named', () => {
    expect(canSaveLocal(SHOW, { episodeId: 4823 })).toBe(true)
  })

  it('allows a video with a stored object for the part asked for', () => {
    expect(canSaveLocal(VIDEO)).toBe(true)
    expect(canSaveLocal(VIDEO, { part: 0 })).toBe(true)
  })

  it('refuses a video part that was never stored', () => {
    expect(canSaveLocal(VIDEO, { part: 1 })).toBe(false)
  })

  it('refuses a video with no stored objects at all', () => {
    expect(canSaveLocal({ ...VIDEO, downloadUrls: undefined })).toBe(false)
  })
})

describe('SaveLocal', () => {
  it('renders a real anchor, not a button', () => {
    render(<SaveLocal media={MOVIE} />)

    // Content-Disposition does the work; the browser's own download manager
    // gets resume, progress and "save as" for free.
    expect(link().tagName).toBe('A')
  })

  it('points a movie at its file with no query', () => {
    render(<SaveLocal media={MOVIE} />)

    expect(link()).toHaveAttribute(
      'href',
      '/api/download/media/tmdb%3A11660/file',
    )
  })

  it('points an episode at its own file', () => {
    render(<SaveLocal episodeId={4823} media={SHOW} />)

    expect(link()).toHaveAttribute(
      'href',
      '/api/download/media/tvdb%3A121361/file?episodeId=4823',
    )
  })

  it('never renders on a series header', () => {
    render(<SaveLocal media={SHOW} />)

    // The action belongs on an episode row. Without an episodeId the backend
    // answers 400, so there is nothing honest to link to here.
    expect(
      screen.queryByRole('link', { name: SAVE_LOCAL_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('points a video at its part', () => {
    render(<SaveLocal media={VIDEO} part={0} />)

    expect(link()).toHaveAttribute(
      'href',
      '/api/download/media/video%3Aabc123/file?part=0',
    )
  })

  it('drops a stray episodeId on a video rather than sending a 400', () => {
    render(<SaveLocal episodeId={4823} media={VIDEO} />)

    expect(link().getAttribute('href')).not.toContain('episodeId')
  })

  it('drops a stray part on a movie rather than sending a 400', () => {
    render(<SaveLocal media={MOVIE} part={3} />)

    expect(link().getAttribute('href')).not.toContain('part')
  })

  it('renders nothing when there is no file to save', () => {
    const { container } = render(
      <SaveLocal media={{ ...MOVIE, filePath: undefined }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('says "Save to device", never "Download"', () => {
    render(<SaveLocal media={MOVIE} />)

    // Downloading lands a file on the server; saving copies it to this
    // machine. Blurring the two is spec §9's explicit warning.
    expect(link()).toHaveTextContent(SAVE_LOCAL_LABEL)
    expect(link()).not.toHaveTextContent(/download/i)
  })

  it('takes a different label, size and weight', () => {
    render(
      <SaveLocal
        label="Save episode"
        media={MOVIE}
        size="sm"
        variant="ghost"
      />,
    )

    const rendered = screen.getByRole('link', { name: 'Save episode' })

    expect(rendered.getAttribute('class')).toContain('h-[30px]')
  })

  it('offers no resume affordance for either storage branch', () => {
    const { container } = render(<SaveLocal media={VIDEO} />)

    // The disk branch honours Range and the MinIO branch does not; an
    // affordance that worked for only one would be worse than none.
    expect(container.textContent).not.toMatch(/resume/i)
  })

  it('spreads the rest onto the anchor', () => {
    render(<SaveLocal data-testid="save" media={MOVIE} />)

    expect(screen.getByTestId('save')).toBe(link())
  })
})

describe('the media payloads this renders against', () => {
  it('treats every DownloadType', () => {
    const all: Media[] = [MOVIE, SHOW, VIDEO]

    // canSaveLocal switches exhaustively on `media.type`; this asserts the
    // three fixtures above really are one per type rather than two of one.
    expect(new Set(all.map(media => media.type)).size).toBe(3)
  })
})
