import type {
  Episode,
  Movie,
  Season,
  Show,
  Video,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import { MediaStateService } from 'src/media/media-state.service'
import type { PollableQueueItem } from 'src/media/queue-status.util'

const STUCK_REASON = 'Movie was not found in the grabbed release'

const downloading = (
  overrides: Partial<PollableQueueItem>,
): PollableQueueItem => ({
  size: 1000,
  sizeleft: 250,
  status: 'downloading',
  timeleft: '00:05:00',
  ...overrides,
})

const stuckImport = (
  overrides: Partial<PollableQueueItem>,
): PollableQueueItem => ({
  size: 1000,
  sizeleft: 0,
  status: 'completed',
  statusMessages: [{ messages: [STUCK_REASON], title: 'Release' }],
  trackedDownloadState: 'importPending',
  trackedDownloadStatus: 'warning',
  ...overrides,
})

const movie = (overrides: Partial<Movie> = {}): Movie => ({
  id: 'movie:tmdb:100',
  monitored: true,
  radarrId: 7,
  title: 'A Movie',
  tmdbId: 100,
  type: DownloadType.Movie,
  ...overrides,
})

const show = (overrides: Partial<Show> = {}): Show => ({
  episodeCount: 45,
  episodeFileCount: 0,
  // Set for every library series - the series folder, not a file.
  filePath: '/tv/A Show',
  id: 'show:tvdb:200',
  monitored: true,
  sonarrId: 9,
  title: 'A Show',
  tvdbId: 200,
  type: DownloadType.Show,
  ...overrides,
})

const video = (overrides: Partial<Video> = {}): Video => ({
  id: 'video:abc',
  sourceUrl: 'https://example.com/v',
  title: 'A Video',
  type: DownloadType.Video,
  ...overrides,
})

const episode = (overrides: Partial<Episode>): Episode => ({
  episodeNumber: 1,
  hasFile: false,
  id: 1,
  monitored: true,
  seasonNumber: 1,
  title: 'An Episode',
  ...overrides,
})

describe('MediaStateService', () => {
  let service: MediaStateService

  beforeEach(() => {
    service = new MediaStateService()
  })

  describe('setQueue / getQueue', () => {
    it('returns an empty queue before the first set', () => {
      expect(service.getQueue('radarr')).toEqual([])
      expect(service.getQueue('sonarr')).toEqual([])
    })

    it('replaces rather than merges, so an item that left is gone', () => {
      service.setQueue('radarr', [
        downloading({ id: 1, movieId: 7 }),
        downloading({ id: 2, movieId: 8 }),
      ])
      service.setQueue('radarr', [downloading({ id: 3, movieId: 8 })])

      expect(service.getQueue('radarr').map(item => item.id)).toEqual([3])
    })

    it('stores an empty queue as empty', () => {
      service.setQueue('sonarr', [downloading({ seriesId: 9 })])
      service.setQueue('sonarr', [])

      expect(service.getQueue('sonarr')).toEqual([])
    })

    it('keeps the two sources apart', () => {
      service.setQueue('radarr', [downloading({ id: 1, movieId: 7 })])

      expect(service.getQueue('sonarr')).toEqual([])
    })

    it('is unaffected by the caller mutating its array afterwards', () => {
      const items = [downloading({ id: 1, movieId: 7 })]
      service.setQueue('radarr', items)
      items.push(downloading({ id: 2, movieId: 7 }))

      expect(service.getQueue('radarr')).toHaveLength(1)
    })
  })

  describe('queueItemsFor', () => {
    beforeEach(() => {
      // The same number on both sides, to prove each type reads its own queue.
      service.setQueue('radarr', [
        downloading({ id: 1, movieId: 7 }),
        downloading({ id: 2, movieId: 8 }),
        downloading({ id: 3, movieId: 7 }),
      ])
      service.setQueue('sonarr', [
        downloading({ episodeId: 11, id: 4, seriesId: 7 }),
        downloading({ episodeId: 12, id: 5, seriesId: 9 }),
      ])
    })

    it("matches a movie's items on movieId in the Radarr queue", () => {
      expect(
        service.queueItemsFor(DownloadType.Movie, 7).map(item => item.id),
      ).toEqual([1, 3])
    })

    it("matches a series' items on seriesId in the Sonarr queue", () => {
      expect(
        service.queueItemsFor(DownloadType.Show, 7).map(item => item.id),
      ).toEqual([4])
    })

    it('returns nothing for an id with no items', () => {
      expect(service.queueItemsFor(DownloadType.Movie, 99)).toEqual([])
    })
  })

  describe('setVideoActivity', () => {
    const annotated = (media: Video) => {
      service.annotate([media])
      return media.state
    }

    it('lets an in-flight job decide the video state', () => {
      service.setVideoActivity('video:abc', DownloadJobStatus.Downloading)

      expect(annotated(video())).toBe('downloading')
    })

    it('clears the entry on undefined', () => {
      service.setVideoActivity('video:abc', DownloadJobStatus.Downloading)
      service.setVideoActivity('video:abc', undefined)

      expect(annotated(video())).toBe('absent')
    })

    it.each([
      DownloadJobStatus.Completed,
      DownloadJobStatus.Failed,
      DownloadJobStatus.Cancelled,
    ])('clears the entry on terminal status %s', status => {
      service.setVideoActivity('video:abc', DownloadJobStatus.Converting)
      service.setVideoActivity('video:abc', status)

      expect(annotated(video({ downloadUrls: ['s3://v.mp4'] }))).toBe(
        'available',
      )
    })

    it('replaces an earlier status', () => {
      service.setVideoActivity('video:abc', DownloadJobStatus.Downloading)
      service.setVideoActivity('video:abc', DownloadJobStatus.Uploading)

      expect(annotated(video())).toBe('importing')
    })
  })

  describe('annotate', () => {
    it('annotates one of each type plus a placeholder', () => {
      service.setQueue('radarr', [downloading({ movieId: 7 })])
      service.setQueue('sonarr', [downloading({ episodeId: 11, seriesId: 9 })])
      service.setVideoActivity('video:abc', DownloadJobStatus.Downloading)

      const theMovie = movie()
      const theShow = show({ episodeFileCount: 44 })
      const theVideo = video()
      // What the resolver returns for a movie key it couldn't reach.
      const placeholder: Movie = {
        id: 'movie:tmdb:555',
        title: 'movie:tmdb:555',
        tmdbId: 555,
        type: DownloadType.Movie,
      }

      service.annotate(
        new Map<string, Movie | Show | Video>([
          [theMovie.id, theMovie],
          [theShow.id, theShow],
          [theVideo.id, theVideo],
          [placeholder.id, placeholder],
        ]).values(),
      )

      expect(theMovie.state).toBe('downloading')
      expect(theShow.state).toBe('downloading')
      expect(theVideo.state).toBe('downloading')
      expect(placeholder.state).toBe('absent')
      expect(placeholder).not.toHaveProperty('queueSnapshot')
      expect(placeholder).not.toHaveProperty('stateReason')
    })

    it('reports a movie with a file and a downloading item as downloading, with its snapshot', () => {
      service.setQueue('radarr', [downloading({ movieId: 7 })])
      const theMovie = movie({ filePath: '/movies/A Movie/a.mkv' })

      service.annotate([theMovie])

      expect(theMovie.state).toBe('downloading')
      expect(theMovie.queueSnapshot).toEqual({
        progress: 75,
        status: 'downloading',
        timeLeft: '00:05:00',
      })
      expect(theMovie).not.toHaveProperty('stateReason')
    })

    it('reports a movie with a file and no item as available', () => {
      const theMovie = movie({ filePath: '/movies/A Movie/a.mkv' })

      service.annotate([theMovie])

      expect(theMovie.state).toBe('available')
      expect(theMovie).not.toHaveProperty('queueSnapshot')
    })

    it('treats a movie with no monitored flag as unmonitored', () => {
      const theMovie = movie({ monitored: undefined })

      service.annotate([theMovie])

      expect(theMovie.state).toBe('absent')
    })

    it('marks a stuck import needs_attention with its reason', () => {
      service.setQueue('radarr', [stuckImport({ movieId: 7 })])
      const theMovie = movie()

      service.annotate([theMovie])

      expect(theMovie.state).toBe('needs_attention')
      expect(theMovie.stateReason).toBe(STUCK_REASON)
      expect(theMovie.queueSnapshot).toEqual({
        progress: 100,
        status: 'completed',
      })
    })

    it('lets the highest-precedence item win when a movie has several', () => {
      service.setQueue('radarr', [
        downloading({ movieId: 7 }),
        stuckImport({ movieId: 7 }),
      ])
      const theMovie = movie()

      service.annotate([theMovie])

      expect(theMovie.state).toBe('needs_attention')
      expect(theMovie.stateReason).toBe(STUCK_REASON)
      expect(theMovie.queueSnapshot?.status).toBe('completed')
    })

    it('ignores items for other movies', () => {
      service.setQueue('radarr', [downloading({ movieId: 8 })])
      const theMovie = movie()

      service.annotate([theMovie])

      expect(theMovie.state).toBe('wanted')
    })

    it('reports a series with one downloading episode and 44 files as downloading', () => {
      service.setQueue('sonarr', [downloading({ episodeId: 45, seriesId: 9 })])
      const theShow = show({ episodeFileCount: 44 })

      service.annotate([theShow])

      expect(theShow.state).toBe('downloading')
      expect(theShow.queueSnapshot?.progress).toBe(75)
    })

    it('reports a series with no items and 45 files as available', () => {
      const theShow = show({ episodeFileCount: 45 })

      service.annotate([theShow])

      expect(theShow.state).toBe('available')
      expect(theShow).not.toHaveProperty('queueSnapshot')
    })

    it('reports a monitored series with no files as wanted, despite its folder path', () => {
      const theShow = show()

      service.annotate([theShow])

      expect(theShow.state).toBe('wanted')
    })

    it('reports an unmonitored series with no files as absent', () => {
      const theShow = show({ monitored: false })

      service.annotate([theShow])

      expect(theShow.state).toBe('absent')
    })

    it('treats a series with no episodeFileCount as having no files', () => {
      const theShow = show({ episodeFileCount: undefined, monitored: false })

      service.annotate([theShow])

      expect(theShow.state).toBe('absent')
    })

    it("folds a series' items into one snapshot over the whole grab", () => {
      service.setQueue('sonarr', [
        downloading({
          episodeId: 1,
          seriesId: 9,
          size: 1000,
          sizeleft: 0,
          timeleft: '00:00:00',
        }),
        downloading({
          episodeId: 2,
          seriesId: 9,
          size: 1000,
          sizeleft: 1000,
          timeleft: '00:10:00',
        }),
      ])
      const theShow = show()

      service.annotate([theShow])

      expect(theShow.state).toBe('downloading')
      expect(theShow.queueSnapshot).toEqual({
        progress: 50,
        status: 'downloading',
        timeLeft: '00:10:00',
      })
    })

    it("carries the winning item's reason onto the series", () => {
      service.setQueue('sonarr', [
        downloading({ episodeId: 1, seriesId: 9 }),
        stuckImport({ episodeId: 2, seriesId: 9 }),
      ])
      const theShow = show({ episodeFileCount: 10 })

      service.annotate([theShow])

      expect(theShow.state).toBe('needs_attention')
      expect(theShow.stateReason).toBe(STUCK_REASON)
    })

    it('reports a video with a file and no job as available, and clears a reason', () => {
      const theVideo = video({
        downloadUrls: ['s3://v.mp4'],
        stateReason: 'stale',
      })

      service.annotate([theVideo])

      expect(theVideo.state).toBe('available')
      expect(theVideo).not.toHaveProperty('stateReason')
    })

    it('clears the snapshot and reason when re-annotated after the queue empties', () => {
      service.setQueue('radarr', [stuckImport({ movieId: 7 })])
      service.setQueue('sonarr', [downloading({ episodeId: 1, seriesId: 9 })])
      const theMovie = movie()
      const theShow = show()

      service.annotate([theMovie, theShow])
      expect(theMovie.queueSnapshot).toBeDefined()
      expect(theShow.queueSnapshot).toBeDefined()

      service.setQueue('radarr', [])
      service.setQueue('sonarr', [])
      service.annotate([theMovie, theShow])

      expect(theMovie.state).toBe('wanted')
      expect(theMovie).not.toHaveProperty('queueSnapshot')
      expect(theMovie).not.toHaveProperty('stateReason')
      expect(theShow.state).toBe('wanted')
      expect(theShow).not.toHaveProperty('queueSnapshot')
    })

    it('is idempotent', () => {
      service.setQueue('radarr', [stuckImport({ movieId: 7 })])
      const theMovie = movie()

      service.annotate([theMovie])
      const once = structuredClone(theMovie)
      service.annotate([theMovie])

      expect(theMovie).toEqual(once)
    })

    it('never touches embyStatus', () => {
      const embyStatus = { state: 'indexing' as const }
      const theMovie = movie({ embyStatus, filePath: '/movies/a.mkv' })

      service.annotate([theMovie])

      expect(theMovie.embyStatus).toBe(embyStatus)
    })
  })

  describe('annotateEpisodes', () => {
    const seasons = (): Season[] => [
      {
        episodeCount: 4,
        episodeFileCount: 1,
        episodes: [
          episode({ id: 1 }),
          episode({ hasFile: true, id: 2 }),
          episode({ id: 3 }),
          episode({ id: 4, monitored: false }),
        ],
        monitored: true,
        seasonNumber: 1,
      },
    ]

    const states = (list: Season[]) =>
      list.flatMap(season => season.episodes.map(e => [e.id, e.state]))

    it('covers downloading, available, wanted and absent episodes', () => {
      service.setQueue('sonarr', [downloading({ episodeId: 1, seriesId: 9 })])
      const list = seasons()

      service.annotateEpisodes(9, list)

      expect(states(list)).toEqual([
        [1, 'downloading'],
        [2, 'available'],
        [3, 'wanted'],
        [4, 'absent'],
      ])
      expect(list[0]?.episodes[0]?.queueSnapshot?.progress).toBe(75)
      expect(list[0]?.episodes[1]).not.toHaveProperty('queueSnapshot')
    })

    it("ignores another series' items", () => {
      service.setQueue('sonarr', [downloading({ episodeId: 1, seriesId: 10 })])
      const list = seasons()

      service.annotateEpisodes(9, list)

      expect(list[0]?.episodes[0]?.state).toBe('wanted')
    })

    it('lets an item win over an episode that already has a file', () => {
      service.setQueue('sonarr', [stuckImport({ episodeId: 2, seriesId: 9 })])
      const list = seasons()

      service.annotateEpisodes(9, list)

      expect(list[0]?.episodes[1]?.state).toBe('needs_attention')
      expect(list[0]?.episodes[1]).not.toHaveProperty('stateReason')
    })

    it('clears a stale snapshot once the item has left the queue', () => {
      service.setQueue('sonarr', [downloading({ episodeId: 1, seriesId: 9 })])
      const list = seasons()
      service.annotateEpisodes(9, list)

      service.setQueue('sonarr', [])
      service.annotateEpisodes(9, list)

      expect(list[0]?.episodes[0]?.state).toBe('wanted')
      expect(list[0]?.episodes[0]).not.toHaveProperty('queueSnapshot')
    })
  })
})
