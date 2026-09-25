import {
  EpisodeSchema,
  EpisodeStateEntrySchema,
  MediaSchema,
  MediaStateSchema,
  MovieSchema,
  ShowSchema,
  VideoSchema,
} from 'src/download/schema'
import {
  DownloadType,
  Episode,
  EpisodeStateEntry,
  isMediaInFlight,
  MEDIA_STATE_PRECEDENCE,
  MEDIA_STATES,
  MediaState,
  mediaState,
  Movie,
  rollupMediaState,
  Show,
  Video,
} from 'src/download/types'

const movie: Movie = {
  id: 'tmdb:438631',
  title: 'Dune',
  tmdbId: 438631,
  type: DownloadType.Movie,
}

const show: Show = {
  id: 'tvdb:121361',
  title: 'Some Show',
  tvdbId: 121361,
  type: DownloadType.Show,
}

const video: Video = {
  id: 'video:V1StGXR8_Z5',
  sourceUrl: 'https://example.com/video',
  title: 'A video',
  type: DownloadType.Video,
}

const episode: Episode = {
  episodeNumber: 5,
  hasFile: false,
  id: 4412,
  monitored: true,
  seasonNumber: 3,
}

describe('MEDIA_STATES / MediaStateSchema', () => {
  it('has exactly the seven plan 021 members', () => {
    expect(MEDIA_STATES).toEqual([
      'absent',
      'wanted',
      'downloading',
      'importing',
      'needs_attention',
      'paused',
      'available',
    ])
  })

  it('parses every member and nothing else', () => {
    for (const state of MEDIA_STATES) {
      expect(MediaStateSchema.parse(state)).toBe(state)
    }
    expect(MediaStateSchema.safeParse('completed').success).toBe(false)
    expect(MediaStateSchema.safeParse('needs-attention').success).toBe(false)
    expect(MediaStateSchema.safeParse(undefined).success).toBe(false)
  })
})

describe('MEDIA_STATE_PRECEDENCE', () => {
  it('ranks every state exactly once', () => {
    expect([...MEDIA_STATE_PRECEDENCE].sort()).toEqual([...MEDIA_STATES].sort())
  })

  it('is needs_attention > downloading > importing > paused > available > wanted > absent', () => {
    expect(MEDIA_STATE_PRECEDENCE).toEqual([
      'needs_attention',
      'downloading',
      'importing',
      'paused',
      'available',
      'wanted',
      'absent',
    ])
  })
})

describe('rollupMediaState', () => {
  it('is absent for an empty input', () => {
    expect(rollupMediaState([])).toBe('absent')
  })

  it.each(MEDIA_STATES.map(state => [state]))('is %s on its own', state => {
    expect(rollupMediaState([state])).toBe(state)
  })

  // Every adjacent pair, in both orders - the rollup must not depend on
  // which episode it happens to see first. Spelled out rather than derived
  // from MEDIA_STATE_PRECEDENCE so a reorder there fails here too.
  it.each<[MediaState, MediaState]>([
    ['needs_attention', 'downloading'],
    ['downloading', 'importing'],
    ['importing', 'paused'],
    ['paused', 'available'],
    ['available', 'wanted'],
    ['wanted', 'absent'],
  ])('%s outranks %s', (higher, lower) => {
    expect(rollupMediaState([higher, lower])).toBe(higher)
    expect(rollupMediaState([lower, higher])).toBe(higher)
  })

  it('makes a series with a few episodes on disk available', () => {
    const states: MediaState[] = [
      ...Array<MediaState>(42).fill('wanted'),
      ...Array<MediaState>(3).fill('available'),
    ]
    expect(rollupMediaState(states)).toBe('available')
  })

  it('lets one stuck episode outrank the rest of the series', () => {
    expect(
      rollupMediaState(['available', 'downloading', 'needs_attention']),
    ).toBe('needs_attention')
  })

  it('accepts any iterable, not just an array', () => {
    expect(rollupMediaState(new Set<MediaState>(['wanted', 'paused']))).toBe(
      'paused',
    )
  })
})

describe('mediaState', () => {
  it('falls back to absent when nothing has resolved the state', () => {
    expect(mediaState(movie)).toBe('absent')
    expect(mediaState(show)).toBe('absent')
    expect(mediaState(video)).toBe('absent')
  })

  it.each(MEDIA_STATES.map(state => [state]))('returns %s as-is', state => {
    expect(mediaState({ ...movie, state })).toBe(state)
  })
})

describe('isMediaInFlight', () => {
  it.each<[MediaState, boolean]>([
    ['absent', false],
    ['wanted', false],
    ['downloading', true],
    ['importing', true],
    ['needs_attention', true],
    ['paused', true],
    ['available', false],
  ])('%s -> %s', (state, inFlight) => {
    expect(isMediaInFlight(state)).toBe(inFlight)
  })
})

