import {
  ActivityQuerySchema,
  AdminStatsQuerySchema,
  AUDIT_ACTIONS,
  AuditLogEntrySchema,
  AuditLogQuerySchema,
  BadFileSchema,
  DeleteMediaFilesQuerySchema,
  DiscardImportQuerySchema,
  DiscordIdentitySchema,
  DiscordRequesterSchema,
  DiscoverQuerySchema,
  DownloadJobSchema,
  DownloadJobStatus,
  DownloadType,
  EmbyStatusSchema,
  EpisodeSchema,
  FlagBadFileInputSchema,
  GalleryFacetsQuerySchema,
  GalleryItemSchema,
  GalleryQuerySchema,
  GetMediaFileQuerySchema,
  GrabReleaseInputSchema,
  HistoryQuerySchema,
  ImportFilesInputSchema,
  ListImportCandidatesQuerySchema,
  ListReleasesQuerySchema,
  ManualImportCandidateSchema,
  MediaSchema,
  MovieSchema,
  ProfileQuerySchema,
  ReleaseSchema,
  ReplaceReleaseInputSchema,
  RequestShowInputSchema,
  SeasonSchema,
  ShowSchema,
  ShowScopeSchema,
  VideoProgressSchema,
  VideoSchema,
} from 'src/download/schema'
import {
  ManualImportCandidate,
  Media,
  Movie,
  Release,
  Show,
  Video,
} from 'src/download/types'

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
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
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

  it('accepts a non-null discordRequester', () => {
    const result = DownloadJobSchema.parse({
      ...baseJob,
      discordRequester: {
        discordUserId: '123456789012345678',
        discordUsername: 'alice.codes',
      },
      media: validVideo,
    })

    expect(result.discordRequester).toEqual({
      discordUserId: '123456789012345678',
      discordUsername: 'alice.codes',
    })
  })

  it('accepts a non-null linkedDiscord', () => {
    const result = DownloadJobSchema.parse({
      ...baseJob,
      linkedDiscord: {
        discordUserId: '123456789012345678',
        discordUsername: 'alice.codes',
      },
      media: validVideo,
    })

    expect(result.linkedDiscord).toEqual({
      discordUserId: '123456789012345678',
      discordUsername: 'alice.codes',
    })
  })

  // The two fields mean different things - "submitted from this Discord
  // account" versus "this requester is linked to that account" - so a web
  // job with a linked account must keep `discordRequester` null rather than
  // borrow the linked handle.
  it('keeps discordRequester and linkedDiscord independent of each other', () => {
    const result = DownloadJobSchema.parse({
      ...baseJob,
      linkedDiscord: {
        discordUserId: '987654321098765432',
        discordUsername: 'bob.builds',
      },
      media: validVideo,
      requester: { email: 'bob@example.com', userId: 'u2' },
    })

    expect(result.discordRequester).toBeNull()
    expect(result.linkedDiscord).toEqual({
      discordUserId: '987654321098765432',
      discordUsername: 'bob.builds',
    })
  })

  // Nullable, not optional: a serializer that forgot the field is a bug, not
  // a job without a Discord identity.
  it.each(['discordRequester', 'linkedDiscord'])(
    'rejects an omitted (rather than null) %s',
    field => {
      expect(
        DownloadJobSchema.safeParse(
          without({ ...baseJob, media: validVideo }, field),
        ).success,
      ).toBe(false)
    },
  )

  // A snowflake exceeds Number.MAX_SAFE_INTEGER, so both fields hold it as a
  // string and refuse a number rather than coerce one.
  it.each(['discordRequester', 'linkedDiscord'])(
    'rejects a numeric discordUserId on %s',
    field => {
      expect(
        DownloadJobSchema.safeParse({
          ...baseJob,
          [field]: {
            discordUserId: 12345,
            discordUsername: 'alice.codes',
          },
          media: validVideo,
        }).success,
      ).toBe(false)
    },
  )
})

describe('DiscordRequesterSchema / DiscordIdentitySchema', () => {
  const identity = {
    discordUserId: '123456789012345678',
    discordUsername: 'alice.codes',
  }

  it('DiscordRequesterSchema round-trips a Discord identity', () => {
    expect(DiscordRequesterSchema.parse(identity)).toEqual(identity)
  })

  // Structurally identical to DiscordRequesterSchema on purpose - the two
  // are separate because they mean different things, not different shapes.
  it('DiscordIdentitySchema round-trips the same shape', () => {
    expect(DiscordIdentitySchema.parse(identity)).toEqual(identity)
  })

  // A snowflake exceeds Number.MAX_SAFE_INTEGER, so a number would silently
  // round it - the schema refuses one rather than coerce.
  it('rejects a numeric discordUserId', () => {
    expect(
      DiscordRequesterSchema.safeParse({ ...identity, discordUserId: 12345 })
        .success,
    ).toBe(false)
    expect(
      DiscordIdentitySchema.safeParse({ ...identity, discordUserId: 12345 })
        .success,
    ).toBe(false)
  })

  it.each(['discordUserId', 'discordUsername'])(
    'rejects an identity missing %s',
    field => {
      expect(
        DiscordRequesterSchema.safeParse(without(identity, field)).success,
      ).toBe(false)
    },
  )

  // The display name rides the `x-discord-display-name` header only - it is
  // deliberately not part of the persisted identity, so an unknown key is
  // stripped rather than carried onto a job row.
  it('strips a displayName rather than carrying it onto the identity', () => {
    expect(
      DiscordRequesterSchema.parse({ ...identity, displayName: 'Alice' }),
    ).toEqual(identity)
  })
})

