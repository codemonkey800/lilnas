import { EmbyService } from 'src/emby/emby.service'

const TEST_EMBY_USERNAME = 'test-emby-user'
const TEST_USER_ID = 'test-user-id'

const USERS_RESPONSE_BODY = [{ Id: TEST_USER_ID, Name: TEST_EMBY_USERNAME }]

const PLAYBACK_INFO_RESPONSE_BODY = {
  MediaSources: [
    {
      Id: 'ms-1',
      DirectStreamUrl: '/Videos/1/stream.mp4?Static=true',
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      RunTimeTicks: 1000,
      MediaStreams: [],
    },
  ],
  PlaySessionId: 'sess-1',
}

// Builds a PlaybackInfo body around a single overridable media source, so each
// test can describe exactly the Emby capability shape it exercises.
function playbackInfoBody(mediaSource: Record<string, unknown>): unknown {
  return {
    MediaSources: [
      { Id: 'ms-1', RunTimeTicks: 1000, MediaStreams: [], ...mediaSource },
    ],
    PlaySessionId: 'sess-1',
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
  })
}

// `fetch`'s first argument may be a `URL` instance (which is what every
// EmbyService call site actually passes, via `toAbsoluteEmbyUrl`), a plain
// string, or a `Request` — normalize all three to a pathname so the mock can
// tell the `/Users` lookup apart from the `/PlaybackInfo` POST.
function requestPathname(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.pathname
  }
  const href = typeof input === 'string' ? input : input.url
  return new URL(href).pathname
}

describe('EmbyService.getPlaybackInfo', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  // Installs the fetch mock, resolving `/Users` and returning the given
  // PlaybackInfo body for the POST. Tests that care about mode detection call
  // this with a bespoke media source; the rest use the default set in
  // beforeEach.
  function mockEmby(playbackInfoBodyValue: unknown): void {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const pathname = requestPathname(input)

      if (pathname === '/Users') {
        return jsonResponse(USERS_RESPONSE_BODY)
      }
      if (pathname.endsWith('/PlaybackInfo')) {
        return jsonResponse(playbackInfoBodyValue)
      }

      throw new Error(`Unexpected fetch call to ${pathname}`)
    })
  }

  beforeEach(() => {
    process.env.EMBY_URL = 'https://emby.test'
    process.env.EMBY_API_KEY = 'test-api-key'
    process.env.EMBY_USERNAME = TEST_EMBY_USERNAME

    mockEmby(PLAYBACK_INFO_RESPONSE_BODY)
  })

  // The regression this guards against: this Emby server throws a
  // server-side 500 (NullReferenceException) whenever `UserId` is omitted
  // from the `PlaybackInfo` POST body — confirmed live against the real
  // server for 3 different items, all failing without `UserId` and all
  // succeeding with a real one added. `getPlaybackInfo` must always resolve
  // `EMBY_USERNAME` to a real Emby user id and send it as `UserId`.
  it('includes the resolved Emby UserId in the PlaybackInfo POST body', async () => {
    await new EmbyService().getPlaybackInfo('123', {})

    const playbackInfoCall = fetchSpy.mock.calls.find(call =>
      requestPathname(call[0]).endsWith('/PlaybackInfo'),
    )
    expect(playbackInfoCall).toBeDefined()

    const init = playbackInfoCall![1]
    const parsedBody = JSON.parse(init!.body as string) as { UserId?: string }

    expect(parsedBody.UserId).toBeDefined()
    expect(parsedBody.UserId).toBe(TEST_USER_ID)
  })

  // The regression that caused "Emby request to .../Items/main.m3u8/PlaybackInfo
  // failed: 500 — Unrecognized Guid format". For any source that must transcode
  // (mkv container, or image-based PGS subs → SubtitleCodecNotSupported), this
  // Emby server reports SupportsDirectStream:false yet populates DirectStreamUrl
  // with the SAME HLS `master.m3u8` as TranscodingUrl. The old heuristic
  // ("DirectStreamUrl present ⇒ direct") sent those playlists through the
  // direct-play Range proxy, whose relative playlist children then re-entered
  // /theater/stream/:id as id="main.m3u8". Mode must be driven by the capability
  // flags, and rawUrl must be the transcoding URL.
  it('classifies an HLS transcode as hls even when DirectStreamUrl is populated', async () => {
    const masterM3u8 =
      '/videos/29169/master.m3u8?MediaSourceId=mediasource_29169&SubtitleMethod=Encode&TranscodeReasons=SubtitleCodecNotSupported'
    mockEmby(
      playbackInfoBody({
        DirectStreamUrl: masterM3u8,
        TranscodingUrl: masterM3u8,
        SupportsDirectPlay: false,
        SupportsDirectStream: false,
        TranscodingSubProtocol: 'hls',
      }),
    )

    const result = await new EmbyService().getPlaybackInfo('29169', {})

    expect(result.mode).toBe('hls')
    expect(result.rawUrl).toBe(masterM3u8)
  })

  it('classifies a genuinely direct-streamable source as direct', async () => {
    const streamUrl = '/videos/1/stream.mp4?Static=true'
    mockEmby(
      playbackInfoBody({
        DirectStreamUrl: streamUrl,
        SupportsDirectPlay: true,
        SupportsDirectStream: true,
      }),
    )

    const result = await new EmbyService().getPlaybackInfo('1', {})

    expect(result.mode).toBe('direct')
    expect(result.rawUrl).toBe(streamUrl)
  })
})

