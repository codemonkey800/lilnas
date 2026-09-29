import type { CreditResource, MovieFileResource } from '@lilnas/media/radarr'

import {
  CAST_CREDIT_LIMIT,
  languageList,
  languageName,
  movieFileCustomFormats,
  originalLanguageName,
  toMediaCredits,
  toMovieFile,
  toMovieRatings,
} from 'src/media/movie-metadata.util'

/** *End of Watch*'s `movieFile`, as the live Radarr returned it. */
const END_OF_WATCH_FILE: MovieFileResource = {
  customFormats: [],
  customFormatScore: null,
  dateAdded: '2025-01-04T18:22:10Z',
  edition: '',
  languages: [{ id: 1, name: 'English' }],
  mediaInfo: {
    audioBitrate: 0,
    audioChannels: 5.1,
    audioCodec: 'DTS-HD MA',
    audioLanguages: 'eng/eng',
    audioStreamCount: 2,
    resolution: '1920x1080',
    runTime: '1:48:57',
    scanType: 'Progressive',
    subtitles: 'eng',
    videoBitDepth: 8,
    videoBitrate: 0,
    videoCodec: 'AVC',
    videoDynamicRange: '',
    videoDynamicRangeType: '',
    videoFps: 23.976,
  },
  path: '/movies/End of Watch (2012)/End of Watch.mkv',
  quality: {
    quality: { id: 30, name: 'Remux-1080p', resolution: 1080 },
    revision: { isRepack: false, real: 0, version: 1 },
  },
  qualityCutoffNotMet: false,
  releaseGroup: 'UnKn0wn',
  sceneName: 'End.Of.Watch.2012.1080p.BluRay.REMUX.AVC.DTS-HD-MA.5.1-UnKn0wn',
  size: 33_361_815_167,
}

describe('languageName', () => {
  it.each([
    ['eng', 'English'],
    ['ENG', 'English'],
    // The bibliographic ISO 639-2 codes mediaInfo also uses.
    ['fre', 'French'],
    ['ger', 'German'],
    ['spa', 'Spanish'],
  ])('names %s as %s', (code, name) => {
    expect(languageName(code)).toBe(name)
  })

  // `Intl.DisplayNames` would answer `und` with `root`.
  it.each(['und', 'zxx', 'mis', 'mul', '', '  '])(
    'drops %p, which names no language',
    code => {
      expect(languageName(code)).toBeUndefined()
    },
  )

  it('keeps a malformed code as itself rather than throwing', () => {
    expect(languageName('not a code')).toBe('not a code')
  })
})

describe('languageList', () => {
  it('dedupes in stream order', () => {
    expect(languageList('eng/spa/eng/und')).toEqual(['English', 'Spanish'])
  })

  it.each([null, undefined, '', 'und'])('is undefined for %p', codes => {
    expect(languageList(codes)).toBeUndefined()
  })
})

describe('toMovieFile', () => {
  it('flattens a probed file into the wire shape', () => {
    expect(toMovieFile(END_OF_WATCH_FILE)).toEqual({
      audio: {
        channels: 5.1,
        codec: 'DTS-HD MA',
        languages: ['English'],
        streamCount: 2,
      },
      quality: 'Remux-1080p',
      qualityCutoffNotMet: false,
      releaseGroup: 'UnKn0wn',
      sceneName:
        'End.Of.Watch.2012.1080p.BluRay.REMUX.AVC.DTS-HD-MA.5.1-UnKn0wn',
      size: 33_361_815_167,
      subtitles: ['English'],
      video: {
        bitDepth: 8,
        codec: 'AVC',
        // Both dynamic-range fields empty on a probed file.
        dynamicRange: 'SDR',
        fps: 23.976,
        resolution: '1920x1080',
      },
    })
  })

  it('prefers the specific dynamic-range type over the bare HDR flag', () => {
    const file = toMovieFile({
      mediaInfo: {
        videoCodec: 'HEVC',
        videoDynamicRange: 'HDR',
        videoDynamicRangeType: 'DV HDR10',
      },
    })

    expect(file?.video?.dynamicRange).toBe('DV HDR10')
  })

  it("falls back to Radarr's parsed languages for an unprobed file", () => {
    const file = toMovieFile({
      languages: [
        { id: 1, name: 'English' },
        { id: 0, name: 'Unknown' },
      ],
      quality: { quality: { name: 'WEBDL-1080p' } },
    })

    expect(file).toEqual({
      audio: { languages: ['English'] },
      quality: 'WEBDL-1080p',
    })
    // Never claims SDR for a file nobody has looked inside.
    expect(file?.video).toBeUndefined()
  })

  // `GET /movie` never computes the embedded file's custom formats, so they
  // come from `/moviefile` via movieFileCustomFormats() instead.
  it('leaves custom formats to the /moviefile read', () => {
    const file = toMovieFile({
      customFormats: [{ name: 'DV' }],
      quality: { quality: { name: 'WEBDL-1080p' } },
    })

    expect(file).toEqual({ quality: 'WEBDL-1080p' })
  })

  it('carries an unmet cutoff and an edition', () => {
    const file = toMovieFile({
      edition: "Director's Cut",
      qualityCutoffNotMet: true,
    })

    expect(file).toEqual({
      edition: "Director's Cut",
      qualityCutoffNotMet: true,
    })
  })

  it.each([undefined, null])('is undefined for %p', resource => {
    expect(toMovieFile(resource)).toBeUndefined()
  })

  it('is undefined for a file resource with nothing worth saying', () => {
    expect(toMovieFile({ mediaInfo: { audioBitrate: 0 }, size: 0 })).toBe(
      undefined,
    )
  })
})

