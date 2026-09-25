import {
  DownloadType,
  type Media,
  type Movie,
  type Show,
  type Video,
} from '@lilnas/utils/download/types'

import {
  isMediaRouteKind,
  mediaHref,
  mediaIdFromRoute,
  type MediaRouteKind,
  mediaTypeFromRoute,
  routeKindFromType,
} from 'src/lib/media-route'

function buildMovie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: 'tmdb:438631',
    title: 'Dune',
    tmdbId: 438631,
    type: DownloadType.Movie,
    ...overrides,
  }
}

function buildShow(overrides: Partial<Show> = {}): Show {
  return {
    id: 'tvdb:121361',
    title: 'Game of Thrones',
    tvdbId: 121361,
    type: DownloadType.Show,
    ...overrides,
  }
}

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video:V1StGXR8_Z5',
    sourceUrl: 'https://example.com/watch?v=abc',
    title: 'A video',
    type: DownloadType.Video,
    ...overrides,
  }
}

describe('mediaHref', () => {
  it('drops the `tmdb:` prefix for a movie', () => {
    expect(mediaHref(buildMovie())).toBe('/movies/438631')
  })

  it('drops the `tvdb:` prefix for a show', () => {
    expect(mediaHref(buildShow())).toBe('/shows/121361')
  })

  it('drops the `video:` prefix for a video', () => {
    expect(mediaHref(buildVideo())).toBe('/videos/V1StGXR8_Z5')
  })

  it('leaves a nanoid containing `-`/`_` unescaped', () => {
    expect(mediaHref(buildVideo({ id: 'video:a-b_c9' }))).toBe('/videos/a-b_c9')
  })

  it('never emits a raw `:` in the path', () => {
    const hrefs = [buildMovie(), buildShow(), buildVideo()].map(mediaHref)

    for (const href of hrefs) {
      expect(href).not.toContain(':')
    }
  })
})

describe('mediaIdFromRoute', () => {
  it('reattaches the prefix each kind owns', () => {
    expect(mediaIdFromRoute('movies', '438631')).toBe('tmdb:438631')
    expect(mediaIdFromRoute('shows', '121361')).toBe('tvdb:121361')
    expect(mediaIdFromRoute('videos', 'V1StGXR8_Z5')).toBe('video:V1StGXR8_Z5')
  })

  it.each<[MediaRouteKind, string]>([
    // A prefix smuggled through the segment - the whole reason this
    // validates rather than concatenating blindly.
    ['movies', 'tmdb:438631'],
    ['videos', 'tmdb:438631'],
    ['shows', 'tvdb:121361'],
    // Not an id at all.
    ['movies', ''],
    ['videos', ''],
    ['movies', 'abc'],
    ['movies', '12a'],
    ['movies', '12.5'],
    ['movies', '-1'],
    ['movies', ' 438631'],
    ['movies', '438631 '],
    // No leading zeros: exactly one URL must spell any given title.
    ['movies', '0438631'],
    // `0` is not a positive id.
    ['movies', '0'],
    // Past `Number.MAX_SAFE_INTEGER`.
    ['movies', '99999999999999999999'],
    // Path traversal / query smuggling through an un-decoded segment.
    ['videos', '../admin'],
    ['videos', 'a/b'],
    ['videos', 'a?b=c'],
    ['videos', 'a b'],
  ])('rejects %s/%s with null', (kind, segment) => {
    expect(mediaIdFromRoute(kind, segment)).toBeNull()
  })

  it('accepts a single-character video id', () => {
    expect(mediaIdFromRoute('videos', 'a')).toBe('video:a')
  })

  it('rejects a video id longer than a nanoid could be', () => {
    expect(mediaIdFromRoute('videos', 'a'.repeat(65))).toBeNull()
  })
})

describe('mediaHref <-> mediaIdFromRoute round trip', () => {
  it.each<Media>([buildMovie(), buildShow(), buildVideo()])(
    'recovers the original media id for a %p',
    media => {
      const [, kind, segment] = mediaHref(media).split('/')

      expect(kind).toBeDefined()
      expect(isMediaRouteKind(kind as string)).toBe(true)

      const roundTripped = mediaIdFromRoute(
        kind as MediaRouteKind,
        decodeURIComponent(segment as string),
      )

      expect(roundTripped).toBe(media.id)
    },
  )
})

describe('mediaTypeFromRoute / routeKindFromType', () => {
  it.each<[MediaRouteKind, DownloadType]>([
    ['movies', DownloadType.Movie],
    ['shows', DownloadType.Show],
    ['videos', DownloadType.Video],
  ])('maps %s <-> %s in both directions', (kind, type) => {
    expect(mediaTypeFromRoute(kind)).toBe(type)
    expect(routeKindFromType(type)).toBe(kind)
  })

  it('covers every DownloadType member', () => {
    for (const type of Object.values(DownloadType)) {
      expect(isMediaRouteKind(routeKindFromType(type))).toBe(true)
    }
  })
})

describe('isMediaRouteKind', () => {
  it('accepts the three route kinds', () => {
    expect(isMediaRouteKind('movies')).toBe(true)
    expect(isMediaRouteKind('shows')).toBe(true)
    expect(isMediaRouteKind('videos')).toBe(true)
  })

  it('rejects anything else, including inherited Object properties', () => {
    expect(isMediaRouteKind('movie')).toBe(false)
    expect(isMediaRouteKind('')).toBe(false)
    expect(isMediaRouteKind('toString')).toBe(false)
    expect(isMediaRouteKind('constructor')).toBe(false)
    expect(isMediaRouteKind('__proto__')).toBe(false)
  })
})