describe('EmbyService.listItems', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    process.env.EMBY_URL = 'https://emby.test'
    process.env.EMBY_API_KEY = 'test-api-key'
  })

  it('maps Emby Type to the theater movie/series union', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse({
        Items: [
          { Id: 'm1', Name: 'A Movie', Type: 'Movie' },
          { Id: 's1', Name: 'A Series', Type: 'Series' },
        ],
      }),
    )

    const items = await new EmbyService().listItems()

    expect(items).toEqual([
      expect.objectContaining({ id: 'm1', type: 'movie' }),
      expect.objectContaining({ id: 's1', type: 'series' }),
    ])

    const requestedUrl = fetchSpy.mock.calls[0]![0] as URL
    expect(requestedUrl.searchParams.get('IncludeItemTypes')).toBe(
      'Movie,Series',
    )
  })
})

describe('EmbyService.listSeasons / listEpisodes', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>

  beforeEach(() => {
    process.env.EMBY_URL = 'https://emby.test'
    process.env.EMBY_API_KEY = 'test-api-key'
    process.env.EMBY_USERNAME = TEST_EMBY_USERNAME
  })

  function mockUsersThen(finalResponse: unknown): void {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async input => {
      const pathname = requestPathname(input)
      if (pathname === '/Users') {
        return jsonResponse(USERS_RESPONSE_BODY)
      }
      return jsonResponse(finalResponse)
    })
  }

  it('maps season fields and sends the resolved UserId', async () => {
    mockUsersThen({
      Items: [{ Id: 'season-1', Name: 'Season 1', IndexNumber: 1 }],
    })

    const seasons = await new EmbyService().listSeasons('series-1')

    expect(seasons).toEqual([
      { id: 'season-1', name: 'Season 1', indexNumber: 1 },
    ])
    const seasonsCall = fetchSpy.mock.calls.find(call =>
      requestPathname(call[0]).endsWith('/Seasons'),
    )
    expect(seasonsCall).toBeDefined()
    expect((seasonsCall![0] as URL).searchParams.get('UserId')).toBe(
      TEST_USER_ID,
    )
  })

  it('maps episode fields and sends SeasonId + UserId', async () => {
    mockUsersThen({
      Items: [
        {
          Id: 'ep-1',
          Name: 'Pilot',
          IndexNumber: 1,
          Overview: 'The first episode',
          RunTimeTicks: 6_000_000_000,
          ImageTags: { Primary: 'tag-1' },
        },
      ],
    })

    const episodes = await new EmbyService().listEpisodes(
      'series-1',
      'season-1',
    )

    expect(episodes).toEqual([
      {
        id: 'ep-1',
        name: 'Pilot',
        indexNumber: 1,
        overview: 'The first episode',
        runTimeTicks: 6_000_000_000,
        imageTag: 'tag-1',
      },
    ])
    const episodesCall = fetchSpy.mock.calls.find(call =>
      requestPathname(call[0]).endsWith('/Episodes'),
    )
    expect(episodesCall).toBeDefined()
    const episodesUrl = episodesCall![0] as URL
    expect(episodesUrl.searchParams.get('SeasonId')).toBe('season-1')
    expect(episodesUrl.searchParams.get('UserId')).toBe(TEST_USER_ID)
  })

  // Regression guard for the "Response content unknown" gap in
  // emby-api.json — a server that doesn't return `Items` at all must yield
  // an empty list, not throw.
  it('returns an empty list when the Episodes response omits Items', async () => {
    mockUsersThen({})

    const episodes = await new EmbyService().listEpisodes(
      'series-1',
      'season-1',
    )

    expect(episodes).toEqual([])
  })
})

// Pure URL builder — no fetch involved, so this block needs only the env the
// service reads at construction/URL time.
describe('EmbyService.buildImageUrl', () => {
  beforeEach(() => {
    process.env.EMBY_URL = 'https://emby.test'
    process.env.EMBY_API_KEY = 'test-api-key'
  })

  // The tablet's poster grid calls with no options, so these defaults are what
  // keep its request (and browser cache entry) unchanged now that the method
  // takes an options argument.
  it('defaults to a 400px Primary image', () => {
    const url = new URL(new EmbyService().buildImageUrl('item-1'))

    expect(url.pathname).toBe('/Items/item-1/Images/Primary')
    expect(url.searchParams.get('maxWidth')).toBe('400')
    expect(url.searchParams.get('api_key')).toBe('test-api-key')
  })

  it('honors an explicit type and maxWidth for the player hero', () => {
    const url = new URL(
      new EmbyService().buildImageUrl('item-1', {
        type: 'Backdrop',
        maxWidth: 1920,
      }),
    )

    expect(url.pathname).toBe('/Items/item-1/Images/Backdrop')
    expect(url.searchParams.get('maxWidth')).toBe('1920')
  })

  it('applies each option independently of the other', () => {
    const typeOnly = new URL(
      new EmbyService().buildImageUrl('item-1', { type: 'Thumb' }),
    )
    expect(typeOnly.pathname).toBe('/Items/item-1/Images/Thumb')
    expect(typeOnly.searchParams.get('maxWidth')).toBe('400')

    const widthOnly = new URL(
      new EmbyService().buildImageUrl('item-1', { maxWidth: 800 }),
    )
    expect(widthOnly.pathname).toBe('/Items/item-1/Images/Primary')
    expect(widthOnly.searchParams.get('maxWidth')).toBe('800')
  })

  it('percent-encodes the item id so it cannot escape its path segment', () => {
    const url = new URL(new EmbyService().buildImageUrl('a/b'))

    expect(url.pathname).toBe('/Items/a%2Fb/Images/Primary')
  })
})
