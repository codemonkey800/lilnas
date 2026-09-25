import {
  DownloadType,
  type Media,
  type Movie,
  type Show,
  type Video,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import type { EmbyItem, EmbySystemInfo, EmbyUser } from 'src/emby/emby.schema'
import { EmbyService } from 'src/emby/emby.service'
import { EmbyStatusService } from 'src/emby/emby-status.service'

const EMBY_EXTERNAL_URL = 'https://emby.lilnas.io'
const EMBY_USERNAME = 'jeremy'

const USER: EmbyUser = { Id: 'user-1', Name: EMBY_USERNAME }
const SYSTEM_INFO: EmbySystemInfo = { Id: 'server-1' }

const MOVIE_PATH = '/movies/Some Movie (2020)/Some Movie (2020).mkv'
const SHOW_PATH = '/tv/Some Show'

interface EmbyServiceMock {
  getLibraryItems: jest.Mock<Promise<EmbyItem[]>, [string]>
  getSystemInfo: jest.Mock<Promise<EmbySystemInfo>, []>
  getUsers: jest.Mock<Promise<EmbyUser[]>, []>
}

function movie(overrides: Partial<Movie> = {}): Movie {
  return {
    filePath: MOVIE_PATH,
    id: 'tmdb:438631',
    title: 'Some Movie',
    tmdbId: 438631,
    type: DownloadType.Movie,
    ...overrides,
  }
}

function show(overrides: Partial<Show> = {}): Show {
  return {
    filePath: SHOW_PATH,
    id: 'tvdb:121361',
    title: 'Some Show',
    tvdbId: 121361,
    type: DownloadType.Show,
    ...overrides,
  }
}

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video:abc123',
    sourceUrl: 'https://example.com/watch?v=abc123',
    title: 'Some Clip',
    type: DownloadType.Video,
    ...overrides,
  }
}

/** Does the object literally carry the key, as opposed to `undefined`? */
function hasEmbyStatus(media: Media): boolean {
  return Object.prototype.hasOwnProperty.call(media, 'embyStatus')
}

