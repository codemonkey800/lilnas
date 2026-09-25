import type {
  MediaState,
  Movie,
  Show,
  Video,
} from '@lilnas/utils/download/types'
import { DownloadType, MEDIA_STATES } from '@lilnas/utils/download/types'

import {
  mediaProgress,
  mediaStateIsLive,
  mediaStateLabel,
} from 'src/components/detail/media-state'

const MOVIE: Movie = {
  id: 'tmdb:920',
  title: 'Cars',
  tmdbId: 920,
  type: DownloadType.Movie,
}

const SHOW: Show = {
  id: 'tvdb:121361',
  title: 'Game of Thrones',
  tvdbId: 121361,
  type: DownloadType.Show,
}

const VIDEO: Video = {
  id: 'video:abc123',
  sourceUrl: 'https://youtube.com/watch?v=abc',
  title: 'Sourdough starter',
  type: DownloadType.Video,
}

/**
 * The approved mockups' vocabulary, spelled out once per type. A state added
 * to `MEDIA_STATES` fails type-check on these tables as well as in the module.
 */
const EXPECTED_LABELS: Record<DownloadType, Record<MediaState, string>> = {
  [DownloadType.Movie]: {
    absent: 'not downloaded',
    available: 'in library',
    downloading: 'downloading',
    importing: 'importing…',
    needs_attention: 'needs your decision',
    paused: 'paused',
    wanted: 'wanted',
  },
  [DownloadType.Show]: {
    absent: 'not downloaded',
    available: 'in library',
    downloading: 'downloading',
    importing: 'importing…',
    needs_attention: 'needs your decision',
    paused: 'paused',
    wanted: 'wanted',
  },
  [DownloadType.Video]: {
    absent: 'not downloaded',
    available: 'downloaded',
    downloading: 'downloading',
    importing: 'processing…',
    needs_attention: 'needs your decision',
    paused: 'paused',
    wanted: 'wanted',
  },
}

const LIVE_STATES: readonly MediaState[] = ['downloading', 'importing']

const EVERY_TYPE = Object.values(DownloadType)

describe('mediaStateLabel', () => {
  const cases = EVERY_TYPE.flatMap(type =>
    MEDIA_STATES.map(state => [type, state] as const),
  )

  it.each(cases)('labels a %s in state %s', (type, state) => {
    expect(mediaStateLabel(state, type)).toBe(EXPECTED_LABELS[type][state])
  })

  it('words a finished video differently from a finished movie or show', () => {
    // A video has no library to be "in", and yt-dlp's convert/upload/clean is
    // not a Radarr/Sonarr import.
    expect(mediaStateLabel('available', DownloadType.Video)).toBe('downloaded')
    expect(mediaStateLabel('importing', DownloadType.Video)).toBe('processing…')
    expect(mediaStateLabel('available', DownloadType.Movie)).toBe('in library')
    expect(mediaStateLabel('importing', DownloadType.Show)).toBe('importing…')
  })
})

describe('mediaStateIsLive', () => {
  it.each(MEDIA_STATES)('answers for %s', state => {
    expect(mediaStateIsLive(state)).toBe(LIVE_STATES.includes(state))
  })

  it('⚠️ keeps the stopped in-flight states off the live dot', () => {
    // In flight, but nothing will move until somebody acts.
    expect(mediaStateIsLive('needs_attention')).toBe(false)
    expect(mediaStateIsLive('paused')).toBe(false)
  })
})

describe('mediaProgress', () => {
  it('reads a movie from its queue snapshot', () => {
    expect(
      mediaProgress({
        ...MOVIE,
        queueSnapshot: {
          progress: 47.25,
          status: 'downloading',
          timeLeft: '00:12:34',
        },
      }),
    ).toEqual({
      detail: null,
      note: 'downloading',
      pct: 47.25,
      timeLeft: '00:12:34',
    })
  })

  it('reads a show from its queue snapshot', () => {
    expect(
      mediaProgress({
        ...SHOW,
        queueSnapshot: {
          progress: 12,
          status: 'warning',
          timeLeft: '01:00:00',
        },
      }),
    ).toEqual({ detail: null, note: 'warning', pct: 12, timeLeft: '01:00:00' })
  })

  it('answers null when there is no queue snapshot at all', () => {
    expect(mediaProgress(MOVIE)).toBeNull()
    expect(mediaProgress(SHOW)).toBeNull()
  })

  it('answers null when the queue reported no percentage', () => {
    expect(
      mediaProgress({ ...MOVIE, queueSnapshot: { status: 'delay' } }),
    ).toBeNull()
  })

  it('answers null for a percentage that is not a finite number', () => {
    expect(
      mediaProgress({ ...MOVIE, queueSnapshot: { progress: Number.NaN } }),
    ).toBeNull()
  })

  it('nulls the note and time left when the queue omitted them', () => {
    expect(mediaProgress({ ...SHOW, queueSnapshot: { progress: 0 } })).toEqual({
      detail: null,
      note: null,
      pct: 0,
      timeLeft: null,
    })
  })

  it('answers null for a video, which carries no progress anywhere on the wire', () => {
    expect(mediaProgress(VIDEO)).toBeNull()
  })
})
