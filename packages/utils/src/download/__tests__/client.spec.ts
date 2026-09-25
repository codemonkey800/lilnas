import { DownloadApiError, DownloadClient } from 'src/download/client'
import {
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  Media,
  SearchMediaResponse,
} from 'src/download/types'

function mockFetchJson(body: unknown): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

function mockFetchError(response: {
  json: () => Promise<unknown>
  status: number
  statusText: string
}): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: false,
    ...response,
  } as unknown as Response)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function buildJob(media: Media, overrides: Partial<DownloadJob> = {}) {
  return {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media,
    requester: null,
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  } satisfies DownloadJob
}

const VIDEO_MEDIA: Media = {
  downloadUrls: ['https://example.com/a.mp4'],
  id: 'video:v1',
  overview: 'a video',
  sourceUrl: 'https://example.com/video',
  timeRange: { start: '00:00:00', end: '00:01:00' },
  title: 'A video',
  type: DownloadType.Video,
}

const MOVIE_MEDIA: Media = {
  id: 'tmdb:42',
  title: 'A Movie',
  tmdbId: 42,
  type: DownloadType.Movie,
}

describe('DownloadClient', () => {
  describe('instance factories', () => {
    it('localInstance targets localhost:8081', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.localInstance.getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        { headers: JSON_HEADERS },
      )
    })

    it('dockerInstance targets the internal docker hostname', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.dockerInstance.getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://download:8081/download/videos/1',
        { headers: JSON_HEADERS },
      )
    })

    // No remoteInstance: download.lilnas.io is the Next.js frontend on 8080,
    // not the Nest backend on 8081. See the comment in client.ts.
    it('browserInstance issues relative /api requests for the Next.js rewrite', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.browserInstance.getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith('/api/download/videos/1', {
        headers: JSON_HEADERS,
      })
    })
  })

  // Browser-safety, not routing. This module is meant to be importable from a
  // browser bundle, and the property that makes that possible is that
  // `browserInstance`'s base URL is *relative*: nothing has to read an env var
  // (or any other server-only global) to work out a protocol and host. The
  // assertions below pin that property itself rather than one route's path.
  describe('browser safety', () => {
    it('browserInstance requests a same-origin relative URL, with no protocol or host', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.browserInstance.getJob('1')

      const url = String(fetchSpy.mock.calls[0]?.[0])

      expect(url).not.toMatch(/^https?:\/\//)
      // Protocol-relative (`//host/...`) is still cross-origin - also excluded.
      expect(url).not.toMatch(/^\/\//)
      expect(url).toMatch(/^\//)
    })
  })

  describe('withForwardedIdentity', () => {
    it('merges x-forwarded-user/x-forwarded-user-id into every request', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))
      const client = DownloadClient.localInstance.withForwardedIdentity({
        email: 'alice@example.com',
        userId: 'user_1',
      })

      await client.getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        {
          headers: {
            ...JSON_HEADERS,
            'x-forwarded-user': 'alice@example.com',
            'x-forwarded-user-id': 'user_1',
          },
        },
      )
    })

    it('threads the forwarded identity onto a POST request alongside its body', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))
      const client = DownloadClient.localInstance.withForwardedIdentity({
        email: 'alice@example.com',
        userId: 'user_1',
      })

      await client.createJob({ url: 'https://example.com/video' })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos',
        {
          body: JSON.stringify({ url: 'https://example.com/video' }),
          method: 'POST',
          headers: {
            ...JSON_HEADERS,
            'x-forwarded-user': 'alice@example.com',
            'x-forwarded-user-id': 'user_1',
          },
        },
      )
    })

    it('keeps the base URL of whichever factory it was derived from', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.browserInstance
        .withForwardedIdentity({
          email: 'alice@example.com',
          userId: 'user_1',
        })
        .getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith('/api/download/videos/1', {
        headers: {
          ...JSON_HEADERS,
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        },
      })
    })
  })

  describe('withDiscordIdentity', () => {
    const DISCORD_IDENTITY = {
      discordUserId: '123456789012345678',
      discordUsername: 'alice.codes',
    }

    it('merges x-discord-user-id/x-discord-username into every request', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))
      const client =
        DownloadClient.localInstance.withDiscordIdentity(DISCORD_IDENTITY)

      await client.getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        {
          headers: {
            ...JSON_HEADERS,
            'x-discord-user-id': '123456789012345678',
            'x-discord-username': 'alice.codes',
          },
        },
      )
    })

    it('threads the Discord identity onto a POST request alongside its body', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))
      const client =
        DownloadClient.dockerInstance.withDiscordIdentity(DISCORD_IDENTITY)

      await client.createJob({ url: 'https://example.com/video' })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://download:8081/download/videos',
        {
          body: JSON.stringify({ url: 'https://example.com/video' }),
          method: 'POST',
          headers: {
            ...JSON_HEADERS,
            'x-discord-user-id': '123456789012345678',
            'x-discord-username': 'alice.codes',
          },
        },
      )
    })

    it('keeps the base URL of whichever factory it was derived from', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.browserInstance
        .withDiscordIdentity(DISCORD_IDENTITY)
        .getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith('/api/download/videos/1', {
        headers: {
          ...JSON_HEADERS,
          'x-discord-user-id': '123456789012345678',
          'x-discord-username': 'alice.codes',
        },
      })
    })

    it('sends x-discord-display-name when a display name is supplied', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.localInstance
        .withDiscordIdentity({ ...DISCORD_IDENTITY, displayName: 'Alice' })
        .getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        {
          headers: {
            ...JSON_HEADERS,
            'x-discord-display-name': 'Alice',
            'x-discord-user-id': '123456789012345678',
            'x-discord-username': 'alice.codes',
          },
        },
      )
    })

    // Omitted rather than sent blank: the header exists only to make auth's
    // linking roster legible, so an absent/empty globalName has nothing to
    // say.
    it.each([
      ['omitted', undefined],
      ['null', null],
      ['empty', ''],
    ])(
      'omits x-discord-display-name entirely when the display name is %s',
      async (_label, displayName) => {
        const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

        await DownloadClient.localInstance
          .withDiscordIdentity({ ...DISCORD_IDENTITY, displayName })
          .getJob('1')

        const headers = (fetchSpy.mock.calls[0][1] as RequestInit)
          .headers as Record<string, string>

        expect(headers).not.toHaveProperty('x-discord-display-name')
        expect(headers['x-discord-user-id']).toBe('123456789012345678')
      },
    )

    // Composability: the Discord headers are layered on top of whatever the
    // client already carried, so a web caller that also knows the Discord
    // handle can send both identities on one request.
    it('carries forwarded identity headers through when composed after withForwardedIdentity', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await DownloadClient.localInstance
        .withForwardedIdentity({ email: 'alice@example.com', userId: 'user_1' })
        .withDiscordIdentity(DISCORD_IDENTITY)
        .getJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        {
          headers: {
            ...JSON_HEADERS,
            'x-discord-user-id': '123456789012345678',
            'x-discord-username': 'alice.codes',
            'x-forwarded-user': 'alice@example.com',
            'x-forwarded-user-id': 'user_1',
          },
        },
      )
    })
  })

  describe('error responses', () => {
    const client = DownloadClient.localInstance

    it('throws a DownloadApiError instead of returning the error body as a job', async () => {
      mockFetchError({
        json: () => Promise.resolve({ message: 'nope' }),
        status: 404,
        statusText: 'Not Found',
      })

      const error: unknown = await client.getJob('x').catch(e => e)

      expect(error).toBeInstanceOf(DownloadApiError)
      expect(error).toMatchObject({
        body: { message: 'nope' },
        name: 'DownloadApiError',
        status: 404,
        statusText: 'Not Found',
      })
    })

    it('still throws a DownloadApiError when the error body is not JSON', async () => {
      mockFetchError({
        json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        status: 502,
        statusText: 'Bad Gateway',
      })

      const error: unknown = await client.getGallery().catch(e => e)

      expect(error).toBeInstanceOf(DownloadApiError)
      expect(error).toMatchObject({ body: undefined, status: 502 })
    })

    it('surfaces the error from a POST route the same way', async () => {
      mockFetchError({
        json: () => Promise.resolve({ message: 'Forbidden' }),
        status: 403,
        statusText: 'Forbidden',
      })

      await expect(
        client.createJob({ url: 'https://example.com/video' }),
      ).rejects.toThrow(DownloadApiError)
    })
  })

  describe('jobs', () => {
    const client = DownloadClient.localInstance

    it('getJob issues a GET to /download/videos/:id', async () => {
      const job = buildJob(VIDEO_MEDIA)
      const fetchSpy = mockFetchJson(job)

      await expect(client.getJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('createJob issues a POST to /download/videos with the input body', async () => {
      const input = { url: 'https://example.com/video' }
      const job = buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Pending })
      const fetchSpy = mockFetchJson(job)

      await expect(client.createJob(input)).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos',
        {
          body: JSON.stringify(input),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('cancelJob issues a PATCH to /download/videos/:id/cancel', async () => {
      const job = buildJob(VIDEO_MEDIA, {
        status: DownloadJobStatus.Cancelling,
      })
      const fetchSpy = mockFetchJson(job)

      await expect(client.cancelJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1/cancel',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })

    // A job id, not a media key - left unencoded, like getJob/cancelJob.
    it('pauseJob issues a PATCH to /download/videos/:id/pause', async () => {
      const job = buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Paused })
      const fetchSpy = mockFetchJson(job)

      await expect(client.pauseJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1/pause',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })

    it('resumeJob issues a PATCH to /download/videos/:id/resume', async () => {
      const job = buildJob(VIDEO_MEDIA, {
        status: DownloadJobStatus.Downloading,
      })
      const fetchSpy = mockFetchJson(job)

      await expect(client.resumeJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1/resume',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })
  })

  describe('media detail and list endpoints', () => {
    const client = DownloadClient.localInstance

    it('getMedia URL-encodes the key so the `:` survives the path segment', async () => {
      const fetchSpy = mockFetchJson({ jobs: [], media: MOVIE_MEDIA })

      await client.getMedia('tmdb:438631')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/media/tmdb%3A438631',
        { headers: JSON_HEADERS },
      )
    })

    it('getActivity serializes repeated and comma-free list params', async () => {
      const fetchSpy = mockFetchJson({ items: [], nextCursor: null, total: 0 })

      await client.getActivity({
        limit: 10,
        type: [DownloadType.Movie, DownloadType.Video],
      })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/activity?limit=10&type=movie&type=video',
        { headers: JSON_HEADERS },
      )
    })

    it('getGallery serializes Date bounds as date-only strings', async () => {
      const fetchSpy = mockFetchJson({ items: [], nextCursor: null, total: 0 })

      await client.getGallery({ from: new Date('2026-03-01T00:00:00.000Z') })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/gallery?from=2026-03-01',
        { headers: JSON_HEADERS },
      )
    })

    it('getGalleryFacets issues a GET to /download/gallery/facets', async () => {
      const fetchSpy = mockFetchJson({ types: [], uploaders: [] })

      await client.getGalleryFacets()

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/gallery/facets',
        { headers: JSON_HEADERS },
      )
    })

    it('getHistory issues a GET to /download/history', async () => {
      const fetchSpy = mockFetchJson({ items: [], nextCursor: null, total: 0 })

      await client.getHistory({ requester: 'alice@example.com' })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/history?requester=alice%40example.com',
        { headers: JSON_HEADERS },
      )
    })

    it('getProfile issues a GET to /download/profile with the query serialized', async () => {
      const profile = {
        user: { email: 'alice@example.com' },
        firstDownloadAt: null,
        lastDownloadAt: null,
        jobsPerDay: [],
        totalsByStatus: [],
        totalsByType: [],
        windowDays: 7,
      }
      const fetchSpy = mockFetchJson(profile)

      await expect(
        client.getProfile({ days: 7, requester: 'alice@example.com' }),
      ).resolves.toEqual(profile)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/profile?days=7&requester=alice%40example.com',
        { headers: JSON_HEADERS },
      )
    })

    it('getProfile omits the query string entirely when unfiltered', async () => {
      const fetchSpy = mockFetchJson({})

      await client.getProfile()

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/profile',
        { headers: JSON_HEADERS },
      )
    })

    // No client-side identity check: the 403/401 for a non-admin or
    // unidentified caller is the shared DownloadApiError path, nothing special.
    it('getProfile surfaces a self-or-admin rejection as a DownloadApiError', async () => {
      mockFetchError({
        json: () => Promise.resolve({ message: 'Forbidden' }),
        status: 403,
        statusText: 'Forbidden',
      })

      await expect(
        client.getProfile({ requester: 'bob@example.com' }),
      ).rejects.toMatchObject({
        name: 'DownloadApiError',
        status: 403,
      })
    })

    it('getDiscover issues a GET to /download/discover', async () => {
      const fetchSpy = mockFetchJson({
        degradedSources: [],
        facets: { genres: [] },
        items: [],
        nextCursor: null,
        total: 0,
      })

      await client.getDiscover({ limit: 24, query: 'dune', sort: 'relevance' })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/discover?limit=24&query=dune&sort=relevance',
        { headers: JSON_HEADERS },
      )
    })
  })

  describe('release and bad-file endpoints', () => {
    const client = DownloadClient.localInstance

    // Every route here is keyed on a media id, which always contains a `:`.
    const MEDIA_ID = 'tmdb:438631'
    const ENCODED = 'tmdb%3A438631'

    it('listReleases URL-encodes the key and appends the scope query', async () => {
      const fetchSpy = mockFetchJson({ releases: [] })

      await expect(
        client.listReleases(MEDIA_ID, { seasonNumber: 2 }),
      ).resolves.toEqual({ releases: [] })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/releases?seasonNumber=2`,
        { headers: JSON_HEADERS },
      )
    })

    it('listReleases omits the query string entirely when unscoped', async () => {
      const fetchSpy = mockFetchJson({ releases: [] })

      await client.listReleases(MEDIA_ID)

      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/releases`,
        { headers: JSON_HEADERS },
      )
    })

    it('grabRelease issues a POST to /releases/grab with the release identity', async () => {
      const input = { guid: 'release-guid', indexerId: 3 }
      const job = buildJob(MOVIE_MEDIA, { status: DownloadJobStatus.Pending })
      const fetchSpy = mockFetchJson(job)

      await expect(client.grabRelease(MEDIA_ID, input)).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/releases/grab`,
        {
          body: JSON.stringify(input),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('replaceRelease issues a POST to /releases/replace with the same body shape', async () => {
      const input = { episodeId: 7, guid: 'release-guid', indexerId: 3 }
      const job = buildJob(MOVIE_MEDIA, { status: DownloadJobStatus.Pending })
      const fetchSpy = mockFetchJson(job)

      await expect(client.replaceRelease(MEDIA_ID, input)).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/releases/replace`,
        {
          body: JSON.stringify(input),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('listImportCandidates URL-encodes the key and appends the scope query', async () => {
      const candidates = [
        {
          importable: true,
          path: '/downloads/Some.Movie.2020.1080p/movie.mkv',
          rejections: [],
        },
      ]
      const fetchSpy = mockFetchJson({ candidates })

      await expect(
        client.listImportCandidates(MEDIA_ID, { seasonNumber: 2 }),
      ).resolves.toEqual({ candidates })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/imports?seasonNumber=2`,
        { headers: JSON_HEADERS },
      )
    })

    it('listImportCandidates omits the query string entirely when unscoped', async () => {
      const fetchSpy = mockFetchJson({ candidates: [] })

      await client.listImportCandidates(MEDIA_ID)

      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/imports`,
        { headers: JSON_HEADERS },
      )
    })

    it('importFiles issues a POST to /imports with the chosen paths', async () => {
      const input = {
        episodeId: 4412,
        paths: ['/downloads/a.mkv', '/downloads/b.mkv'],
      }
      const fetchSpy = mockFetchJson({ importedCount: 2 })

      await expect(client.importFiles(MEDIA_ID, input)).resolves.toEqual({
        importedCount: 2,
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/imports`,
        {
          body: JSON.stringify(input),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('discardImport issues a DELETE to /imports with the scope query', async () => {
      const fetchSpy = mockFetchJson({ discardedCount: 1 })

      await expect(
        client.discardImport(MEDIA_ID, { episodeId: 4412 }),
      ).resolves.toEqual({ discardedCount: 1 })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/imports?episodeId=4412`,
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })

    it('discardImport omits the query string entirely when unscoped', async () => {
      const fetchSpy = mockFetchJson({ discardedCount: 0 })

      await client.discardImport(MEDIA_ID)

      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/imports`,
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })

    it('flagBadFile issues a POST to /bad-files with the flag body', async () => {
      const input = { guid: 'release-guid', reason: 'wrong audio track' }
      const badFile = {
        createdAt: '2026-08-20T12:00:00.000Z',
        flaggedBy: { email: 'alice@example.com', userId: 'user_1' },
        id: 1,
        indexerId: null,
        mediaId: MEDIA_ID,
        reason: 'wrong audio track',
        releaseGuid: 'release-guid',
        releaseTitle: null,
      }
      const fetchSpy = mockFetchJson({ badFile })

      await expect(client.flagBadFile(MEDIA_ID, input)).resolves.toEqual({
        badFile,
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/bad-files`,
        {
          body: JSON.stringify(input),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('listBadFiles issues a GET to /bad-files', async () => {
      const fetchSpy = mockFetchJson({ badFiles: [] })

      await expect(client.listBadFiles(MEDIA_ID)).resolves.toEqual({
        badFiles: [],
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/bad-files`,
        { headers: JSON_HEADERS },
      )
    })

    it('unflagBadFile issues a DELETE to /bad-files/:flagId', async () => {
      const badFile = {
        createdAt: '2026-08-20T12:00:00.000Z',
        flaggedBy: { email: 'alice@example.com', userId: 'user_1' },
        id: 1,
        indexerId: null,
        mediaId: MEDIA_ID,
        reason: null,
        releaseGuid: 'release-guid',
        releaseTitle: null,
      }
      const fetchSpy = mockFetchJson({ badFile })

      await expect(client.unflagBadFile(MEDIA_ID, 1)).resolves.toEqual({
        badFile,
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/bad-files/1`,
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })
  })

  describe('season, file and file-deletion endpoints', () => {
    const client = DownloadClient.localInstance

    // A show key, since seasons are shows-only - and it still carries a `:`.
    const MEDIA_ID = 'tvdb:121361'
    const ENCODED = 'tvdb%3A121361'

    it('listSeasons URL-encodes the key and issues a GET to /seasons', async () => {
      const fetchSpy = mockFetchJson({ seasons: [] })

      await expect(client.listSeasons(MEDIA_ID)).resolves.toEqual({
        seasons: [],
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/seasons`,
        { headers: JSON_HEADERS },
      )
    })

    it('deleteMediaFiles issues a DELETE to /files with the scope query', async () => {
      const result = {
        deletedCount: 3,
        mediaId: MEDIA_ID,
        removedFromLibrary: false,
      }
      const fetchSpy = mockFetchJson(result)

      await expect(
        client.deleteMediaFiles(MEDIA_ID, { seasonNumber: 2 }),
      ).resolves.toEqual(result)
      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/files?seasonNumber=2`,
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })

    it('deleteMediaFiles omits the query string entirely when unscoped', async () => {
      const fetchSpy = mockFetchJson({
        deletedCount: 0,
        mediaId: MEDIA_ID,
        removedFromLibrary: true,
      })

      await client.deleteMediaFiles(MEDIA_ID)

      expect(fetchSpy).toHaveBeenCalledWith(
        `http://localhost:8081/download/media/${ENCODED}/files`,
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })

    // No fetch mock in the three below on purpose: getMediaFileUrl builds a
    // string synchronously and never touches the network.
    it('getMediaFileUrl returns an absolute URL against the factory base', () => {
      expect(client.getMediaFileUrl(MEDIA_ID)).toBe(
        `http://localhost:8081/download/media/${ENCODED}/file`,
      )
    })

    it('getMediaFileUrl appends the episodeId/part query params', () => {
      expect(client.getMediaFileUrl(MEDIA_ID, { episodeId: 7, part: 1 })).toBe(
        `http://localhost:8081/download/media/${ENCODED}/file?episodeId=7&part=1`,
      )
    })

    it('getMediaFileUrl returns a relative /api path from browserInstance', () => {
      expect(DownloadClient.browserInstance.getMediaFileUrl(MEDIA_ID)).toBe(
        `/api/download/media/${ENCODED}/file`,
      )
    })
  })

  describe('admin and whoami endpoints', () => {
    const client = DownloadClient.localInstance

    it('getAuditLog issues a GET to /download/admin/audit-log with the filter query', async () => {
      const page = { items: [], nextCursor: null, total: 0 }
      const fetchSpy = mockFetchJson(page)

      await expect(
        client.getAuditLog({ action: 'release.grab', limit: 25 }),
      ).resolves.toEqual(page)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/admin/audit-log?action=release.grab&limit=25',
        { headers: JSON_HEADERS },
      )
    })

    it('getAuditLog omits the query string entirely when unfiltered', async () => {
      const fetchSpy = mockFetchJson({ items: [], nextCursor: null, total: 0 })

      await client.getAuditLog()

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/admin/audit-log',
        { headers: JSON_HEADERS },
      )
    })

    it('getStats issues a GET to /download/admin/stats with the window query', async () => {
      const stats = {
        jobsPerDay: [],
        topRequesters: [],
        totalJobs: 0,
        totalsByStatus: [],
        totalsByType: [],
        windowDays: 7,
      }
      const fetchSpy = mockFetchJson(stats)

      await expect(client.getStats({ days: 7 })).resolves.toEqual(stats)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/admin/stats?days=7',
        { headers: JSON_HEADERS },
      )
    })

    // No client-side identity check: the 403/401 for a non-admin or
    // unidentified caller is the shared DownloadApiError path, nothing special.
    it('getStats surfaces an admin-guard rejection as a DownloadApiError', async () => {
      mockFetchError({
        json: () => Promise.resolve({ message: 'Forbidden' }),
        status: 403,
        statusText: 'Forbidden',
      })

      await expect(client.getStats()).rejects.toMatchObject({
        name: 'DownloadApiError',
        status: 403,
      })
    })

    it('whoami issues a GET to /auth/whoami and threads forwarded identity', async () => {
      const me = {
        email: 'alice@example.com',
        isAdmin: true,
        userId: 'user_1',
      }
      const fetchSpy = mockFetchJson(me)

      await expect(
        client
          .withForwardedIdentity({
            email: 'alice@example.com',
            userId: 'user_1',
          })
          .whoami(),
      ).resolves.toEqual(me)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/auth/whoami',
        {
          headers: {
            ...JSON_HEADERS,
            'x-forwarded-user': 'alice@example.com',
            'x-forwarded-user-id': 'user_1',
          },
        },
      )
    })
  })

  describe('yt-dlp updater endpoints', () => {
    const client = DownloadClient.localInstance

    it('getYtdlpStatus issues a GET to /api/ytdlp-update/status', async () => {
      const status = {
        isUpdating: false,
        lastAttempt: null,
        lastCheck: '2026-08-20T12:00:00.000Z',
        retryCount: 0,
      }
      const fetchSpy = mockFetchJson(status)

      await expect(client.getYtdlpStatus()).resolves.toEqual(status)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/api/ytdlp-update/status',
        { headers: JSON_HEADERS },
      )
    })

    // The `/api` doubling is expected, not a bug: `api/ytdlp-update` is the
    // Nest controller's own prefix, and the Next.js rewrite strips exactly one
    // `/api` before Nest sees the path. Pinned so nobody "fixes" it.
    it('getYtdlpStatus doubles the /api prefix from browserInstance, by design', async () => {
      const fetchSpy = mockFetchJson({
        isUpdating: false,
        lastAttempt: null,
        lastCheck: null,
        retryCount: 0,
      })

      await DownloadClient.browserInstance.getYtdlpStatus()

      expect(fetchSpy).toHaveBeenCalledWith('/api/api/ytdlp-update/status', {
        headers: JSON_HEADERS,
      })
    })

    it('getYtdlpVersion issues a GET to /api/ytdlp-update/version', async () => {
      const fetchSpy = mockFetchJson({ version: '2026.08.01' })

      await expect(client.getYtdlpVersion()).resolves.toEqual({
        version: '2026.08.01',
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/api/ytdlp-update/version',
        { headers: JSON_HEADERS },
      )
    })

    // An unprobeable binary is reported as a version, not thrown - so this
    // resolves rather than rejecting.
    it('getYtdlpVersion returns the `error` sentinel rather than throwing', async () => {
      mockFetchJson({ version: 'error' })

      await expect(client.getYtdlpVersion()).resolves.toEqual({
        version: 'error',
      })
    })

    const CHECK_RESULT = {
      canUpdate: true,
      currentVersion: '2026.07.01',
      latestVersion: '2026.08.01',
      updateAvailable: true,
    }

    it('checkYtdlpUpdate POSTs with no query string at all by default', async () => {
      const fetchSpy = mockFetchJson(CHECK_RESULT)

      await expect(client.checkYtdlpUpdate()).resolves.toEqual(CHECK_RESULT)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/api/ytdlp-update/check',
        { headers: JSON_HEADERS, method: 'POST' },
      )
    })

    it('checkYtdlpUpdate appends ?dryRun=true only when asked', async () => {
      const fetchSpy = mockFetchJson({
        ...CHECK_RESULT,
        canUpdate: false,
        reason: 'Dry-run mode - update would have proceeded',
      })

      await client.checkYtdlpUpdate(true)

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/api/ytdlp-update/check?dryRun=true',
        { headers: JSON_HEADERS, method: 'POST' },
      )
    })
  })

  describe('movie and show jobs', () => {
    const client = DownloadClient.localInstance

    it('searchMovies issues a GET to /download/movies/search with an encoded query', async () => {
      const result: SearchMediaResponse = { results: [MOVIE_MEDIA] }
      const fetchSpy = mockFetchJson(result)

      await expect(client.searchMovies('a movie & friends')).resolves.toEqual(
        result,
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies/search?query=a%20movie%20%26%20friends',
        { headers: JSON_HEADERS },
      )
    })

    it('requestMovie issues a POST to /download/movies with the tmdbId body', async () => {
      const job = buildJob(MOVIE_MEDIA, {
        status: DownloadJobStatus.Requested,
      })
      const fetchSpy = mockFetchJson(job)

      await expect(client.requestMovie({ tmdbId: 42 })).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies',
        {
          body: JSON.stringify({ tmdbId: 42 }),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('getMovieJob issues a GET to /download/movies/:id', async () => {
      const fetchSpy = mockFetchJson(buildJob(MOVIE_MEDIA))

      await client.getMovieJob('job-1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('deleteMovieJob issues a DELETE to /download/movies/:id', async () => {
      const fetchSpy = mockFetchJson(buildJob(MOVIE_MEDIA))

      await client.deleteMovieJob('job-1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies/job-1',
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })

    it('cancelMovieJob issues a PATCH to /download/movies/:id/cancel', async () => {
      const job = buildJob(MOVIE_MEDIA, {
        status: DownloadJobStatus.Cancelling,
      })
      const fetchSpy = mockFetchJson(job)

      await expect(client.cancelMovieJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies/job-1/cancel',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })

    it('searchShows issues a GET to /download/shows/search with an encoded query', async () => {
      const fetchSpy = mockFetchJson({ results: [] })

      await client.searchShows('a show & friends')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/search?query=a%20show%20%26%20friends',
        { headers: JSON_HEADERS },
      )
    })

    it('requestShow issues a POST to /download/shows with the tvdbId body', async () => {
      const fetchSpy = mockFetchJson(buildJob(MOVIE_MEDIA))

      await client.requestShow({ tvdbId: 9 })

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows',
        {
          body: JSON.stringify({ tvdbId: 9 }),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('getShowJob issues a GET to /download/shows/:id', async () => {
      const fetchSpy = mockFetchJson(buildJob(MOVIE_MEDIA))

      await client.getShowJob('job-1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('deleteShowJob issues a DELETE to /download/shows/:id', async () => {
      const fetchSpy = mockFetchJson(buildJob(MOVIE_MEDIA))

      await client.deleteShowJob('job-1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/job-1',
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })

    it('cancelShowJob issues a PATCH to /download/shows/:id/cancel', async () => {
      const job = buildJob(MOVIE_MEDIA, {
        status: DownloadJobStatus.Cancelling,
      })
      const fetchSpy = mockFetchJson(job)

      await expect(client.cancelShowJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/job-1/cancel',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })
  })

  describe('waitForJob', () => {
    // A minimal in-memory stand-in for the DOM/undici `WebSocket` - jsdom
    // isn't in play here (this package's tests run in the `node` jest
    // environment), and Node's real `WebSocket` can't be told to emit
    // events on command from a test.
    class FakeSocket {
      static instances: FakeSocket[] = []

      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 3

      readonly close = jest.fn(() => {
        this.readyState = FakeSocket.CLOSED
      })

      onclose: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onopen: (() => void) | null = null
      readyState = FakeSocket.CONNECTING

      constructor(
        readonly url: string,
        readonly init?: { headers?: Record<string, string> },
      ) {
        FakeSocket.instances.push(this)
      }

      emitOpen(): void {
        this.readyState = FakeSocket.OPEN
        this.onopen?.()
      }

      emitMessage(data: string): void {
        this.onmessage?.({ data })
      }

      emitClose(): void {
        this.readyState = FakeSocket.CLOSED
        this.onclose?.()
      }
    }

    function mockWebSocket(): jest.SpyInstance {
      FakeSocket.instances = []

      return jest
        .spyOn(globalThis, 'WebSocket')
        .mockImplementation(
          (...args: unknown[]) =>
            new FakeSocket(
              String(args[0]),
              args[1] as { headers?: Record<string, string> } | undefined,
            ) as unknown as WebSocket,
        )
    }

    // A real (unfaked) macrotask tick - long enough for any number of
    // pending microtasks (an awaited `fetch`, then an awaited `.json()`,
    // then the `getJob()` promise chain in `waitForJob` itself) to drain
    // before the next assertion runs.
    function flushAsync(): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, 0))
    }

    function terminalFrame(job: DownloadJob): string {
      return JSON.stringify({
        data: { job, type: 'updated' },
        type: 'download-job',
      })
    }

    afterEach(() => {
      jest.useRealTimers()
    })

    it('rejects immediately with signal.reason when already aborted, without opening a socket', async () => {
      const wsSpy = mockWebSocket()
      const controller = new AbortController()
      const reason = new Error('gave up before starting')
      controller.abort(reason)

      await expect(
        DownloadClient.localInstance.waitForJob('job-1', {
          signal: controller.signal,
        }),
      ).rejects.toBe(reason)

      expect(wsSpy).not.toHaveBeenCalled()
    })

    it('opens the socket at ws://download:8081/ws for dockerInstance', () => {
      mockWebSocket()

      void DownloadClient.dockerInstance.waitForJob('job-1').catch(() => {})

      expect(FakeSocket.instances[0]?.url).toBe('ws://download:8081/ws')
    })

    describe('browserInstance socket URL', () => {
      afterEach(() => {
        Reflect.deleteProperty(globalThis, 'location')
      })

      it('derives wss://<host>/ws from a stubbed globalThis.location', () => {
        mockWebSocket()
        Object.defineProperty(globalThis, 'location', {
          configurable: true,
          value: { host: 'download.lilnas.io', protocol: 'https:' },
        })

        void DownloadClient.browserInstance.waitForJob('job-1').catch(() => {})

        expect(FakeSocket.instances[0]?.url).toBe('wss://download.lilnas.io/ws')
      })
    })

    it('resolves with the terminal job the open-time getJob call returns, and closes the socket', async () => {
      mockWebSocket()
      const job = buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Completed })
      mockFetchJson(job)

      const promise = DownloadClient.localInstance.waitForJob('job-1')
      FakeSocket.instances[0]?.emitOpen()

      await expect(promise).resolves.toEqual(job)
      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
    })

    it('leaves a non-terminal open-time getJob result unsettled, with the socket left open', async () => {
      mockWebSocket()
      mockFetchJson(
        buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Downloading }),
      )

      const promise = DownloadClient.localInstance.waitForJob('job-1')
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )

      FakeSocket.instances[0]?.emitOpen()
      await flushAsync()

      expect(settled).toBe(false)
      expect(FakeSocket.instances[0]?.close).not.toHaveBeenCalled()
    })

    it('rejects with the DownloadApiError when the open-time getJob 404s, and closes the socket', async () => {
      mockWebSocket()
      mockFetchError({
        json: () => Promise.resolve({ message: 'not found' }),
        status: 404,
        statusText: 'Not Found',
      })

      const promise = DownloadClient.localInstance.waitForJob('missing')
      FakeSocket.instances[0]?.emitOpen()

      await expect(promise).rejects.toBeInstanceOf(DownloadApiError)
      await expect(promise).rejects.toMatchObject({ status: 404 })
      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
    })

    it('closes the socket (letting onclose schedule the reconnect) after a non-404 getJob failure, without settling', async () => {
      mockWebSocket()
      mockFetchError({
        json: () => Promise.resolve({}),
        status: 500,
        statusText: 'Internal Server Error',
      })

      const promise = DownloadClient.localInstance.waitForJob('job-1')
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )

      FakeSocket.instances[0]?.emitOpen()
      await flushAsync()

      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
      expect(settled).toBe(false)
    })

    it('drops a frame whose envelope type is not download-job, without resolving', async () => {
      mockWebSocket()
      const promise = DownloadClient.localInstance.waitForJob('job-1')
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )

      FakeSocket.instances[0]?.emitMessage(
        JSON.stringify({
          data: {
            job: buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Completed }),
            type: 'updated',
          },
          type: 'not-a-job-event',
        }),
      )
      await flushAsync()

      expect(settled).toBe(false)
    })

    it('drops a frame for a different job id, without resolving', async () => {
      mockWebSocket()
      const promise = DownloadClient.localInstance.waitForJob('job-1')
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )

      FakeSocket.instances[0]?.emitMessage(
        terminalFrame(
          buildJob(VIDEO_MEDIA, {
            id: 'job-2',
            status: DownloadJobStatus.Completed,
          }),
        ),
      )
      await flushAsync()

      expect(settled).toBe(false)
    })

    it('drops a malformed frame that fails the zod parse, without resolving', async () => {
      mockWebSocket()
      const promise = DownloadClient.localInstance.waitForJob('job-1')
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )

      FakeSocket.instances[0]?.emitMessage(
        JSON.stringify({
          data: { job: { id: 'job-1' }, type: 'updated' },
          type: 'download-job',
        }),
      )
      await flushAsync()

      expect(settled).toBe(false)
    })

    it('resolves and closes on a terminal job frame for the watched id', async () => {
      mockWebSocket()
      const job = buildJob(VIDEO_MEDIA, {
        id: 'job-1',
        status: DownloadJobStatus.Failed,
      })

      const promise = DownloadClient.localInstance.waitForJob('job-1')
      FakeSocket.instances[0]?.emitMessage(terminalFrame(job))

      await expect(promise).resolves.toEqual(job)
      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
    })

    it('leaves a non-terminal job frame for the watched id unsettled', async () => {
      mockWebSocket()
      const promise = DownloadClient.localInstance.waitForJob('job-1')
      let settled = false
      promise.then(
        () => (settled = true),
        () => (settled = true),
      )

      FakeSocket.instances[0]?.emitMessage(
        terminalFrame(
          buildJob(VIDEO_MEDIA, {
            id: 'job-1',
            status: DownloadJobStatus.Downloading,
          }),
        ),
      )
      await flushAsync()

      expect(settled).toBe(false)
      expect(FakeSocket.instances[0]?.close).not.toHaveBeenCalled()
    })

    it('climbs the reconnect ladder 1s -> 2s -> 4s and resets the attempt counter after an open', async () => {
      jest.useFakeTimers()
      jest.spyOn(Math, 'random').mockReturnValue(0.5) // neutral: no jitter
      mockWebSocket()
      mockFetchJson(
        buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Downloading }),
      )

      const promise = DownloadClient.localInstance.waitForJob('job-1')
      promise.catch(() => {})

      FakeSocket.instances[0]?.emitClose()
      await jest.advanceTimersByTimeAsync(999)
      expect(FakeSocket.instances).toHaveLength(1)
      await jest.advanceTimersByTimeAsync(1)
      expect(FakeSocket.instances).toHaveLength(2)

      FakeSocket.instances[1]?.emitClose()
      await jest.advanceTimersByTimeAsync(1_999)
      expect(FakeSocket.instances).toHaveLength(2)
      await jest.advanceTimersByTimeAsync(1)
      expect(FakeSocket.instances).toHaveLength(3)

      // A real open resets the ladder back to its first rung.
      FakeSocket.instances[2]?.emitOpen()
      await jest.advanceTimersByTimeAsync(0)

      FakeSocket.instances[2]?.emitClose()
      await jest.advanceTimersByTimeAsync(999)
      expect(FakeSocket.instances).toHaveLength(3)
      await jest.advanceTimersByTimeAsync(1)
      expect(FakeSocket.instances).toHaveLength(4)
    })

    it('on abort, closes the socket even while still CONNECTING and rejects with signal.reason', async () => {
      mockWebSocket()
      const controller = new AbortController()
      const reason = new Error('gave up waiting')

      const promise = DownloadClient.localInstance.waitForJob('job-1', {
        signal: controller.signal,
      })

      expect(FakeSocket.instances[0]?.readyState).toBe(FakeSocket.CONNECTING)
      controller.abort(reason)

      await expect(promise).rejects.toBe(reason)
      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
    })

    it('on abort mid-backoff, clears the pending reconnect timer so no further socket opens', async () => {
      jest.useFakeTimers()
      mockWebSocket()
      const controller = new AbortController()

      const promise = DownloadClient.localInstance.waitForJob('job-1', {
        signal: controller.signal,
      })
      promise.catch(() => {})

      FakeSocket.instances[0]?.emitClose()
      controller.abort(new Error('stop'))

      await jest.advanceTimersByTimeAsync(60_000)

      expect(FakeSocket.instances).toHaveLength(1)
    })

    it('removes the abort listener once the wait settles, so the signal does not retain the closure', async () => {
      mockWebSocket()
      const job = buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Completed })
      mockFetchJson(job)
      const controller = new AbortController()
      const removeSpy = jest.spyOn(controller.signal, 'removeEventListener')

      const promise = DownloadClient.localInstance.waitForJob('job-1', {
        signal: controller.signal,
      })
      FakeSocket.instances[0]?.emitOpen()

      await promise

      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    it('ignores a stale getJob result that resolves after the wait already settled via a message', async () => {
      mockWebSocket()
      let resolveFetch: (value: DownloadJob) => void = () => {}
      const fetchPromise = new Promise<DownloadJob>(resolve => {
        resolveFetch = resolve
      })
      jest.spyOn(global, 'fetch').mockReturnValue(
        fetchPromise.then(
          body =>
            ({
              json: () => Promise.resolve(body),
              ok: true,
              status: 200,
            }) as unknown as Response,
        ),
      )

      const job = buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Completed })
      const promise = DownloadClient.localInstance.waitForJob('job-1')
      FakeSocket.instances[0]?.emitOpen() // kicks off the still-pending getJob()

      FakeSocket.instances[0]?.emitMessage(terminalFrame(job))
      await expect(promise).resolves.toEqual(job)
      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)

      // The stale getJob() finally resolves - must be ignored, not close again.
      resolveFetch(buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Failed }))
      await flushAsync()

      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
    })

    it('ignores a message frame that arrives after the wait already settled', async () => {
      mockWebSocket()
      const job = buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Completed })

      const promise = DownloadClient.localInstance.waitForJob('job-1')
      FakeSocket.instances[0]?.emitMessage(terminalFrame(job))
      await promise

      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)

      FakeSocket.instances[0]?.emitMessage(
        terminalFrame(
          buildJob(VIDEO_MEDIA, { status: DownloadJobStatus.Failed }),
        ),
      )

      expect(FakeSocket.instances[0]?.close).toHaveBeenCalledTimes(1)
    })

    it('passes forwarded headers as the WebSocket init object for a client from withForwardedIdentity()', () => {
      mockWebSocket()
      const client = DownloadClient.localInstance.withForwardedIdentity({
        email: 'alice@example.com',
        userId: 'user_1',
      })

      void client.waitForJob('job-1').catch(() => {})

      expect(FakeSocket.instances[0]?.init).toEqual({
        headers: {
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        },
      })
    })

    it('passes no second WebSocket argument when the client carries no forwarded identity', () => {
      const wsSpy = mockWebSocket()

      void DownloadClient.localInstance.waitForJob('job-1').catch(() => {})

      expect(wsSpy.mock.calls[0]).toHaveLength(1)
    })
  })
})
