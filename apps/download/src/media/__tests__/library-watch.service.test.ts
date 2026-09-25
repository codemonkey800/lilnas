import type { EpisodeResource } from '@lilnas/media/sonarr'
import {
  DownloadType,
  type Media,
  MEDIA_EVENT_TYPE,
  type Movie,
  type Show,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { LibraryWatchService } from 'src/media/library-watch.service'
import {
  type LibraryChangeListener,
  MediaResolverService,
} from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { SonarrService } from 'src/media/sonarr.service'

const MOVIE: Movie = {
  id: 'tmdb:1',
  state: 'absent',
  title: 'End of Watch',
  tmdbId: 1,
  type: DownloadType.Movie,
}

const SHOW: Show = {
  id: 'tvdb:7',
  sonarrId: 70,
  state: 'available',
  title: 'A show',
  tvdbId: 7,
  type: DownloadType.Show,
}

/** Lets the listener's un-awaited broadcast run to completion. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('LibraryWatchService', () => {
  let service: LibraryWatchService
  let gateway: {
    broadcast: jest.Mock
    clientCount: number
    watchedMediaIds: jest.Mock
  }
  let resolver: {
    onLibraryChange: jest.Mock
    refreshLibrary: jest.Mock
    refreshTitles: jest.Mock
    resolve: jest.Mock
  }
  let sonarrService: { getEpisodes: jest.Mock }
  let emitChange: LibraryChangeListener

  function resolvesTo(
    media: Media[],
    degradedSources: DownloadType[] = [],
  ): void {
    resolver.resolve.mockResolvedValue({
      degradedSources,
      media: new Map(media.map(item => [item.id, item])),
    })
  }

  beforeEach(async () => {
    gateway = {
      broadcast: jest.fn(),
      clientCount: 1,
      watchedMediaIds: jest.fn(() => new Set<string>()),
    }
    resolver = {
      onLibraryChange: jest.fn((listener: LibraryChangeListener) => {
        emitChange = listener
        return () => {}
      }),
      refreshLibrary: jest.fn().mockResolvedValue(undefined),
      refreshTitles: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn(),
    }
    sonarrService = { getEpisodes: jest.fn().mockResolvedValue([]) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryWatchService,
        MediaStateService,
        { provide: DownloadGateway, useValue: gateway },
        { provide: MediaResolverService, useValue: resolver },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    service = module.get(LibraryWatchService)
    service.onModuleInit()

    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('refreshWatched', () => {
    it('re-reads every watched title', async () => {
      gateway.watchedMediaIds.mockReturnValue(new Set(['tmdb:1', 'tvdb:7']))

      await service.refreshWatched()

      expect(resolver.refreshTitles).toHaveBeenCalledWith(['tmdb:1', 'tvdb:7'])
    })

    it('does nothing while nothing is watched', async () => {
      await service.refreshWatched()

      expect(resolver.refreshTitles).not.toHaveBeenCalled()
    })

    it('skips a tick while the last one is still in flight', async () => {
      gateway.watchedMediaIds.mockReturnValue(new Set(['tmdb:1']))
      let release: () => void = () => {}
      resolver.refreshTitles.mockReturnValueOnce(
        new Promise<void>(resolve => {
          release = resolve
        }),
      )

      const first = service.refreshWatched()
      await service.refreshWatched()
      release()
      await first

      expect(resolver.refreshTitles).toHaveBeenCalledTimes(1)
    })
  })

  describe('refreshLibrary', () => {
    it('re-reads both libraries', async () => {
      await service.refreshLibrary()

      expect(resolver.refreshLibrary).toHaveBeenCalledWith(DownloadType.Movie)
      expect(resolver.refreshLibrary).toHaveBeenCalledWith(DownloadType.Show)
    })

    it('does nothing while no tab is connected', async () => {
      gateway.clientCount = 0

      await service.refreshLibrary()

      expect(resolver.refreshLibrary).not.toHaveBeenCalled()
    })

    it('still refreshes one source when the other fails', async () => {
      resolver.refreshLibrary.mockImplementation(async (type: DownloadType) => {
        if (type === DownloadType.Movie) throw new Error('down')
      })

      await expect(service.refreshLibrary()).resolves.toBeUndefined()

      expect(resolver.refreshLibrary).toHaveBeenCalledTimes(2)
    })
  })

  describe('library changes', () => {
    it('broadcasts each changed movie as a media event', async () => {
      resolvesTo([MOVIE])

      emitChange(['tmdb:1'])
      await flush()

      expect(resolver.resolve).toHaveBeenCalledWith([
        { mediaId: 'tmdb:1', type: DownloadType.Movie },
      ])
      expect(gateway.broadcast).toHaveBeenCalledWith({
        data: { media: MOVIE },
        type: MEDIA_EVENT_TYPE,
      })
    })

    it('sends a show with its episode states', async () => {
      resolvesTo([SHOW])
      sonarrService.getEpisodes.mockResolvedValue([
        {
          episodeFileId: 0,
          episodeNumber: 1,
          hasFile: false,
          id: 101,
          monitored: true,
          seasonNumber: 1,
        } satisfies EpisodeResource,
      ])

      emitChange(['tvdb:7'])
      await flush()

      expect(sonarrService.getEpisodes).toHaveBeenCalledWith(70)
      expect(gateway.broadcast).toHaveBeenCalledWith({
        data: {
          episodes: [expect.objectContaining({ episodeId: 101 })],
          media: SHOW,
        },
        type: MEDIA_EVENT_TYPE,
      })
    })

    it('skips a show whose episodes cannot be read', async () => {
      resolvesTo([SHOW])
      sonarrService.getEpisodes.mockRejectedValue(new Error('down'))

      emitChange(['tvdb:7'])
      await flush()

      expect(gateway.broadcast).not.toHaveBeenCalled()
    })

    it('skips a degraded source rather than send a placeholder', async () => {
      resolvesTo([MOVIE], [DownloadType.Movie])

      emitChange(['tmdb:1'])
      await flush()

      expect(gateway.broadcast).not.toHaveBeenCalled()
    })

    it('resolves nothing while no tab is connected', async () => {
      gateway.clientCount = 0

      emitChange(['tmdb:1'])
      await flush()

      expect(resolver.resolve).not.toHaveBeenCalled()
    })

    it('swallows a resolve failure', async () => {
      resolver.resolve.mockRejectedValue(new Error('boom'))

      emitChange(['tmdb:1'])
      await flush()

      expect(gateway.broadcast).not.toHaveBeenCalled()
    })
  })
})