describe('new media fields', () => {
  // The additive half of plan 021: every fixture that exists today still
  // parses, because every new field is optional.
  it.each([
    ['movie', movie],
    ['show', show],
    ['video', video],
  ])('parses a %s without any of them', (_label, media) => {
    expect(MediaSchema.parse(media)).toEqual(media)
  })

  it('parses a movie carrying them', () => {
    const withState: Movie = {
      ...movie,
      addedAt: '2026-09-01T10:00:00.000Z',
      filePath: '/movies/Dune (2021)/Dune.mkv',
      monitored: true,
      state: 'available',
    }
    expect(MovieSchema.parse(withState)).toEqual(withState)
  })

  it('parses a stuck movie with its stateReason', () => {
    const stuck: Movie = {
      ...movie,
      monitored: true,
      queueSnapshot: { progress: 100, status: 'completed' },
      state: 'needs_attention',
      stateReason: 'No files found are eligible for import',
    }
    expect(MovieSchema.parse(stuck)).toEqual(stuck)
  })

  it('parses a show carrying them, including the episode counts', () => {
    const withState: Show = {
      ...show,
      addedAt: '2026-09-01T10:00:00.000Z',
      episodeCount: 45,
      episodeFileCount: 3,
      monitored: true,
      state: 'available',
    }
    expect(ShowSchema.parse(withState)).toEqual(withState)
  })

  it('parses a video carrying them', () => {
    const withState: Video = {
      ...video,
      addedAt: '2026-09-01T10:00:00.000Z',
      downloadUrls: ['https://storage.lilnas.io/videos/a.mp4'],
      state: 'available',
    }
    expect(VideoSchema.parse(withState)).toEqual(withState)
  })

  it('rejects an unknown state', () => {
    expect(MediaSchema.safeParse({ ...movie, state: 'done' }).success).toBe(
      false,
    )
  })

  it('rejects an addedAt that is not a full ISO datetime', () => {
    expect(
      MediaSchema.safeParse({ ...movie, addedAt: '2026-09-01' }).success,
    ).toBe(false)
  })

  it('rejects negative episode counts', () => {
    expect(ShowSchema.safeParse({ ...show, episodeCount: -1 }).success).toBe(
      false,
    )
    expect(
      ShowSchema.safeParse({ ...show, episodeFileCount: -1 }).success,
    ).toBe(false)
  })

  // Video extends MediaBase, not ManagedMediaBase: `monitored` is a
  // Radarr/Sonarr flag and never reaches the video arm.
  it('strips monitored from a video rather than carrying it', () => {
    expect(VideoSchema.parse({ ...video, monitored: true })).not.toHaveProperty(
      'monitored',
    )
  })

  // The episode counts are series-level Sonarr statistics - a movie has none.
  it('strips the episode counts from a movie', () => {
    const parsed = MovieSchema.parse({
      ...movie,
      episodeCount: 1,
      episodeFileCount: 1,
    })
    expect(parsed).not.toHaveProperty('episodeCount')
    expect(parsed).not.toHaveProperty('episodeFileCount')
  })
})

describe('Episode state fields', () => {
  it('parses an episode without them', () => {
    expect(EpisodeSchema.parse(episode)).toEqual(episode)
  })

  it('parses an episode carrying them', () => {
    const withState: Episode = {
      ...episode,
      queueSnapshot: {
        progress: 42,
        status: 'downloading',
        timeLeft: '00:10:00',
      },
      state: 'downloading',
    }
    expect(EpisodeSchema.parse(withState)).toEqual(withState)
  })

  it('rejects an unknown state', () => {
    expect(
      EpisodeSchema.safeParse({ ...episode, state: 'grabbed' }).success,
    ).toBe(false)
  })
})

describe('EpisodeStateEntrySchema', () => {
  const entry: EpisodeStateEntry = {
    episodeId: 4412,
    seasonNumber: 3,
    state: 'wanted',
  }

  it('parses a minimal entry', () => {
    expect(EpisodeStateEntrySchema.parse(entry)).toEqual(entry)
  })

  it('carries a queue snapshot when there is one', () => {
    const downloading: EpisodeStateEntry = {
      ...entry,
      queueSnapshot: { progress: 12.5, status: 'downloading' },
      state: 'downloading',
    }
    expect(EpisodeStateEntrySchema.parse(downloading)).toEqual(downloading)
  })

  it('accepts season 0 (specials)', () => {
    expect(
      EpisodeStateEntrySchema.safeParse({ ...entry, seasonNumber: 0 }).success,
    ).toBe(true)
  })

  it('requires state, unlike Episode', () => {
    expect(
      EpisodeStateEntrySchema.safeParse({ episodeId: 4412, seasonNumber: 3 })
        .success,
    ).toBe(false)
  })

  it.each([
    ['a zero episodeId', { ...entry, episodeId: 0 }],
    ['a fractional episodeId', { ...entry, episodeId: 1.5 }],
    ['a negative seasonNumber', { ...entry, seasonNumber: -1 }],
    ['an unknown state', { ...entry, state: 'grabbed' }],
    ['a missing episodeId', { seasonNumber: 3, state: 'wanted' }],
    ['a missing seasonNumber', { episodeId: 4412, state: 'wanted' }],
  ])('rejects %s', (_label, payload) => {
    expect(EpisodeStateEntrySchema.safeParse(payload).success).toBe(false)
  })
})