describe('movieFileCustomFormats', () => {
  it("keeps the served file's custom format names, deduped", () => {
    expect(
      movieFileCustomFormats([
        {
          ...END_OF_WATCH_FILE,
          customFormats: [{ name: 'DV' }, { name: 'HDR10+' }, { name: 'DV' }],
          id: 11,
        },
      ]),
    ).toEqual(['DV', 'HDR10+'])
  })

  // The same pick CurrentReleaseService makes: the first file with an id.
  it('reads the first file with an id', () => {
    expect(
      movieFileCustomFormats([
        { customFormats: [{ name: 'Ghost' }] },
        { customFormats: [{ name: 'IMAX' }], id: 12 },
        { customFormats: [{ name: 'Later' }], id: 13 },
      ]),
    ).toEqual(['IMAX'])
  })

  it('drops blank names', () => {
    expect(
      movieFileCustomFormats([
        { customFormats: [{ name: ' ' }, {}, { name: 'x265' }], id: 11 },
      ]),
    ).toEqual(['x265'])
  })

  // Radarr's JSON omits null keys, so a file that matched nothing may carry
  // no `customFormats` at all.
  it.each([
    ['an empty list', [{ customFormats: [], id: 11 }]],
    ['a missing key', [{ id: 11 }]],
    ['no files', []],
  ])('is undefined for %s', (_label, files: MovieFileResource[]) => {
    expect(movieFileCustomFormats(files)).toBeUndefined()
  })
})

describe('toMovieRatings', () => {
  it('keeps each scored source and drops the zeros Radarr sends for the rest', () => {
    expect(
      toMovieRatings({
        imdb: { type: 'user', value: 7.6, votes: 295_369 },
        metacritic: { type: 'user', value: 68, votes: 0 },
        rottenTomatoes: { type: 'user', value: 0, votes: 0 },
        tmdb: { type: 'user', value: 7.36, votes: 3750 },
      }),
    ).toEqual({
      imdb: { value: 7.6, votes: 295_369 },
      metacritic: { value: 68 },
      tmdb: { value: 7.36, votes: 3750 },
    })
  })

  it('is undefined when nothing scored the movie', () => {
    expect(toMovieRatings({ imdb: { value: 0 } })).toBeUndefined()
    expect(toMovieRatings(undefined)).toBeUndefined()
  })
})

describe('toMediaCredits', () => {
  const headshot = (path: string) => [
    {
      coverType: 'headshot' as const,
      remoteUrl: `https://image.tmdb.org/t/p/original/${path}`,
    },
  ]

  it('splits cast, directors and writers', () => {
    const credits: CreditResource[] = [
      {
        character: 'Mike Zavala',
        order: 1,
        personName: 'Michael Peña',
        type: 'cast',
      },
      {
        character: 'Brian Taylor',
        images: headshot('jake.jpg'),
        order: 0,
        personName: 'Jake Gyllenhaal',
        type: 'cast',
      },
      { job: 'Director', personName: 'David Ayer', type: 'crew' },
      { job: 'Writer', personName: 'David Ayer', type: 'crew' },
      { job: 'Story', personName: 'David Ayer', type: 'crew' },
      { job: 'Novel', personName: 'Someone Else', type: 'crew' },
      { job: 'Producer', personName: 'John Lesher', type: 'crew' },
    ]

    expect(toMediaCredits(credits)).toEqual({
      // Billing order, not response order.
      cast: [
        {
          character: 'Brian Taylor',
          // Resized from the multi-megabyte `original`.
          imageUrl: 'https://image.tmdb.org/t/p/w185/jake.jpg',
          name: 'Jake Gyllenhaal',
        },
        { character: 'Mike Zavala', name: 'Michael Peña' },
      ],
      directors: ['David Ayer'],
      // Credited on both `Writer` and `Story`, listed once; `Novel` is
      // source material, not the script.
      writers: ['David Ayer'],
    })
  })

  it(`caps the cast at ${CAST_CREDIT_LIMIT}`, () => {
    const cast: CreditResource[] = Array.from({ length: 30 }, (_, index) => ({
      order: index,
      personName: `Actor ${index}`,
      type: 'cast',
    }))

    const credits = toMediaCredits(cast)

    expect(credits.cast).toHaveLength(CAST_CREDIT_LIMIT)
    expect(credits.cast[0]?.name).toBe('Actor 0')
  })

  it('lists an actor in two roles once, under the first billing', () => {
    const credits = toMediaCredits([
      { character: 'Twin A', order: 0, personName: 'Sam', type: 'cast' },
      { character: 'Twin B', order: 1, personName: 'Sam', type: 'cast' },
    ])

    expect(credits.cast).toEqual([{ character: 'Twin A', name: 'Sam' }])
  })

  it('drops a headshot that is not https and a credit with no name', () => {
    const credits = toMediaCredits([
      {
        images: [{ coverType: 'headshot', remoteUrl: 'javascript:alert(1)' }],
        order: 0,
        personName: 'Sam',
        type: 'cast',
      },
      { order: 1, personName: '  ', type: 'cast' },
    ])

    expect(credits.cast).toEqual([{ name: 'Sam' }])
  })
})

describe('originalLanguageName', () => {
  it('reads the display name and drops Unknown', () => {
    expect(originalLanguageName({ id: 1, name: 'English' })).toBe('English')
    expect(originalLanguageName({ id: 0, name: 'Unknown' })).toBeUndefined()
    expect(originalLanguageName(undefined)).toBeUndefined()
  })
})