describe('GalleryItemSchema', () => {
  it('parses a valid gallery item', () => {
    const result = GalleryItemSchema.safeParse({
      addedAt: '2026-08-19T08:00:00.000Z',
      downloadCount: 2,
      lastDiscordRequester: null,
      lastDownloadedAt: '2026-08-20T12:00:00.000Z',
      lastRequester: null,
      media: validMovie,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-integer downloadCount', () => {
    expect(
      GalleryItemSchema.safeParse({
        addedAt: '2026-08-19T08:00:00.000Z',
        downloadCount: 1.5,
        lastDiscordRequester: null,
        lastDownloadedAt: '2026-08-20T12:00:00.000Z',
        lastRequester: null,
        media: validMovie,
      }).success,
    ).toBe(false)
  })

  it('accepts a non-null lastDiscordRequester', () => {
    const result = GalleryItemSchema.parse({
      addedAt: '2026-08-19T08:00:00.000Z',
      downloadCount: 2,
      lastDiscordRequester: {
        discordUserId: '123456789012345678',
        discordUsername: 'alice.codes',
      },
      lastDownloadedAt: '2026-08-20T12:00:00.000Z',
      lastRequester: null,
      media: validMovie,
    })

    expect(result.lastDiscordRequester).toEqual({
      discordUserId: '123456789012345678',
      discordUsername: 'alice.codes',
    })
  })

  // Plan 021: the gallery lists the library, so a title nobody downloaded
  // through this app is a card with no attempt behind it.
  it('accepts a title with no download attempts', () => {
    const result = GalleryItemSchema.safeParse({
      addedAt: '2026-08-19T08:00:00.000Z',
      downloadCount: 0,
      lastDiscordRequester: null,
      lastDownloadedAt: null,
      lastRequester: null,
      media: validMovie,
    })
    expect(result.success).toBe(true)
  })

  it('rejects an item without addedAt', () => {
    expect(
      GalleryItemSchema.safeParse({
        downloadCount: 2,
        lastDiscordRequester: null,
        lastDownloadedAt: '2026-08-20T12:00:00.000Z',
        lastRequester: null,
        media: validMovie,
      }).success,
    ).toBe(false)
  })

  it('rejects an omitted (rather than null) lastDiscordRequester', () => {
    expect(
      GalleryItemSchema.safeParse({
        addedAt: '2026-08-19T08:00:00.000Z',
        downloadCount: 2,
        lastDownloadedAt: '2026-08-20T12:00:00.000Z',
        lastRequester: null,
        media: validMovie,
      }).success,
    ).toBe(false)
  })

  // Plan 022 follow-up: the latest job was adopted from Radarr/Sonarr. Optional,
  // so every row written before it (and tdr-bot's parse) stays valid.
  it('carries lastStartedUpstream when present and leaves it off when absent', () => {
    const base = {
      addedAt: '2026-08-19T08:00:00.000Z',
      downloadCount: 1,
      lastDiscordRequester: null,
      lastDownloadedAt: '2026-08-20T12:00:00.000Z',
      lastRequester: null,
      media: validMovie,
    }

    expect(
      GalleryItemSchema.parse({ ...base, lastStartedUpstream: true })
        .lastStartedUpstream,
    ).toBe(true)
    expect(GalleryItemSchema.parse(base)).not.toHaveProperty(
      'lastStartedUpstream',
    )
  })

  it('rejects a non-boolean lastStartedUpstream', () => {
    expect(
      GalleryItemSchema.safeParse({
        addedAt: '2026-08-19T08:00:00.000Z',
        downloadCount: 1,
        lastDiscordRequester: null,
        lastDownloadedAt: '2026-08-20T12:00:00.000Z',
        lastRequester: null,
        lastStartedUpstream: 'yes',
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

// ---- Phase 3 ----

const minimalRelease = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: 'indexer://abc',
  indexerId: 3,
  rejected: false,
  title: 'Some.Movie.2020.1080p',
}

/** A shallow copy of `source` with `field` removed. */
function without(
  source: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const copy = { ...source }
  delete copy[field]
  return copy
}

describe('ReleaseSchema', () => {
  it('parses a release carrying only the required fields', () => {
    expect(ReleaseSchema.parse(minimalRelease)).toEqual(minimalRelease)
  })

  it.each(['downloadAllowed', 'flaggedBad', 'guid', 'indexerId', 'rejected'])(
    'rejects a release missing %s',
    field => {
      expect(
        ReleaseSchema.safeParse(without(minimalRelease, field)).success,
      ).toBe(false)
    },
  )

  it('parses the flattened quality object', () => {
    const result = ReleaseSchema.parse({
      ...minimalRelease,
      quality: { name: 'WEBDL-1080p', resolution: 1080 },
    })
    expect(result.quality).toEqual({ name: 'WEBDL-1080p', resolution: 1080 })
  })

  it('accepts a quality with no resolution', () => {
    expect(
      ReleaseSchema.safeParse({
        ...minimalRelease,
        quality: { name: 'Unknown' },
      }).success,
    ).toBe(true)
  })

  it('carries the show-only fields through when present', () => {
    const result = ReleaseSchema.parse({
      ...minimalRelease,
      episodeNumbers: [1, 2],
      fullSeason: true,
      seasonNumber: 2,
    })
    expect(result).toMatchObject({
      episodeNumbers: [1, 2],
      fullSeason: true,
      seasonNumber: 2,
    })
  })

  it.each(['unknown', 'usenet', 'torrent'])('accepts protocol %s', protocol => {
    expect(
      ReleaseSchema.safeParse({ ...minimalRelease, protocol }).success,
    ).toBe(true)
  })

  it('rejects an unknown protocol', () => {
    expect(
      ReleaseSchema.safeParse({ ...minimalRelease, protocol: 'carrier-pigeon' })
        .success,
    ).toBe(false)
  })

  it('a hand-built Release object satisfies both the TS type and the schema', () => {
    const release: Release = {
      downloadAllowed: true,
      flaggedBad: true,
      guid: 'g',
      indexerId: 1,
      rejected: false,
      title: 't',
    }
    expect(ReleaseSchema.safeParse(release).success).toBe(true)
  })
})

describe('ListReleasesQuerySchema', () => {
  it('leaves both params undefined when omitted', () => {
    expect(ListReleasesQuerySchema.parse({})).toEqual({})
  })

  it('coerces numeric-string query params', () => {
    expect(
      ListReleasesQuerySchema.parse({ episodeId: '4412', seasonNumber: '2' }),
    ).toEqual({ episodeId: 4412, seasonNumber: 2 })
  })

  // Sonarr numbers specials as season 0, so 0 has to be a legal season -
  // unlike episodeId, where 0 is never a real id.
  it('accepts season 0 (specials)', () => {
    expect(ListReleasesQuerySchema.parse({ seasonNumber: '0' })).toEqual({
      seasonNumber: 0,
    })
  })

  it('rejects a negative seasonNumber', () => {
    expect(
      ListReleasesQuerySchema.safeParse({ seasonNumber: '-1' }).success,
    ).toBe(false)
  })

  it('rejects a zero episodeId', () => {
    expect(ListReleasesQuerySchema.safeParse({ episodeId: '0' }).success).toBe(
      false,
    )
  })
})

describe('GrabReleaseInputSchema', () => {
  it('parses the minimal { guid, indexerId } body', () => {
    expect(
      GrabReleaseInputSchema.parse({ guid: 'indexer://abc', indexerId: 3 }),
    ).toEqual({ guid: 'indexer://abc', indexerId: 3 })
  })

  it('carries the show-only scoping params through', () => {
    expect(
      GrabReleaseInputSchema.parse({
        episodeId: 4412,
        guid: 'g',
        indexerId: 1,
        seasonNumber: 2,
      }),
    ).toEqual({ episodeId: 4412, guid: 'g', indexerId: 1, seasonNumber: 2 })
  })

  it('rejects an empty guid', () => {
    expect(
      GrabReleaseInputSchema.safeParse({ guid: '', indexerId: 1 }).success,
    ).toBe(false)
  })

  it('does not coerce a string indexerId - this is a JSON body, not a query', () => {
    expect(
      GrabReleaseInputSchema.safeParse({ guid: 'g', indexerId: '1' }).success,
    ).toBe(false)
  })

  // A replace *is* a grab with a delete in front of it, so the schemas are
  // aliased rather than re-declared.
  it('is the same schema as ReplaceReleaseInputSchema', () => {
    expect(ReplaceReleaseInputSchema).toBe(GrabReleaseInputSchema)
  })
})

describe('FlagBadFileInputSchema', () => {
  it('requires only a guid', () => {
    expect(FlagBadFileInputSchema.parse({ guid: 'g' })).toEqual({ guid: 'g' })
  })

  it('accepts the denormalized display fields', () => {
    expect(
      FlagBadFileInputSchema.parse({
        guid: 'g',
        indexerId: 3,
        reason: 'Audio out of sync',
        title: 'Some.Movie.2020.1080p',
      }),
    ).toEqual({
      guid: 'g',
      indexerId: 3,
      reason: 'Audio out of sync',
      title: 'Some.Movie.2020.1080p',
    })
  })

  it('rejects an over-long reason', () => {
    expect(
      FlagBadFileInputSchema.safeParse({ guid: 'g', reason: 'x'.repeat(501) })
        .success,
    ).toBe(false)
  })
})

describe('BadFileSchema', () => {
  const validBadFile = {
    createdAt: '2026-08-20T12:00:00.000Z',
    flaggedBy: { email: 'alice@example.com', userId: 'u1' },
    id: 1,
    indexerId: null,
    mediaId: 'tmdb:27205',
    reason: null,
    releaseGuid: 'indexer://abc',
    releaseTitle: null,
  }

  it('parses a row whose optional columns are all null', () => {
    expect(BadFileSchema.parse(validBadFile)).toEqual(validBadFile)
  })

  // Nullable, not optional: these are DB columns, and a missing key would
  // mean the serializer forgot one rather than that the column was empty.
  it.each(['indexerId', 'reason', 'releaseTitle'])(
    'rejects an omitted (rather than null) %s',
    field => {
      expect(
        BadFileSchema.safeParse(without(validBadFile, field)).success,
      ).toBe(false)
    },
  )

  it('rejects a non-datetime createdAt', () => {
    expect(
      BadFileSchema.safeParse({ ...validBadFile, createdAt: '2026-08-20' })
        .success,
    ).toBe(false)
  })
})

// ---- Phase 4: per-episode/season granularity ----

describe('ShowScopeSchema', () => {
  it('accepts an empty scope - that is "the whole series"', () => {
    expect(ShowScopeSchema.parse({})).toEqual({})
  })

  it('carries all three fields through', () => {
    expect(
      ShowScopeSchema.parse({
        episodeId: 4412,
        episodeNumber: 5,
        seasonNumber: 3,
      }),
    ).toEqual({ episodeId: 4412, episodeNumber: 5, seasonNumber: 3 })
  })

  it('accepts season 0 (specials)', () => {
    expect(ShowScopeSchema.parse({ seasonNumber: 0 })).toEqual({
      seasonNumber: 0,
    })
  })

  it.each(['episodeId', 'episodeNumber'])('rejects a zero %s', field => {
    expect(ShowScopeSchema.safeParse({ [field]: 0 }).success).toBe(false)
  })

  it('rejects a negative seasonNumber', () => {
    expect(ShowScopeSchema.safeParse({ seasonNumber: -1 }).success).toBe(false)
  })
})

describe('DownloadJobSchema with a scope', () => {
  const baseJob = {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: validShow,
    requester: null,
    status: DownloadJobStatus.Requested,
    updatedAt: '2026-08-20T12:00:00.000Z',
  }

  it('round-trips a scoped show job', () => {
    const input = {
      ...baseJob,
      scope: { episodeId: 4412, episodeNumber: 5, seasonNumber: 3 },
    }
    expect(DownloadJobSchema.parse(input)).toEqual(input)
  })

  // The whole point of `.optional()`: every pre-Phase-4 job row parses
  // unchanged, so there is nothing to backfill.
  it('parses an unscoped job with no scope key at all', () => {
    expect(DownloadJobSchema.parse(baseJob).scope).toBeUndefined()
  })

  it('rejects a malformed scope rather than dropping it', () => {
    expect(
      DownloadJobSchema.safeParse({ ...baseJob, scope: { episodeId: -1 } })
        .success,
    ).toBe(false)
  })
})

describe('DownloadJobSchema with startedUpstream', () => {
  // An adopted job: Radarr started it, so nobody requested it here.
  const baseJob = {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: validMovie,
    requester: null,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-08-20T12:00:00.000Z',
  }

  it('round-trips an adopted job carrying startedUpstream', () => {
    const input = { ...baseJob, startedUpstream: true }
    expect(DownloadJobSchema.parse(input)).toEqual(input)
  })

  // Every job this app started, and every job before the field existed,
  // has no `startedUpstream` key at all.
  it('parses a job with no startedUpstream key', () => {
    expect(DownloadJobSchema.parse(baseJob).startedUpstream).toBeUndefined()
  })

  it('rejects a non-boolean startedUpstream rather than dropping it', () => {
    expect(
      DownloadJobSchema.safeParse({ ...baseJob, startedUpstream: 'radarr' })
        .success,
    ).toBe(false)
  })
})

describe('VideoProgressSchema', () => {
  // A progressive (non-fragmented) grab: one of two files that get merged,
  // with a real `total_bytes`.
  const progressive = {
    downloadedBytes: 2096128,
    etaSeconds: 0,
    fileCount: 2,
    fileIndex: 1,
    percent: 48.48,
    speedBps: 42971715.11,
    totalBytes: 4323893,
  }

  // An HLS grab: fragment counters, and a total that is only yt-dlp's
  // `total_bytes_estimate`. `etaSeconds` arrives as a float.
  const hls = {
    downloadedBytes: 27851094,
    etaSeconds: 31.97,
    fileIndex: 1,
    fragmentCount: 123,
    fragmentIndex: 4,
    percent: 4.07,
    speedBps: 18432231.02,
    totalBytes: 685111722,
    totalIsEstimate: true,
  }

  it.each([
    ['progressive', progressive],
    ['HLS', hls],
  ])('round-trips a mapped %s sample', (_label, sample) => {
    expect(VideoProgressSchema.parse(sample)).toEqual(sample)
  })

  it('accepts the bare minimum: bytes so far and the file index', () => {
    expect(
      VideoProgressSchema.safeParse({ downloadedBytes: 0, fileIndex: 1 })
        .success,
    ).toBe(true)
  })

  // yt-dlp prints `frag 0/123`, so a 0 index is its first fragment.
  it('accepts fragmentIndex 0', () => {
    expect(
      VideoProgressSchema.safeParse({ ...hls, fragmentIndex: 0 }).success,
    ).toBe(true)
  })

  it.each([
    ['percent above 100', { ...progressive, percent: 101 }],
    ['negative percent', { ...progressive, percent: -1 }],
    ['negative downloadedBytes', { ...progressive, downloadedBytes: -1 }],
    ['fractional downloadedBytes', { ...progressive, downloadedBytes: 1.5 }],
    // yt-dlp's `null` speed is mapped to an absent key, never passed through.
    ['null speedBps', { ...progressive, speedBps: null }],
    ['null etaSeconds', { ...progressive, etaSeconds: null }],
    ['negative speedBps', { ...progressive, speedBps: -1 }],
    ['fileIndex 0 (it is 1-based)', { ...progressive, fileIndex: 0 }],
    ['fileCount 0', { ...progressive, fileCount: 0 }],
    ['negative fragmentIndex', { ...hls, fragmentIndex: -1 }],
    ['fragmentCount 0', { ...hls, fragmentCount: 0 }],
    ['totalBytes 0', { ...progressive, totalBytes: 0 }],
  ])('rejects %s', (_label, input) => {
    expect(VideoProgressSchema.safeParse(input).success).toBe(false)
  })

  it('rejects a sample with no fileIndex', () => {
    expect(
      VideoProgressSchema.safeParse(without(progressive, 'fileIndex')).success,
    ).toBe(false)
  })
})

describe('DownloadJobSchema with progress', () => {
  const baseJob = {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: validVideo,
    requester: null,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-08-20T12:00:00.000Z',
  }

  const progress = {
    downloadedBytes: 2096128,
    fileIndex: 1,
    percent: 48.48,
    totalBytes: 4323893,
  }

  it('round-trips a video job carrying progress', () => {
    const input = { ...baseJob, progress }
    expect(DownloadJobSchema.parse(input)).toEqual(input)
  })

  // Every job before this field existed, every movie/show job, and every
  // job after a restart has no `progress` key at all.
  it('parses a job with no progress key', () => {
    expect(DownloadJobSchema.parse(baseJob).progress).toBeUndefined()
  })

  it('rejects a malformed progress rather than dropping it', () => {
    expect(
      DownloadJobSchema.safeParse({
        ...baseJob,
        progress: { ...progress, percent: 101 },
      }).success,
    ).toBe(false)
  })
})

describe('EpisodeSchema', () => {
  const validEpisode = {
    episodeNumber: 5,
    hasFile: false,
    id: 4412,
    monitored: true,
    seasonNumber: 3,
  }

  it('parses the minimal required set', () => {
    expect(EpisodeSchema.parse(validEpisode)).toEqual(validEpisode)
  })

  it('carries every optional display field through', () => {
    const full = {
      ...validEpisode,
      airDate: '2004-12-19T02:00:00Z',
      episodeFileId: 991,
      hasFile: true,
      overview: 'An episode',
      // Seconds on the wire - the mapper has already done the x60.
      runtime: 3540,
      title: 'Middle Ground',
    }
    expect(EpisodeSchema.parse(full)).toEqual(full)
  })

  // Sonarr reports `episodeFileId: 0` for "no file"; the mapper omits the
  // key instead, so a 0 arriving here means something upstream skipped it.
  it('rejects episodeFileId: 0 - absence is spelled by omitting the key', () => {
    expect(
      EpisodeSchema.safeParse({ ...validEpisode, episodeFileId: 0 }).success,
    ).toBe(false)
  })

  it('accepts season 0 and episode 0 (specials number both from zero)', () => {
    expect(
      EpisodeSchema.parse({
        ...validEpisode,
        episodeNumber: 0,
        seasonNumber: 0,
      }),
    ).toMatchObject({ episodeNumber: 0, seasonNumber: 0 })
  })

  it.each(['episodeNumber', 'hasFile', 'id', 'monitored', 'seasonNumber'])(
    'rejects an omitted %s',
    field => {
      expect(
        EpisodeSchema.safeParse(without(validEpisode, field)).success,
      ).toBe(false)
    },
  )

  it('carries currentReleaseGuid through when it could be recovered', () => {
    const withGuid = {
      ...validEpisode,
      currentReleaseGuid: 'indexer://f00ba7',
      hasFile: true,
    }
    expect(EpisodeSchema.parse(withGuid)).toEqual(withGuid)
  })

  // Absent is the normal case for a manually imported file, or for history
  // that has since been pruned - the episode still has to parse.
  it('leaves currentReleaseGuid optional', () => {
    expect(EpisodeSchema.parse(validEpisode).currentReleaseGuid).toBeUndefined()
  })

  it('rejects a non-string currentReleaseGuid', () => {
    expect(
      EpisodeSchema.safeParse({ ...validEpisode, currentReleaseGuid: 12345 })
        .success,
    ).toBe(false)
  })
})

describe('SeasonSchema', () => {
  const validSeason = {
    episodeCount: 12,
    episodeFileCount: 3,
    episodes: [
      {
        episodeNumber: 1,
        hasFile: true,
        id: 4400,
        monitored: true,
        seasonNumber: 3,
      },
    ],
    monitored: true,
    seasonNumber: 3,
    sizeOnDisk: 12_884_901_888,
  }

  it('parses a fully-populated season', () => {
    expect(SeasonSchema.parse(validSeason)).toEqual(validSeason)
  })

  // An announced-but-unaired season is a real season with nothing in it -
  // `[]`, never an omitted key.
  it('parses a season with no episodes yet', () => {
    expect(
      SeasonSchema.parse({
        episodeCount: 0,
        episodeFileCount: 0,
        episodes: [],
        monitored: false,
        seasonNumber: 4,
      }).episodes,
    ).toEqual([])
  })

  it('rejects an omitted episodes array', () => {
    expect(
      SeasonSchema.safeParse(without(validSeason, 'episodes')).success,
    ).toBe(false)
  })

  it('accepts season 0 (specials)', () => {
    expect(
      SeasonSchema.safeParse({ ...validSeason, seasonNumber: 0 }).success,
    ).toBe(true)
  })
})

describe('RequestShowInputSchema', () => {
  // The tdr-bot shim calls `requestShow({ tvdbId })` and must keep working.
  it('still parses a bare { tvdbId }', () => {
    expect(RequestShowInputSchema.parse({ tvdbId: 81189 })).toEqual({
      tvdbId: 81189,
    })
  })

  it('carries the Phase 4 scoping params through', () => {
    expect(
      RequestShowInputSchema.parse({
        episodeId: 4412,
        seasonNumber: 3,
        tvdbId: 81189,
      }),
    ).toEqual({ episodeId: 4412, seasonNumber: 3, tvdbId: 81189 })
  })

  // A JSON body, not a query string - a string here is a client bug.
  it('does not coerce a string seasonNumber', () => {
    expect(
      RequestShowInputSchema.safeParse({ seasonNumber: '3', tvdbId: 81189 })
        .success,
    ).toBe(false)
  })
})

describe('DeleteMediaFilesQuerySchema', () => {
  it('leaves both params undefined when omitted - that is "every file"', () => {
    expect(DeleteMediaFilesQuerySchema.parse({})).toEqual({})
  })

  // Query params, unlike RequestShowInputSchema's body fields above - this
  // asymmetry is exactly why the two share no zod fragment.
  it('coerces numeric-string query params', () => {
    expect(
      DeleteMediaFilesQuerySchema.parse({
        episodeId: '4412',
        seasonNumber: '3',
      }),
    ).toEqual({ episodeId: 4412, seasonNumber: 3 })
  })

  it('accepts season 0 (specials)', () => {
    expect(DeleteMediaFilesQuerySchema.parse({ seasonNumber: '0' })).toEqual({
      seasonNumber: 0,
    })
  })

  it('rejects a zero episodeId', () => {
    expect(
      DeleteMediaFilesQuerySchema.safeParse({ episodeId: '0' }).success,
    ).toBe(false)
  })
})

// ---- Phase 6: Emby playback handoff ----

describe('EmbyStatusSchema', () => {
  it.each(['indexed', 'indexing', 'unknown'])('parses the %s state', state => {
    expect(EmbyStatusSchema.parse({ state })).toEqual({ state })
  })

  it('carries itemId and watchUrl alongside the indexed state', () => {
    const indexed = {
      itemId: 'a1b2c3',
      state: 'indexed',
      watchUrl: 'https://emby.lilnas.io/web/index.html#!/item?id=a1b2c3',
    }
    expect(EmbyStatusSchema.parse(indexed)).toEqual(indexed)
  })

  it('requires state', () => {
    expect(EmbyStatusSchema.safeParse({ itemId: 'a1b2c3' }).success).toBe(false)
  })

  it('rejects an unrecognized state', () => {
    expect(EmbyStatusSchema.safeParse({ state: 'pending' }).success).toBe(false)
  })
})

describe('embyStatus on the Media hierarchy', () => {
  const embyStatus = {
    itemId: 'a1b2c3',
    state: 'indexed' as const,
    watchUrl: 'https://emby.lilnas.io/web/index.html#!/item?id=a1b2c3',
  }

  it.each([
    ['movie', validMovie],
    ['show', validShow],
  ])('reaches %s through ManagedMediaBase', (_label, media) => {
    expect(MediaSchema.parse({ ...media, embyStatus })).toEqual({
      ...media,
      embyStatus,
    })
  })

  it('stays optional - a managed media parses without it', () => {
    expect(MovieSchema.parse(validMovie)).toEqual(validMovie)
    expect(ShowSchema.parse(validShow)).toEqual(validShow)
  })

  it('rejects a managed media whose embyStatus is malformed', () => {
    expect(
      MovieSchema.safeParse({
        ...validMovie,
        embyStatus: { state: 'pending' },
      }).success,
    ).toBe(false)
  })

  // Video lives under MediaBaseSchema, not ManagedMediaBaseSchema, so
  // `embyStatus` is just an unknown key there - and zod objects strip
  // unknown keys by default rather than rejecting them.
  it('is stripped from a video rather than rejected', () => {
    const result = VideoSchema.safeParse({ ...validVideo, embyStatus })
    expect(result.success).toBe(true)
    expect(result.data).toEqual(validVideo)
    expect(result.data).not.toHaveProperty('embyStatus')
  })
})

describe('currentReleaseGuid on a movie', () => {
  const currentReleaseGuid = 'indexer://f00ba7'

  it('carries the guid through when the release could be recovered', () => {
    expect(MovieSchema.parse({ ...validMovie, currentReleaseGuid })).toEqual({
      ...validMovie,
      currentReleaseGuid,
    })
  })

  // Every other producer of a Movie - /discover, /movies/search, the gallery,
  // the resolver's placeholder path - leaves this absent, so the pre-existing
  // fixtures have to keep parsing untouched.
  it('stays optional - a movie with no recoverable release still parses', () => {
    const result = MovieSchema.parse(validMovie)
    expect(result).toEqual(validMovie)
    expect(result.currentReleaseGuid).toBeUndefined()
  })

  it('rejects a non-string guid', () => {
    expect(
      MovieSchema.safeParse({ ...validMovie, currentReleaseGuid: 12345 })
        .success,
    ).toBe(false)
  })

  // A series has no single current release - the guid is per-episode - so
  // ShowSchema never declared the field, and zod strips it as an unknown key.
  it('is stripped from a show rather than carried', () => {
    const result = ShowSchema.safeParse({ ...validShow, currentReleaseGuid })
    expect(result.success).toBe(true)
    expect(result.data).toEqual(validShow)
    expect(result.data).not.toHaveProperty('currentReleaseGuid')
  })
})

// ---- Phase 7: local save-to-device ----

describe('GetMediaFileQuerySchema', () => {
  // Query params, so both arrive as strings even when they read as numbers.
  it('coerces numeric-string query params', () => {
    expect(
      GetMediaFileQuerySchema.parse({ episodeId: '4412', part: '2' }),
    ).toEqual({ episodeId: 4412, part: 2 })
  })

  // The single-part video case, and the only default worth having.
  it('accepts part 0 - the first downloadUrls entry', () => {
    expect(GetMediaFileQuerySchema.parse({ part: '0' })).toEqual({ part: 0 })
  })

  // Whether an absent episodeId is legal depends on the `:id` prefix, which
  // this schema never sees - the controller decides, so `{}` parses here.
  it('parses to {} when both params are absent', () => {
    expect(GetMediaFileQuerySchema.parse({})).toEqual({})
  })

  it.each(['0', '-1'])('rejects a non-positive episodeId %s', invalid => {
    expect(
      GetMediaFileQuerySchema.safeParse({ episodeId: invalid }).success,
    ).toBe(false)
  })

  it('rejects a negative part', () => {
    expect(GetMediaFileQuerySchema.safeParse({ part: '-1' }).success).toBe(
      false,
    )
  })

  it.each(['episodeId', 'part'])('rejects a non-numeric %s', field => {
    expect(GetMediaFileQuerySchema.safeParse({ [field]: 'abc' }).success).toBe(
      false,
    )
  })

  it.each(['episodeId', 'part'])('rejects a fractional %s', field => {
    expect(GetMediaFileQuerySchema.safeParse({ [field]: '1.5' }).success).toBe(
      false,
    )
  })
})

// ---- Phase 8: admin dashboard & audit log ----

describe('AuditLogEntrySchema', () => {
  const validEntry = {
    action: 'video.create',
    actor: { email: 'alice@example.com', userId: 'u1' },
    createdAt: '2026-08-20T12:00:00.000Z',
    discordActor: null,
    id: 1,
    metadata: { url: 'https://example.com/watch?v=abc' },
    origin: 'web',
    targetId: 'job-1',
    targetType: 'job',
  }

  it('parses a fully populated row', () => {
    expect(AuditLogEntrySchema.parse(validEntry)).toEqual(validEntry)
  })

  it.each([...AUDIT_ACTIONS])('accepts the %s action', action => {
    expect(
      AuditLogEntrySchema.safeParse({ ...validEntry, action }).success,
    ).toBe(true)
  })

  it.each(['video.created', 'movie.request ', 'VIDEO.CREATE', ''])(
    'rejects the unknown action %p',
    action => {
      expect(
        AuditLogEntrySchema.safeParse({ ...validEntry, action }).success,
      ).toBe(false)
    },
  )

  // A service caller (tdr-bot, the yt-dlp updater) has no forwarded
  // identity, and an action like `ytdlp.check_update` has no target - so all
  // four of these are legitimately null together.
  it('parses a service row with no actor and no target', () => {
    const serviceEntry = {
      ...validEntry,
      action: 'ytdlp.check_update',
      actor: null,
      metadata: null,
      origin: 'service',
      targetId: null,
      targetType: null,
    }

    expect(AuditLogEntrySchema.parse(serviceEntry)).toEqual(serviceEntry)
  })

  // Nullable, not optional: these are DB columns, and a missing key would
  // mean the serializer forgot one rather than that the column was empty.
  it.each(['actor', 'discordActor', 'metadata', 'targetId', 'targetType'])(
    'rejects an omitted (rather than null) %s',
    field => {
      expect(
        AuditLogEntrySchema.safeParse(without(validEntry, field)).success,
      ).toBe(false)
    },
  )

  it('accepts an empty metadata object', () => {
    expect(
      AuditLogEntrySchema.parse({ ...validEntry, metadata: {} }).metadata,
    ).toEqual({})
  })

  // `metadata` is per-action detail that is rendered, never branched on, so
  // the value type is deliberately wide open.
  it('keeps heterogeneous metadata values untouched', () => {
    const metadata = { count: 3, nested: { a: [1, 2] }, ok: true }

    expect(
      AuditLogEntrySchema.parse({ ...validEntry, metadata }).metadata,
    ).toEqual(metadata)
  })

  it('rejects a non-object metadata', () => {
    expect(
      AuditLogEntrySchema.safeParse({ ...validEntry, metadata: 'nope' })
        .success,
    ).toBe(false)
  })

  it.each(['job', 'media'])('accepts the targetType %s', targetType => {
    expect(
      AuditLogEntrySchema.safeParse({ ...validEntry, targetType }).success,
    ).toBe(true)
  })

  it.each(['user', 'release', 'JOB'])(
    'rejects the unknown targetType %s',
    targetType => {
      expect(
        AuditLogEntrySchema.safeParse({ ...validEntry, targetType }).success,
      ).toBe(false)
    },
  )

  it.each(['service', 'web', 'discord'])('accepts the origin %s', origin => {
    expect(
      AuditLogEntrySchema.safeParse({ ...validEntry, origin }).success,
    ).toBe(true)
  })

  // A Discord-submitted action has no forwarded identity at all, so `actor`
  // stays null while `discordActor` carries who ran the command.
  it('parses a discord row with a discordActor and no actor', () => {
    const discordEntry = {
      ...validEntry,
      actor: null,
      discordActor: {
        discordUserId: '123456789012345678',
        discordUsername: 'alice.codes',
      },
      origin: 'discord',
    }

    expect(AuditLogEntrySchema.parse(discordEntry)).toEqual(discordEntry)
  })

  it('rejects an unknown origin', () => {
    expect(
      AuditLogEntrySchema.safeParse({ ...validEntry, origin: 'cron' }).success,
    ).toBe(false)
  })

  it('rejects a date-only createdAt', () => {
    expect(
      AuditLogEntrySchema.safeParse({ ...validEntry, createdAt: '2026-08-20' })
        .success,
    ).toBe(false)
  })
})

describe('AuditLogQuerySchema', () => {
  it('defaults limit to 24 and leaves every filter undefined', () => {
    expect(AuditLogQuerySchema.parse({})).toEqual({ limit: 24 })
  })

  it('coerces a numeric string limit', () => {
    expect(AuditLogQuerySchema.parse({ limit: '5' }).limit).toBe(5)
  })

  it.each(['0', '101', 'abc'])('rejects an invalid limit %s', invalid => {
    expect(AuditLogQuerySchema.safeParse({ limit: invalid }).success).toBe(
      false,
    )
  })

  it('passes cursor through untouched', () => {
    expect(AuditLogQuerySchema.parse({ cursor: 'abc123' }).cursor).toBe(
      'abc123',
    )
  })

  it('accepts a known action filter', () => {
    expect(AuditLogQuerySchema.parse({ action: 'release.grab' }).action).toBe(
      'release.grab',
    )
  })

  it('rejects an unknown action filter', () => {
    expect(
      AuditLogQuerySchema.safeParse({ action: 'video.yeet' }).success,
    ).toBe(false)
  })

  it('accepts an actor filter', () => {
    expect(
      AuditLogQuerySchema.parse({ actor: 'alice@example.com' }).actor,
    ).toBe('alice@example.com')
  })

  it('rejects an empty actor filter', () => {
    expect(AuditLogQuerySchema.safeParse({ actor: '' }).success).toBe(false)
  })

  // The same day-boundary transforms `GalleryQuerySchema` applies, so a
  // date picker behaves identically on both.
  it('widens from/to to UTC day boundaries', () => {
    const result = AuditLogQuerySchema.parse({
      from: '2026-01-01',
      to: '2026-01-31',
    })

    expect(result.from).toEqual(new Date('2026-01-01T00:00:00.000Z'))
    expect(result.to).toEqual(new Date('2026-01-31T23:59:59.999Z'))
  })

  it.each(['not-a-date', '2026-13-40', '2026-01-01T00:00:00.000Z'])(
    'rejects the non-date-only from %p',
    from => {
      expect(AuditLogQuerySchema.safeParse({ from }).success).toBe(false)
    },
  )

  it('rejects an inverted date range', () => {
    expect(
      AuditLogQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-01' })
        .success,
    ).toBe(false)
  })

  it('accepts a range where from equals to', () => {
    expect(
      AuditLogQuerySchema.safeParse({ from: '2026-01-01', to: '2026-01-01' })
        .success,
    ).toBe(true)
  })
})

describe('AdminStatsQuerySchema', () => {
  it('defaults days to 30', () => {
    expect(AdminStatsQuerySchema.parse({})).toEqual({ days: 30 })
  })

  // Query param, so it always arrives as a string even though it reads as a
  // number.
  it('coerces a numeric string', () => {
    expect(AdminStatsQuerySchema.parse({ days: '7' }).days).toBe(7)
  })

  it.each(['1', '365'])('accepts the boundary value %s', days => {
    expect(AdminStatsQuerySchema.parse({ days }).days).toBe(Number(days))
  })

  it.each(['0', '-1', '366', '1.5', 'abc'])('rejects days %s', days => {
    expect(AdminStatsQuerySchema.safeParse({ days }).success).toBe(false)
  })
})

describe('ProfileQuerySchema', () => {
  it('defaults days to 30 and leaves requester undefined when omitted', () => {
    expect(ProfileQuerySchema.parse({})).toEqual({ days: 30 })
  })

  // Query param, so it always arrives as a string even though it reads as a
  // number.
  it('coerces a numeric string', () => {
    expect(ProfileQuerySchema.parse({ days: '14' }).days).toBe(14)
  })

  it.each(['0', '366'])('rejects days %s', days => {
    expect(ProfileQuerySchema.safeParse({ days }).success).toBe(false)
  })

  it('accepts a requester email', () => {
    expect(
      ProfileQuerySchema.parse({ requester: 'user@example.com' }).requester,
    ).toBe('user@example.com')
  })

  it('rejects an empty requester', () => {
    expect(ProfileQuerySchema.safeParse({ requester: '' }).success).toBe(false)
  })
})

// ---- Plan 020: stuck imports and the in-app importer ----

const minimalCandidate = {
  importable: true,
  path: '/downloads/Some.Movie.2020.1080p/movie.mkv',
  rejections: [],
}

describe('ManualImportCandidateSchema', () => {
  it('parses a candidate carrying only the required fields', () => {
    expect(ManualImportCandidateSchema.parse(minimalCandidate)).toEqual(
      minimalCandidate,
    )
  })

  it.each(['importable', 'path', 'rejections'])(
    'rejects a candidate missing %s',
    field => {
      expect(
        ManualImportCandidateSchema.safeParse(without(minimalCandidate, field))
          .success,
      ).toBe(false)
    },
  )

  it('round-trips an importable movie candidate with every field set', () => {
    const candidate = {
      ...minimalCandidate,
      downloadId: 'sabnzbd-7f3',
      languages: ['English'],
      movieTitle: 'Some Movie',
      name: 'movie.mkv',
      quality: { name: 'WEBDL-1080p', resolution: 1080 },
      rejections: ['Unknown movie'],
      relativePath: 'movie.mkv',
      releaseGroup: 'NTB',
      size: 8_589_934_592,
    }

    expect(ManualImportCandidateSchema.parse(candidate)).toEqual(candidate)
  })

  it('round-trips a blocked show candidate with its episodes and reason', () => {
    const candidate = {
      blockedReason: 'No episode matched this file',
      episodes: [
        { episodeNumber: 5, id: 4412, seasonNumber: 3, title: 'Straight Time' },
      ],
      importable: false,
      path: '/downloads/The.Wire.S03E05/episode.mkv',
      rejections: ['Unknown series'],
    }

    expect(ManualImportCandidateSchema.parse(candidate)).toEqual(candidate)
  })

  // The rejections upstream raises are informational here, not blocking -
  // manually importing is precisely how a human overrides them.
  it('accepts rejections on a candidate that is still importable', () => {
    const result = ManualImportCandidateSchema.parse({
      ...minimalCandidate,
      rejections: ['Not a preferred word upgrade'],
    })

    expect(result.importable).toBe(true)
    expect(result.rejections).toEqual(['Not a preferred word upgrade'])
  })

  it('accepts a quality with no resolution, like a release', () => {
    expect(
      ManualImportCandidateSchema.safeParse({
        ...minimalCandidate,
        quality: { name: 'Unknown' },
      }).success,
    ).toBe(true)
  })

  it('a hand-built ManualImportCandidate satisfies both the TS type and the schema', () => {
    const candidate: ManualImportCandidate = {
      importable: false,
      blockedReason: 'No quality could be resolved',
      path: '/downloads/x.mkv',
      rejections: [],
    }

    expect(ManualImportCandidateSchema.safeParse(candidate).success).toBe(true)
  })
})

describe('ListImportCandidatesQuerySchema / DiscardImportQuerySchema', () => {
  // Both are the release list's scope query, aliased rather than
  // re-declared so the three can never drift.
  it('are the same schema as ListReleasesQuerySchema', () => {
    expect(ListImportCandidatesQuerySchema).toBe(ListReleasesQuerySchema)
    expect(DiscardImportQuerySchema).toBe(ListReleasesQuerySchema)
  })

  it('coerces numeric-string query params', () => {
    expect(
      ListImportCandidatesQuerySchema.parse({
        episodeId: '4412',
        seasonNumber: '2',
      }),
    ).toEqual({ episodeId: 4412, seasonNumber: 2 })
  })
})

describe('ImportFilesInputSchema', () => {
  it('parses the minimal { paths } body', () => {
    expect(
      ImportFilesInputSchema.parse({ paths: ['/downloads/a.mkv'] }),
    ).toEqual({ paths: ['/downloads/a.mkv'] })
  })

  it('carries the show-only scoping params through', () => {
    expect(
      ImportFilesInputSchema.parse({
        episodeId: 4412,
        paths: ['/downloads/a.mkv', '/downloads/b.mkv'],
        seasonNumber: 3,
      }),
    ).toEqual({
      episodeId: 4412,
      paths: ['/downloads/a.mkv', '/downloads/b.mkv'],
      seasonNumber: 3,
    })
  })

  // An empty commit is a client bug worth a 400, not a silent no-op that
  // reports "imported 0 files" as a success.
  it('rejects an empty paths array', () => {
    expect(ImportFilesInputSchema.safeParse({ paths: [] }).success).toBe(false)
  })

  it('rejects a missing paths array', () => {
    expect(ImportFilesInputSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an empty path string', () => {
    expect(ImportFilesInputSchema.safeParse({ paths: [''] }).success).toBe(
      false,
    )
  })

  it('accepts season 0 (specials)', () => {
    expect(
      ImportFilesInputSchema.parse({ paths: ['/a.mkv'], seasonNumber: 0 })
        .seasonNumber,
    ).toBe(0)
  })

  it('does not coerce a string seasonNumber - this is a JSON body, not a query', () => {
    expect(
      ImportFilesInputSchema.safeParse({ paths: ['/a.mkv'], seasonNumber: '3' })
        .success,
    ).toBe(false)
  })
})

describe('AUDIT_ACTIONS additions', () => {
  it('carries the two manual-import actions', () => {
    expect(AUDIT_ACTIONS).toEqual(
      expect.arrayContaining(['media.manual_import', 'media.discard_download']),
    )
  })

  // Append-only: rows already written keep whatever value they were written
  // with, so the existing members must never be reordered or removed.
  it('leaves the pre-existing actions in place, in order', () => {
    expect(AUDIT_ACTIONS.slice(0, 18)).toEqual([
      'video.create',
      'video.cancel',
      'video.pause',
      'video.resume',
      'video.delete',
      'movie.request',
      'movie.delete',
      'show.request',
      'show.delete',
      'media.delete_files',
      'media.save_file',
      'release.grab',
      'release.replace',
      'file.flag_bad',
      'file.unflag_bad',
      'ytdlp.check_update',
      'media.manual_import',
      'media.discard_download',
    ])
  })

  it('appends the two media-cancel actions after the pinned prefix', () => {
    expect(AUDIT_ACTIONS.slice(18, 20)).toEqual(['movie.cancel', 'show.cancel'])
  })
})
