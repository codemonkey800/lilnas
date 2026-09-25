import '@testing-library/jest-dom'

import type {
  MediaState,
  Movie,
  Show,
  Video,
} from '@lilnas/utils/download/types'
import { DownloadType, MEDIA_STATES } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { MediaStatus } from 'src/components/detail/media-status'

const MOVIE: Movie = {
  id: 'tmdb:920',
  title: 'Cars',
  tmdbId: 920,
  type: DownloadType.Movie,
}

const SHOW: Show = {
  id: 'tvdb:79126',
  title: 'The Wire',
  tvdbId: 79126,
  type: DownloadType.Show,
}

const VIDEO: Video = {
  id: 'video_1',
  sourceUrl: 'https://example.com/watch?v=1',
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

/** The one class in each tone's table that is unique to it. */
const TONE_MARKERS: Record<MediaState, string> = {
  absent: 'text-ink-3',
  available: 'text-ok',
  downloading: 'text-uv-hi',
  importing: 'text-uv-hi',
  needs_attention: 'text-warn',
  paused: 'text-warn',
  wanted: 'text-ink-3',
}

const MOVIE_LABELS: Record<MediaState, string> = {
  absent: 'not downloaded',
  available: 'in library',
  downloading: 'downloading',
  importing: 'importing…',
  needs_attention: 'needs your decision',
  paused: 'paused',
  wanted: 'wanted',
}

const VIDEO_LABELS: Record<MediaState, string> = {
  ...MOVIE_LABELS,
  available: 'downloaded',
  importing: 'processing…',
}

const LIVE_STATES: readonly MediaState[] = ['downloading', 'importing']

function progressBar(): HTMLElement | null {
  return screen.queryByRole('progressbar', { name: 'Download progress' })
}

describe('MediaStatus', () => {
  describe('the state chip', () => {
    it.each(MEDIA_STATES)('labels and tints a movie %s', state => {
      const { container } = render(<MediaStatus media={{ ...MOVIE, state }} />)
      const chip = screen.getByText(MOVIE_LABELS[state])

      expect(chip.getAttribute('class')).toContain(TONE_MARKERS[state])
      expect(container.querySelector('.dot-live') !== null).toBe(
        LIVE_STATES.includes(state),
      )
    })

    it.each(MEDIA_STATES)('labels and tints a video %s', state => {
      const { container } = render(<MediaStatus media={{ ...VIDEO, state }} />)
      const chip = screen.getByText(VIDEO_LABELS[state])

      expect(chip.getAttribute('class')).toContain(TONE_MARKERS[state])
      expect(container.querySelector('.dot-live') !== null).toBe(
        LIVE_STATES.includes(state),
      )
    })

    it('reads a show in the movie wording', () => {
      render(<MediaStatus media={{ ...SHOW, state: 'available' }} />)

      expect(screen.getByText('in library')).toBeInTheDocument()
    })

    it('reads a media with no state as absent', () => {
      render(<MediaStatus media={MOVIE} />)

      expect(screen.getByText('not downloaded')).toBeInTheDocument()
    })

    it('lets a scope override the media state', () => {
      const { container } = render(
        <MediaStatus
          media={{ ...SHOW, state: 'available' }}
          scopeState="downloading"
        />,
      )

      expect(screen.getByText('downloading')).toBeInTheDocument()
      expect(screen.queryByText('in library')).not.toBeInTheDocument()
      expect(container.querySelector('.dot-live')).toBeInTheDocument()
    })

    it('keeps the media type wording under a scope override', () => {
      render(<MediaStatus media={VIDEO} scopeState="importing" />)

      expect(screen.getByText('processing…')).toBeInTheDocument()
    })
  })

  describe('the note', () => {
    it('shows the state reason', () => {
      render(
        <MediaStatus
          media={{
            ...MOVIE,
            state: 'needs_attention',
            stateReason: 'Radarr could not match the file.',
          }}
        />,
      )

      expect(
        screen.getByText('Radarr could not match the file.'),
      ).toBeInTheDocument()
    })

    it('prefers explain over the state reason', () => {
      render(
        <MediaStatus
          explain="Pick the file yourself."
          media={{
            ...MOVIE,
            state: 'needs_attention',
            stateReason: 'Radarr could not match the file.',
          }}
        />,
      )

      expect(screen.getByText('Pick the file yourself.')).toBeInTheDocument()
      expect(
        screen.queryByText('Radarr could not match the file.'),
      ).not.toBeInTheDocument()
    })

    it('renders no note when there is nothing to say', () => {
      const { container } = render(
        <MediaStatus media={{ ...MOVIE, state: 'available' }} />,
      )

      expect(container.querySelector('.text-sm')).not.toBeInTheDocument()
    })
  })

  describe('progress', () => {
    it('draws the queue snapshot with no job behind it', () => {
      render(
        <MediaStatus
          media={{
            ...MOVIE,
            queueSnapshot: {
              progress: 72,
              status: 'downloading',
              timeLeft: '00:04:10',
            },
            state: 'downloading',
          }}
        />,
      )

      expect(progressBar()).toHaveAttribute('aria-valuenow', '72')
      expect(screen.getByText('72%')).toBeInTheDocument()
      expect(screen.getByText('~00:04:10 left')).toBeInTheDocument()
    })

    it('prefers an explicit percentage and detail line', () => {
      render(
        <MediaStatus
          media={{
            ...SHOW,
            queueSnapshot: { progress: 10, timeLeft: '01:00:00' },
            state: 'downloading',
          }}
          progressDetail="S3E7 · 610 MB / 1.7 GB"
          progressPct={35}
        />,
      )

      expect(progressBar()).toHaveAttribute('aria-valuenow', '35')
      expect(screen.getByText('S3E7 · 610 MB / 1.7 GB')).toBeInTheDocument()
      expect(screen.queryByText('~01:00:00 left')).not.toBeInTheDocument()
    })

    it('names the bar and hides the percentage that repeats it', () => {
      render(<MediaStatus media={VIDEO} progressPct={58} />)

      expect(progressBar()).toBeInTheDocument()
      expect(screen.getByText('58%')).toHaveAttribute('aria-hidden', 'true')
    })

    it('draws an explicit percentage with no snapshot at all', () => {
      render(<MediaStatus media={VIDEO} progressPct={64} />)

      expect(progressBar()).toHaveAttribute('aria-valuenow', '64')
    })

    it('draws no bar without a snapshot', () => {
      render(<MediaStatus media={{ ...MOVIE, state: 'downloading' }} />)

      expect(progressBar()).not.toBeInTheDocument()
    })

    it('settles a full download that has not reached the library yet', () => {
      render(
        <MediaStatus
          media={{
            ...MOVIE,
            queueSnapshot: {
              progress: 100,
              status: 'downloading',
              timeLeft: '00:00:00',
            },
            state: 'downloading',
          }}
        />,
      )

      // The chip and the bar's note both name the handoff.
      expect(screen.getAllByText('finishing up')).toHaveLength(2)
      expect(screen.queryByText('downloading')).not.toBeInTheDocument()
      expect(
        screen.getByText('All downloaded. Radarr imports it next.'),
      ).toBeInTheDocument()
      expect(screen.queryByText('~00:00:00 left')).not.toBeInTheDocument()
      expect(progressBar()).toHaveAttribute(
        'aria-valuetext',
        '100%, finishing up',
      )
      expect(
        progressBar()?.querySelector('[data-settling]'),
      ).toBeInTheDocument()
    })

    it('says who is importing instead of a spent estimate', () => {
      render(
        <MediaStatus
          media={{
            ...SHOW,
            queueSnapshot: {
              progress: 100,
              status: 'completed',
              timeLeft: '00:00:00',
            },
            state: 'importing',
          }}
        />,
      )

      expect(screen.getAllByText('importing…')).toHaveLength(2)
      expect(screen.queryByText('completed')).not.toBeInTheDocument()
      expect(
        screen.getByText('Sonarr is moving it into the library.'),
      ).toBeInTheDocument()
      expect(
        progressBar()?.querySelector('[data-settling]'),
      ).toBeInTheDocument()
    })

    it('keeps a download short of 100% transferring', () => {
      render(
        <MediaStatus
          media={{
            ...MOVIE,
            queueSnapshot: { progress: 99.99, status: 'downloading' },
            state: 'downloading',
          }}
        />,
      )

      expect(screen.getAllByText('downloading')).toHaveLength(2)
      expect(
        progressBar()?.querySelector('[data-settling]'),
      ).not.toBeInTheDocument()
    })

    it('draws no bar for a snapshot with no percentage', () => {
      render(
        <MediaStatus
          media={{
            ...MOVIE,
            queueSnapshot: { status: 'queued' },
            state: 'downloading',
          }}
        />,
      )

      expect(progressBar()).not.toBeInTheDocument()
    })
  })
})
