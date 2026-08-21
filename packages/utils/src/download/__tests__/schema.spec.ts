import {
  ActivityQuerySchema,
  DiscoverQuerySchema,
  DownloadJobSchema,
  DownloadJobStatus,
  DownloadType,
  GalleryFacetsQuerySchema,
  GalleryItemSchema,
  GalleryQuerySchema,
  HistoryQuerySchema,
  MediaSchema,
  MovieSchema,
  ShowSchema,
  VideoSchema,
} from 'src/download/schema'
import { Media, Movie, Show, Video } from 'src/download/types'

describe('ActivityQuerySchema', () => {
  it('defaults limit to 24 and leaves type undefined when omitted', () => {
    const result = ActivityQuerySchema.parse({})
    expect(result).toEqual({ limit: 24 })
  })

  it('coerces a numeric string limit', () => {
    expect(ActivityQuerySchema.parse({ limit: '5' }).limit).toBe(5)
  })

  it.each(['0', '101', 'abc'])('rejects an invalid limit %s', invalid => {
    expect(ActivityQuerySchema.safeParse({ limit: invalid }).success).toBe(
      false,
    )
  })

  it('accepts a single type', () => {
    const result = ActivityQuerySchema.parse({ type: 'movie' })
    expect(result.type).toEqual(['movie'])
  })

  it('accepts a comma-separated multi type', () => {
    const result = ActivityQuerySchema.parse({ type: 'movie,video' })
    expect(result.type).toEqual(['movie', 'video'])
  })

  it('accepts a repeated-param multi type (array input)', () => {
    const result = ActivityQuerySchema.parse({ type: ['movie', 'video'] })
    expect(result.type).toEqual(['movie', 'video'])
  })

  it('rejects an unknown type', () => {
    expect(ActivityQuerySchema.safeParse({ type: 'bogus' }).success).toBe(false)
  })

  it('passes cursor through untouched', () => {
    expect(ActivityQuerySchema.parse({ cursor: 'abc123' }).cursor).toBe(
      'abc123',
    )
  })
})

