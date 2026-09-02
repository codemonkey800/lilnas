import {
  DownloadApiError,
  DownloadClient,
  flattenToLegacyVideoResponse,
} from 'src/download/client'
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
    hiddenAttribution: false,
    id: 'job-1',
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
      const result = { deletedCount: 3, mediaId: MEDIA_ID }
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
      const fetchSpy = mockFetchJson({ deletedCount: 0, mediaId: MEDIA_ID })

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
  })

  // TODO(tdr-bot-migration): delete this block with the shim it covers.
  //
  // tdr-bot mocks DownloadClient wholesale in its own tests, so nothing on
  // that side would catch a wrong field mapping here - a bad flattening
  // shows up as a Discord message with a missing link, not a compile error.
  // This is the only direct test of it.
  describe('legacy video-job shim (tdr-bot)', () => {
    const client = DownloadClient.localInstance

    it('flattens media.sourceUrl/title/overview/downloadUrls/timeRange onto the flat shape', () => {
      const job = buildJob(VIDEO_MEDIA, {
        error: 'boom',
        hiddenAttribution: true,
        requester: { email: 'alice@example.com', userId: 'user_1' },
      })

      expect(flattenToLegacyVideoResponse(job)).toEqual({
        description: 'a video',
        downloadUrls: ['https://example.com/a.mp4'],
        error: 'boom',
        hiddenAttribution: true,
        id: 'job-1',
        requester: { email: 'alice@example.com', userId: 'user_1' },
        status: DownloadJobStatus.Completed,
        timeRange: { start: '00:00:00', end: '00:01:00' },
        title: 'A video',
        type: DownloadType.Video,
        url: 'https://example.com/video',
      })
    })

    it('throws rather than silently emitting a video shape for a movie job', () => {
      expect(() => flattenToLegacyVideoResponse(buildJob(MOVIE_MEDIA))).toThrow(
        /Expected a video job/,
      )
    })

    it('getVideoJob returns the flattened shape from the new endpoint', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await expect(client.getVideoJob('job-1')).resolves.toMatchObject({
        title: 'A video',
        url: 'https://example.com/video',
      })
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('createVideoJob posts the same body it always did', async () => {
      const input = { url: 'https://example.com/video' }
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await client.createVideoJob(input)

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos',
        { body: JSON.stringify(input), headers: JSON_HEADERS, method: 'POST' },
      )
    })

    it('cancelVideoJob patches the same route it always did', async () => {
      const fetchSpy = mockFetchJson(buildJob(VIDEO_MEDIA))

      await client.cancelVideoJob('job-1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1/cancel',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })
  })
})
