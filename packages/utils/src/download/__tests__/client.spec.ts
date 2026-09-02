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
