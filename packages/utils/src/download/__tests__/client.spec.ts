import { DownloadClient } from 'src/download/client'
import {
  DownloadJobStatus,
  DownloadType,
  GetDownloadJobResponse,
  GetMovieJobResponse,
  GetShowJobResponse,
  SearchMoviesResponse,
  SearchShowsResponse,
} from 'src/download/types'

function mockFetchJson(body: unknown): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    json: () => Promise.resolve(body),
  } as unknown as Response)
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

describe('DownloadClient', () => {
  describe('instance factories', () => {
    it('localInstance targets localhost:8081', async () => {
      const fetchSpy = mockFetchJson({})

      await DownloadClient.localInstance.getVideoJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        { headers: JSON_HEADERS },
      )
    })

    it('dockerInstance targets the internal docker hostname', async () => {
      const fetchSpy = mockFetchJson({})

      await DownloadClient.dockerInstance.getVideoJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://download:8081/download/videos/1',
        { headers: JSON_HEADERS },
      )
    })

    it('remoteInstance targets the public domain', async () => {
      const fetchSpy = mockFetchJson({})

      await DownloadClient.remoteInstance.getVideoJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://download.lilnas.io/download/videos/1',
        { headers: JSON_HEADERS },
      )
    })
  })

  describe('withForwardedIdentity', () => {
    it('merges x-forwarded-user/x-forwarded-user-id into every request', async () => {
      const fetchSpy = mockFetchJson({})
      const client = DownloadClient.localInstance.withForwardedIdentity({
        email: 'alice@example.com',
        userId: 'user_1',
      })

      await client.getVideoJob('1')

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
      const fetchSpy = mockFetchJson({})
      const client = DownloadClient.localInstance.withForwardedIdentity({
        email: 'alice@example.com',
        userId: 'user_1',
      })

      await client.createVideoJob({ url: 'https://example.com/video' })

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

    it('leaves the default instance unaffected (empty forwardedHeaders)', async () => {
      const fetchSpy = mockFetchJson({})

      await DownloadClient.localInstance.getVideoJob('1')

      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/1',
        { headers: JSON_HEADERS },
      )
    })
  })

  describe('video jobs', () => {
    const client = DownloadClient.localInstance

    it('getVideoJob issues a GET to /download/videos/:id', async () => {
      const job: GetDownloadJobResponse = {
        description: undefined,
        downloadUrls: undefined,
        error: undefined,
        id: 'job-1',
        status: DownloadJobStatus.Completed,
        timeRange: undefined,
        title: undefined,
        type: DownloadType.Video,
        url: 'https://example.com/video',
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.getVideoJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('createVideoJob issues a POST to /download/videos with the input body', async () => {
      const input = { url: 'https://example.com/video' }
      const job: GetDownloadJobResponse = {
        description: undefined,
        downloadUrls: undefined,
        error: undefined,
        id: 'job-1',
        status: DownloadJobStatus.Pending,
        timeRange: undefined,
        title: undefined,
        type: DownloadType.Video,
        url: input.url,
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.createVideoJob(input)).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos',
        {
          body: JSON.stringify(input),
          headers: JSON_HEADERS,
          method: 'POST',
        },
      )
    })

    it('cancelVideoJob issues a PATCH to /download/videos/:id/cancel', async () => {
      const job: GetDownloadJobResponse = {
        description: undefined,
        downloadUrls: undefined,
        error: undefined,
        id: 'job-1',
        status: DownloadJobStatus.Cancelling,
        timeRange: undefined,
        title: undefined,
        type: DownloadType.Video,
        url: 'https://example.com/video',
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.cancelVideoJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/videos/job-1/cancel',
        { headers: JSON_HEADERS, method: 'PATCH' },
      )
    })
  })

  describe('movie jobs', () => {
    const client = DownloadClient.localInstance

    it('searchMovies issues a GET to /download/movies/search with an encoded query', async () => {
      const result: SearchMoviesResponse = {
        results: [{ title: 'A Movie', tmdbId: 1 }],
      }
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
      const job: GetMovieJobResponse = {
        description: undefined,
        error: undefined,
        id: 'job-1',
        mediaTitle: undefined,
        posterUrl: undefined,
        queueSnapshot: undefined,
        radarrId: undefined,
        status: DownloadJobStatus.Requested,
        title: undefined,
        type: DownloadType.Movie,
      }
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
      const job: GetMovieJobResponse = {
        description: undefined,
        error: undefined,
        id: 'job-1',
        mediaTitle: 'A Movie',
        posterUrl: undefined,
        queueSnapshot: undefined,
        radarrId: 42,
        status: DownloadJobStatus.Downloading,
        title: undefined,
        type: DownloadType.Movie,
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.getMovieJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('deleteMovieJob issues a DELETE to /download/movies/:id', async () => {
      const job: GetMovieJobResponse = {
        description: undefined,
        error: undefined,
        id: 'job-1',
        mediaTitle: 'A Movie',
        posterUrl: undefined,
        queueSnapshot: undefined,
        radarrId: 42,
        status: DownloadJobStatus.Cancelled,
        title: undefined,
        type: DownloadType.Movie,
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.deleteMovieJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/movies/job-1',
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })
  })

  describe('show jobs', () => {
    const client = DownloadClient.localInstance

    it('searchShows issues a GET to /download/shows/search with an encoded query', async () => {
      const result: SearchShowsResponse = {
        results: [{ title: 'A Show', tvdbId: 2 }],
      }
      const fetchSpy = mockFetchJson(result)

      await expect(client.searchShows('a show & friends')).resolves.toEqual(
        result,
      )
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/search?query=a%20show%20%26%20friends',
        { headers: JSON_HEADERS },
      )
    })

    it('requestShow issues a POST to /download/shows with the tvdbId body', async () => {
      const job: GetShowJobResponse = {
        description: undefined,
        error: undefined,
        id: 'job-1',
        mediaTitle: undefined,
        posterUrl: undefined,
        queueSnapshot: undefined,
        sonarrId: undefined,
        status: DownloadJobStatus.Requested,
        title: undefined,
        type: DownloadType.Show,
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.requestShow({ tvdbId: 9 })).resolves.toEqual(job)
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
      const job: GetShowJobResponse = {
        description: undefined,
        error: undefined,
        id: 'job-1',
        mediaTitle: 'A Show',
        posterUrl: undefined,
        queueSnapshot: undefined,
        sonarrId: 9,
        status: DownloadJobStatus.Importing,
        title: undefined,
        type: DownloadType.Show,
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.getShowJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/job-1',
        { headers: JSON_HEADERS },
      )
    })

    it('deleteShowJob issues a DELETE to /download/shows/:id', async () => {
      const job: GetShowJobResponse = {
        description: undefined,
        error: undefined,
        id: 'job-1',
        mediaTitle: 'A Show',
        posterUrl: undefined,
        queueSnapshot: undefined,
        sonarrId: 9,
        status: DownloadJobStatus.Cancelled,
        title: undefined,
        type: DownloadType.Show,
      }
      const fetchSpy = mockFetchJson(job)

      await expect(client.deleteShowJob('job-1')).resolves.toEqual(job)
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:8081/download/shows/job-1',
        { headers: JSON_HEADERS, method: 'DELETE' },
      )
    })
  })
})