describe('EmbyStatusService', () => {
  let service: EmbyStatusService
  let embyService: EmbyServiceMock
  let warnSpy: jest.SpiedFunction<Logger['warn']>
  let originalEnv: NodeJS.ProcessEnv

  async function createService(): Promise<EmbyStatusService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbyStatusService,
        { provide: EmbyService, useValue: embyService },
      ],
    }).compile()

    return module.get<EmbyStatusService>(EmbyStatusService)
  }

  beforeEach(async () => {
    originalEnv = { ...process.env }
    process.env.EMBY_EXTERNAL_URL = EMBY_EXTERNAL_URL
    process.env.EMBY_USERNAME = EMBY_USERNAME

    embyService = {
      getLibraryItems: jest.fn<Promise<EmbyItem[]>, [string]>(),
      getSystemInfo: jest.fn<Promise<EmbySystemInfo>, []>(),
      getUsers: jest.fn<Promise<EmbyUser[]>, []>(),
    }

    embyService.getUsers.mockResolvedValue([USER])
    embyService.getSystemInfo.mockResolvedValue(SYSTEM_INFO)
    embyService.getLibraryItems.mockResolvedValue([])

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()

    service = await createService()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('constructor', () => {
    it('fails loudly at construction when EMBY_EXTERNAL_URL is unset', async () => {
      jest.spyOn(console, 'error').mockImplementation()
      delete process.env.EMBY_EXTERNAL_URL

      await expect(createService()).rejects.toThrow(
        'EMBY_EXTERNAL_URL not defined',
      )
    })

    it('fails loudly at construction when EMBY_USERNAME is unset', async () => {
      jest.spyOn(console, 'error').mockImplementation()
      delete process.env.EMBY_USERNAME

      await expect(createService()).rejects.toThrow('EMBY_USERNAME not defined')
    })
  })

  describe('indexed', () => {
    it('matches a movie on its exact file path and builds the watch URL', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Name: 'Some Movie', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({
        itemId: 'item-9',
        state: 'indexed',
        watchUrl:
          'https://emby.lilnas.io/web/index.html#!/item?id=item-9&serverId=server-1',
      })
    })

    it('queries the library as the user whose Name matches EMBY_USERNAME', async () => {
      embyService.getUsers.mockResolvedValue([
        { Id: 'user-0', Name: 'someone-else' },
        USER,
      ])

      await service.annotate([movie()])

      expect(embyService.getLibraryItems).toHaveBeenCalledWith('user-1')
    })

    it('matches a show on its series folder', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'series-3', Name: 'Some Show', Path: SHOW_PATH, Type: 'Series' },
      ])
      const media = show()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({
        itemId: 'series-3',
        state: 'indexed',
        watchUrl:
          'https://emby.lilnas.io/web/index.html#!/item?id=series-3&serverId=server-1',
      })
    })

    it('matches when only the media path has a trailing slash', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'series-3', Path: SHOW_PATH, Type: 'Series' },
      ])
      const media = show({ filePath: `${SHOW_PATH}/` })

      await service.annotate([media])

      expect(media.embyStatus?.state).toBe('indexed')
      expect(media.embyStatus?.itemId).toBe('series-3')
    })

    it('matches when only the Emby path has a trailing slash', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'series-3', Path: `${SHOW_PATH}/`, Type: 'Series' },
      ])
      const media = show({ filePath: SHOW_PATH })

      await service.annotate([media])

      expect(media.embyStatus?.state).toBe('indexed')
      expect(media.embyStatus?.itemId).toBe('series-3')
    })

    it('annotates a mixed batch of movies and shows in one pass', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
        { Id: 'series-3', Path: SHOW_PATH, Type: 'Series' },
      ])
      const mediaMovie = movie()
      const mediaShow = show()

      await service.annotate([mediaMovie, mediaShow])

      expect(mediaMovie.embyStatus?.itemId).toBe('item-9')
      expect(mediaShow.embyStatus?.itemId).toBe('series-3')
      expect(embyService.getLibraryItems).toHaveBeenCalledTimes(1)
    })

    it('mutates in place, so a Map values() iterator is enough', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const stored = movie()
      const media = new Map<string, Media>([[stored.id, stored]])

      await service.annotate(media.values())

      // The map still holds the same object it was given - annotate() wrote
      // through the reference rather than handing back a copy.
      expect(media.get(stored.id)).toBe(stored)
      expect(stored.embyStatus?.itemId).toBe('item-9')
    })

    it('survives two media sharing one normalized path', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const first = movie()
      const second = movie({ id: 'tmdb:999', tmdbId: 999 })

      await service.annotate([first, second])

      expect(first.embyStatus?.itemId).toBe('item-9')
      expect(second.embyStatus?.itemId).toBe('item-9')
    })

    it('keeps the last item when Emby reports two entries for one path', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-old', Path: MOVIE_PATH, Type: 'Movie' },
        { Id: 'item-new', Path: `${MOVIE_PATH}/`, Type: 'Movie' },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus?.itemId).toBe('item-new')
    })
  })

  describe('indexing', () => {
    it('reports indexing when no Emby item has the path', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        {
          Id: 'item-9',
          Path: '/movies/Another Movie/other.mkv',
          Type: 'Movie',
        },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({ state: 'indexing' })
    })

    it('reports indexing when the library is empty', async () => {
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({ state: 'indexing' })
    })

    it('does not match a movie against a Series item at the same path', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'series-3', Path: MOVIE_PATH, Type: 'Series' },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({ state: 'indexing' })
    })

    it('does not match a differently-cased path', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH.toLowerCase(), Type: 'Movie' },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({ state: 'indexing' })
    })

    it('skips index entries that carry no Path', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Name: 'Some Movie', Type: 'Movie' },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({ state: 'indexing' })
    })
  })

  describe('unknown', () => {
    it('reports unknown for every candidate when getUsers fails', async () => {
      embyService.getUsers.mockRejectedValue(new Error('ECONNREFUSED'))
      const mediaMovie = movie()
      const mediaShow = show()

      await expect(
        service.annotate([mediaMovie, mediaShow]),
      ).resolves.toBeUndefined()

      expect(mediaMovie.embyStatus).toStrictEqual({ state: 'unknown' })
      expect(mediaShow.embyStatus).toStrictEqual({ state: 'unknown' })
    })

    it('reports unknown for every candidate when getSystemInfo fails', async () => {
      embyService.getSystemInfo.mockRejectedValue(new Error('500 Internal'))
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const mediaMovie = movie()
      const mediaShow = show()

      await expect(
        service.annotate([mediaMovie, mediaShow]),
      ).resolves.toBeUndefined()

      expect(mediaMovie.embyStatus).toStrictEqual({ state: 'unknown' })
      expect(mediaShow.embyStatus).toStrictEqual({ state: 'unknown' })
    })

    it('reports unknown for every candidate when getLibraryItems fails', async () => {
      embyService.getLibraryItems.mockRejectedValue(
        new DOMException('The operation was aborted.', 'TimeoutError'),
      )
      const mediaMovie = movie()
      const mediaShow = show()

      await expect(
        service.annotate([mediaMovie, mediaShow]),
      ).resolves.toBeUndefined()

      expect(mediaMovie.embyStatus).toStrictEqual({ state: 'unknown' })
      expect(mediaShow.embyStatus).toStrictEqual({ state: 'unknown' })
    })

    it('logs the available user names when EMBY_USERNAME matches nobody', async () => {
      embyService.getUsers.mockResolvedValue([
        { Id: 'user-a', Name: 'alice' },
        { Id: 'user-b', Name: 'bob' },
      ])
      const media = movie()

      await service.annotate([media])

      expect(media.embyStatus).toStrictEqual({ state: 'unknown' })
      const messages = warnSpy.mock.calls.map(call =>
        String(call[1] ?? call[0]),
      )
      expect(
        messages.some(
          message =>
            message.includes(EMBY_USERNAME) &&
            message.includes('alice') &&
            message.includes('bob'),
        ),
      ).toBe(true)
    })

    it('never asks Emby for the library when the username does not resolve', async () => {
      embyService.getUsers.mockResolvedValue([{ Id: 'user-a', Name: 'alice' }])

      await service.annotate([movie()])

      expect(embyService.getLibraryItems).not.toHaveBeenCalled()
    })
  })

  describe('candidate filtering', () => {
    it('makes no Emby call at all when nothing has a file on disk', async () => {
      await service.annotate([
        movie({ filePath: undefined }),
        show({ filePath: undefined }),
        video(),
      ])

      expect(embyService.getUsers).not.toHaveBeenCalled()
      expect(embyService.getSystemInfo).not.toHaveBeenCalled()
      expect(embyService.getLibraryItems).not.toHaveBeenCalled()
    })

    it('makes no Emby call for an empty batch', async () => {
      await service.annotate([])

      expect(embyService.getUsers).not.toHaveBeenCalled()
      expect(embyService.getSystemInfo).not.toHaveBeenCalled()
      expect(embyService.getLibraryItems).not.toHaveBeenCalled()
    })

    it('leaves embyStatus absent entirely for media with no filePath', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const downloaded = movie()
      const requested = movie({
        filePath: undefined,
        id: 'tmdb:999',
        tmdbId: 999,
      })

      await service.annotate([downloaded, requested])

      expect(downloaded.embyStatus?.state).toBe('indexed')
      expect(hasEmbyStatus(requested)).toBe(false)
    })

    it('leaves embyStatus absent for media with an empty filePath', async () => {
      const media = movie({ filePath: '' })

      await service.annotate([media])

      expect(hasEmbyStatus(media)).toBe(false)
      expect(embyService.getUsers).not.toHaveBeenCalled()
    })

    it('ignores a Video, even alongside annotated media', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const clip = video()
      const media = movie()

      await service.annotate([clip, media])

      expect(hasEmbyStatus(clip)).toBe(false)
      expect(media.embyStatus?.state).toBe('indexed')
    })

    it('does not annotate media whose Emby lookup was never needed', async () => {
      embyService.getUsers.mockRejectedValue(new Error('ECONNREFUSED'))
      const requested = movie({ filePath: undefined })
      const downloaded = movie({ id: 'tmdb:999', tmdbId: 999 })

      await service.annotate([requested, downloaded])

      expect(hasEmbyStatus(requested)).toBe(false)
      expect(downloaded.embyStatus).toStrictEqual({ state: 'unknown' })
    })
  })

  describe('caching', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('serves a second annotate inside the 60s TTL from cache', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])

      await service.annotate([movie()])
      jest.advanceTimersByTime(59_000)
      const second = movie()
      await service.annotate([second])

      expect(embyService.getUsers).toHaveBeenCalledTimes(1)
      expect(embyService.getSystemInfo).toHaveBeenCalledTimes(1)
      expect(embyService.getLibraryItems).toHaveBeenCalledTimes(1)
      expect(second.embyStatus?.itemId).toBe('item-9')
    })

    it('refetches the library once the 60s TTL has expired', async () => {
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])

      await service.annotate([movie()])
      jest.advanceTimersByTime(60_001)
      await service.annotate([movie()])

      expect(embyService.getLibraryItems).toHaveBeenCalledTimes(2)
      // The user and server ids are process-lifetime caches, not TTL'd.
      expect(embyService.getUsers).toHaveBeenCalledTimes(1)
      expect(embyService.getSystemInfo).toHaveBeenCalledTimes(1)
    })

    it('suppresses a refetch for 10s after a failed library lookup', async () => {
      embyService.getLibraryItems.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.annotate([movie()])
      jest.advanceTimersByTime(9_000)
      const second = movie()
      await service.annotate([second])

      expect(embyService.getLibraryItems).toHaveBeenCalledTimes(1)
      // A cached *failure*, not a cached empty library - the difference
      // between "we don't know" and a confident, wrong "still indexing".
      expect(second.embyStatus).toStrictEqual({ state: 'unknown' })
    })

    it('retries the library once the 10s failure TTL has expired', async () => {
      embyService.getLibraryItems.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.annotate([movie()])
      jest.advanceTimersByTime(10_001)
      embyService.getLibraryItems.mockResolvedValue([
        { Id: 'item-9', Path: MOVIE_PATH, Type: 'Movie' },
      ])
      const second = movie()
      await service.annotate([second])

      expect(embyService.getLibraryItems).toHaveBeenCalledTimes(2)
      expect(second.embyStatus?.itemId).toBe('item-9')
    })

    it('retries the user lookup after a failure rather than caching it', async () => {
      embyService.getUsers.mockRejectedValue(new Error('ECONNREFUSED'))

      await service.annotate([movie()])
      embyService.getUsers.mockResolvedValue([USER])
      const second = movie()
      await service.annotate([second])

      expect(embyService.getUsers).toHaveBeenCalledTimes(2)
      expect(second.embyStatus).toStrictEqual({ state: 'indexing' })
    })
  })
})