describe('GalleryQuerySchema', () => {
  it('parses valid ISO date-only from/to bounds', () => {
    const result = GalleryQuerySchema.parse({
      from: '2026-01-01',
      to: '2026-01-31',
    })

    expect(result.from).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(result.to).toEqual(new Date('2026-01-31T23:59:59.999Z'))
  })

  it('rejects a garbage date format', () => {
    expect(GalleryQuerySchema.safeParse({ from: 'not-a-date' }).success).toBe(
      false,
    )
    expect(GalleryQuerySchema.safeParse({ from: '2026-13-40' }).success).toBe(
      false,
    )
  })

  it('rejects an inverted date range', () => {
    const result = GalleryQuerySchema.safeParse({
      from: '2026-02-01',
      to: '2026-01-01',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a range where from equals to', () => {
    const result = GalleryQuerySchema.safeParse({
      from: '2026-01-01',
      to: '2026-01-01',
    })

    expect(result.success).toBe(true)
  })

  it('accepts a requester filter', () => {
    expect(
      GalleryQuerySchema.parse({ requester: 'alice@example.com' }).requester,
    ).toBe('alice@example.com')
  })
})

describe('GalleryFacetsQuerySchema', () => {
  it('rejects an inverted date range', () => {
    expect(
      GalleryFacetsQuerySchema.safeParse({
        from: '2026-02-01',
        to: '2026-01-01',
      }).success,
    ).toBe(false)
  })

  it('accepts no filters at all', () => {
    expect(GalleryFacetsQuerySchema.safeParse({}).success).toBe(true)
  })
})

describe('HistoryQuerySchema', () => {
  it('defaults limit and leaves requester undefined when omitted', () => {
    expect(HistoryQuerySchema.parse({})).toEqual({ limit: 24 })
  })

  it('accepts an explicit requester', () => {
    expect(
      HistoryQuerySchema.parse({ requester: 'bob@example.com' }).requester,
    ).toBe('bob@example.com')
  })
})

describe('DiscoverQuerySchema', () => {
  it('requires at least a 2-character query', () => {
    expect(DiscoverQuerySchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(DiscoverQuerySchema.safeParse({ query: 'ab' }).success).toBe(true)
  })

  it('defaults sort to relevance', () => {
    expect(DiscoverQuerySchema.parse({ query: 'the office' }).sort).toBe(
      'relevance',
    )
  })

  it('rejects an unknown sort value', () => {
    expect(
      DiscoverQuerySchema.safeParse({ query: 'ab', sort: 'bogus' }).success,
    ).toBe(false)
  })

  it('accepts a multi-value genre filter', () => {
    const result = DiscoverQuerySchema.parse({
      genre: 'Action,Comedy',
      query: 'ab',
    })
    expect(result.genre).toEqual(['Action', 'Comedy'])
  })

  it('leaves genre undefined when omitted', () => {
    expect(DiscoverQuerySchema.parse({ query: 'ab' }).genre).toBeUndefined()
  })

  it('coerces yearFrom/yearTo to numbers', () => {
    const result = DiscoverQuerySchema.parse({
      query: 'ab',
      yearFrom: '2000',
      yearTo: '2010',
    })
    expect(result.yearFrom).toBe(2000)
    expect(result.yearTo).toBe(2010)
  })

  it('rejects an inverted year range', () => {
    expect(
      DiscoverQuerySchema.safeParse({
        query: 'ab',
        yearFrom: '2010',
        yearTo: '2000',
      }).success,
    ).toBe(false)
  })
})

const validMovie = {
  id: 'tmdb:438631',
  title: 'Dune',
  tmdbId: 438631,
  type: DownloadType.Movie,
}

const validShow = {
  id: 'tvdb:121361',
  title: 'Some Show',
  tvdbId: 121361,
  type: DownloadType.Show,
}

const validVideo = {
  id: 'video:V1StGXR8_Z5',
  sourceUrl: 'https://example.com/video',
  title: 'A video',
  type: DownloadType.Video,
}

describe('MediaSchema', () => {
  it.each([
    ['movie', validMovie],
    ['show', validShow],
    ['video', validVideo],
  ])('parses a valid %s payload', (_label, payload) => {
    expect(MediaSchema.safeParse(payload).success).toBe(true)
  })

  it('rejects a movie payload missing its required tmdbId', () => {
    expect(
      MediaSchema.safeParse({
        id: validMovie.id,
        title: validMovie.title,
        type: validMovie.type,
      }).success,
    ).toBe(false)
  })

  it('rejects a show payload carrying a movie tmdbId instead of tvdbId', () => {
    expect(
      MediaSchema.safeParse({
        id: validShow.id,
        title: validShow.title,
        tmdbId: 438631,
        type: validShow.type,
      }).success,
    ).toBe(false)
  })

  it('rejects a video payload missing its required sourceUrl', () => {
    expect(
      MediaSchema.safeParse({
        id: validVideo.id,
        title: validVideo.title,
        type: validVideo.type,
      }).success,
    ).toBe(false)
  })

  it('rejects an unrecognized type discriminant', () => {
    expect(
      MediaSchema.safeParse({ ...validMovie, type: 'documentary' }).success,
    ).toBe(false)
  })

  it('narrows to the movie arm and exposes tmdbId', () => {
    const media = MediaSchema.parse(validMovie)
    if (media.type !== DownloadType.Movie) {
      throw new Error('expected media to narrow to the movie arm')
    }
    expect(media.tmdbId).toBe(438631)
  })

  it('narrows to the show arm and exposes tvdbId', () => {
    const media = MediaSchema.parse(validShow)
    if (media.type !== DownloadType.Show) {
      throw new Error('expected media to narrow to the show arm')
    }
    expect(media.tvdbId).toBe(121361)
  })

  it('narrows to the video arm and exposes sourceUrl', () => {
    const media = MediaSchema.parse(validVideo)
    if (media.type !== DownloadType.Video) {
      throw new Error('expected media to narrow to the video arm')
    }
    expect(media.sourceUrl).toBe('https://example.com/video')
  })

  it('three-tier inheritance reaches filePath on Movie through ManagedMediaBase', () => {
    const media = MediaSchema.parse({
      ...validMovie,
      filePath: '/media/dune.mkv',
    })
    if (media.type !== DownloadType.Movie) {
      throw new Error('expected media to narrow to the movie arm')
    }
    expect(media.filePath).toBe('/media/dune.mkv')
  })
})

function assertNever(value: never): never {
  throw new Error(`unreachable media type: ${JSON.stringify(value)}`)
}

/**
 * A no-`default` exhaustive switch over `Media['type']` - if a fourth arm is
 * ever added to `MediaSchema` without a matching `case` here, this fails to
 * compile (the `default` branch would stop narrowing to `never`), which is
 * the whole point: it's the permanent compile-time tripwire for the
 * "forgotten discriminant override" failure mode described in plan §8 risk 1.
 */
function describeMedia(media: Media): string {
  switch (media.type) {
    case DownloadType.Movie:
      return `movie:${media.tmdbId}`
    case DownloadType.Show:
      return `show:${media.tvdbId}`
    case DownloadType.Video:
      return `video:${media.sourceUrl}`
    default:
      return assertNever(media)
  }
}

describe('exhaustive switch over Media.type', () => {
  it('compiles with no default fallthrough and handles every arm', () => {
    expect(describeMedia(MediaSchema.parse(validMovie))).toBe('movie:438631')
    expect(describeMedia(MediaSchema.parse(validShow))).toBe('show:121361')
    expect(describeMedia(MediaSchema.parse(validVideo))).toBe(
      'video:https://example.com/video',
    )
  })
})

describe('discriminant narrowing (permanent compile-time tripwire)', () => {
  it('narrows each arm to its literal discriminant, not the wider enum', () => {
    // If `.extend()` ever stops overriding the discriminant on an arm, the
    // corresponding assignment below starts compiling for real, `@ts-expect-error`
    // fires `TS2578 Unused '@ts-expect-error' directive`, and this test fails
    // to compile - loud, at build time, rather than the runtime
    // `Duplicate discriminator value` thrown at first `.parse()` (plan §8 risk 1).
    const wideType: DownloadType = DownloadType.Movie

    // @ts-expect-error - DownloadType (wide) must not be assignable to the
    // narrowed literal type of Video['type']. (`@ts-expect-error` only
    // suppresses the compile error - the assignment still runs at runtime -
    // so this test's real assertion is that `tsc`/`ts-jest` accepts the
    // directive at all; a stray, un-erroring line here is what proves the
    // tripwire.)
    const wrongAssignment: Video['type'] = wideType

    // @ts-expect-error - a bare string literal is not assignable to a TS
    // string enum member type. This is why DownloadType had to move into
    // schema.ts (Phase 1) rather than the arms using bare 'video' literals.
    const bareLiteralAssignment: Video['type'] = 'video'

    expect(wrongAssignment).toBe(DownloadType.Movie)
    expect(bareLiteralAssignment).toBe('video')
    expect(MediaSchema.parse(validVideo).type).toBe(DownloadType.Video)
  })

  it('MovieSchema/ShowSchema/VideoSchema each parse only their own arm shape', () => {
    expect(MovieSchema.safeParse(validShow).success).toBe(false)
    expect(ShowSchema.safeParse(validMovie).success).toBe(false)
    expect(VideoSchema.safeParse(validMovie).success).toBe(false)
  })
})

describe('DownloadJobSchema', () => {
  const baseJob = {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    hiddenAttribution: false,
    id: 'job-1',
    requester: null,
    status: DownloadJobStatus.Requested,
    updatedAt: '2026-08-20T12:00:00.000Z',
  }

  it.each([
    ['movie', validMovie],
    ['show', validShow],
    ['video', validVideo],
  ])('round-trips a job carrying a %s media arm', (_label, media) => {
    const input = { ...baseJob, media }
    const result = DownloadJobSchema.parse(input)
    expect(result).toEqual(input)
  })

  it('rejects a completedAt/createdAt that is not a full ISO datetime', () => {
    expect(
      DownloadJobSchema.safeParse({
        ...baseJob,
        createdAt: '2026-08-20',
        media: validVideo,
      }).success,
    ).toBe(false)
  })

  it('accepts a non-null requester', () => {
    const result = DownloadJobSchema.parse({
      ...baseJob,
      media: validVideo,
      requester: { email: 'alice@example.com', userId: 'u1' },
    })
    expect(result.requester).toEqual({
      email: 'alice@example.com',
      userId: 'u1',
    })
  })
})

describe('GalleryItemSchema', () => {
  it('parses a valid gallery item', () => {
    const result = GalleryItemSchema.safeParse({
      downloadCount: 2,
      lastDownloadedAt: '2026-08-20T12:00:00.000Z',
      lastRequester: null,
      media: validMovie,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-integer downloadCount', () => {
    expect(
      GalleryItemSchema.safeParse({
        downloadCount: 1.5,
        lastDownloadedAt: '2026-08-20T12:00:00.000Z',
        lastRequester: null,
        media: validMovie,
      }).success,
    ).toBe(false)
  })
})

describe('Media / Movie / Show types stay in sync with their schemas', () => {
  it('a hand-built Movie object satisfies both the TS type and the schema', () => {
    const movie: Movie = {
      id: 'tmdb:1',
      title: 'Dune',
      tmdbId: 1,
      type: DownloadType.Movie,
    }
    expect(MovieSchema.safeParse(movie).success).toBe(true)
  })

  it('a hand-built Show object satisfies both the TS type and the schema', () => {
    const show: Show = {
      id: 'tvdb:1',
      title: 'Some Show',
      tvdbId: 1,
      type: DownloadType.Show,
    }
    expect(ShowSchema.safeParse(show).success).toBe(true)
  })
})
