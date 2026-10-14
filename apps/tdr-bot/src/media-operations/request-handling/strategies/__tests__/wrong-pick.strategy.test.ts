import { HumanMessage } from '@langchain/core/messages'
import { DownloadApiError } from '@lilnas/utils/download/client'
import { QualityTier } from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { PromptGenerationService } from 'src/llm/skills/media/prompt-generation.service'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import type { MovieSearchResult } from 'src/media/types/radarr.types'
import {
  type SeriesSearchResult,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import {
  createMockDiscordIdentity,
  createMockDownloadClientFactory,
  createMockPromptGenerationService,
  createMockRadarrService,
  createMockSonarrService,
} from 'src/media-operations/request-handling/__test-helpers__/mock-services'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import type { RecentRequestContext } from 'src/media-operations/request-handling/strategies/base/strategy.types'
import { WrongPickStrategy } from 'src/media-operations/request-handling/strategies/wrong-pick.strategy'
import { MediaContextType } from 'src/media-operations/request-handling/types/request-context.type'

function show(tvdbId: number, title: string): SeriesSearchResult {
  return {
    tvdbId,
    title,
    titleSlug: title.toLowerCase().replace(/\s+/g, '-'),
    status: SonarrSeriesStatus.CONTINUING,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [],
    genres: [],
    ended: false,
  } as SeriesSearchResult
}

function movie(tmdbId: number, title: string): MovieSearchResult {
  return { tmdbId, title, genres: [] } as unknown as MovieSearchResult
}

describe('WrongPickStrategy', () => {
  let strategy: WrongPickStrategy
  let sonarrService: jest.Mocked<SonarrService>
  let radarrService: jest.Mocked<RadarrService>
  let promptService: jest.Mocked<PromptGenerationService>
  let mocks: ReturnType<typeof createMockDownloadClientFactory>

  const discord = createMockDiscordIdentity('user-1')
  const message = new HumanMessage({ content: 'wrong show' })
  const messages = [message]
  const sideQuest = show(428425, 'Side Quest')
  const visionQuest = show(426606, 'VisionQuest')
  const visionsOfUs = show(405533, 'Visions of Us')

  const recentShow: RecentRequestContext = {
    type: 'recentRequest',
    mediaType: 'tv',
    title: 'Side Quest',
    mediaId: 'tvdb:428425',
    externalId: 428425,
    jobIds: ['job-1', 'job-2'],
    wasInLibrary: false,
    query: 'Vision Quest',
    tvSelection: { selection: [{ season: 1 }] },
    qualityTier: QualityTier.UpTo4k,
    timestamp: Date.now(),
  }

  const run = (context: RecentRequestContext) =>
    strategy.handleRequest({
      message,
      messages,
      userId: 'user-1',
      discord,
      context,
    })

  const replyText = (result: { messages: unknown[] }) =>
    String((result.messages.at(-1) as HumanMessage).content)

  beforeEach(async () => {
    sonarrService = createMockSonarrService()
    radarrService = createMockRadarrService()
    promptService = createMockPromptGenerationService()
    mocks = createMockDownloadClientFactory()

    promptService.generateTvShowChatResponse.mockResolvedValue(
      new HumanMessage({ id: 'reply', content: 'Which one did you mean?' }),
    )
    promptService.generateMoviePrompt.mockResolvedValue(
      new HumanMessage({ id: 'reply', content: 'Which movie did you mean?' }),
    )
    mocks.client.deleteMediaFiles.mockResolvedValue({
      deletedCount: 0,
      mediaId: 'tvdb:428425',
      removedFromLibrary: true,
    })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WrongPickStrategy,
        { provide: SonarrService, useValue: sonarrService },
        { provide: RadarrService, useValue: radarrService },
        { provide: DownloadClientFactory, useValue: mocks.factory },
        { provide: PromptGenerationService, useValue: promptService },
      ],
    }).compile()

    strategy = module.get(WrongPickStrategy)
  })

  it('cancels every job and removes a show the request added', async () => {
    sonarrService.searchShows.mockResolvedValue([visionsOfUs, sideQuest])

    const result = await run(recentShow)

    expect(mocks.factory.forDiscord).toHaveBeenCalledWith(discord)
    expect(mocks.client.cancelShowJob).toHaveBeenCalledWith('job-1')
    expect(mocks.client.cancelShowJob).toHaveBeenCalledWith('job-2')
    expect(mocks.client.deleteMediaFiles).toHaveBeenCalledWith('tvdb:428425')
    expect(replyText(result)).toContain(
      'cancelled the request for "Side Quest" and removed it from the library',
    )
  })

  it('leaves a show that was already in the library', async () => {
    sonarrService.searchShows.mockResolvedValue([visionsOfUs])

    const result = await run({ ...recentShow, wasInLibrary: true })

    expect(mocks.client.cancelShowJob).toHaveBeenCalledTimes(2)
    expect(mocks.client.deleteMediaFiles).not.toHaveBeenCalled()
    expect(replyText(result)).toContain('already in the library')
  })

  it('still removes the show when a job was already finished', async () => {
    mocks.client.cancelShowJob.mockRejectedValue(
      new DownloadApiError(404, 'Not Found', {}),
    )
    sonarrService.searchShows.mockResolvedValue([visionsOfUs])

    await run(recentShow)

    expect(mocks.client.deleteMediaFiles).toHaveBeenCalledWith('tvdb:428425')
  })

  it('says so when the show could not be removed', async () => {
    mocks.client.deleteMediaFiles.mockRejectedValue(new Error('socket hang up'))
    sonarrService.searchShows.mockResolvedValue([visionsOfUs])

    const result = await run(recentShow)

    expect(replyText(result)).toContain("couldn't remove it from the library")
  })

  it('offers the other matches, without the wrong one, as a new pick', async () => {
    sonarrService.searchShows.mockImplementation(async term =>
      term === 'VisionQuest' ? [visionQuest] : [visionsOfUs, sideQuest],
    )

    const result = await run(recentShow)

    expect(promptService.generateTvShowChatResponse).toHaveBeenCalledWith(
      messages,
      'TV_SHOW_SELECTION_NEEDED',
      { searchQuery: 'Vision Quest', shows: [visionQuest, visionsOfUs] },
    )
    expect(result.pendingContext).toEqual({
      type: MediaContextType.TvDownload,
      data: expect.objectContaining({
        type: 'tvShow',
        isActive: true,
        query: 'Vision Quest',
        searchResults: [visionQuest, visionsOfUs],
        originalTvSelection: { selection: [{ season: 1 }] },
        qualityTier: QualityTier.UpTo4k,
      }),
    })
    expect(replyText(result)).toMatch(
      /^My bad .*\n\nWhich one did you mean\?$/s,
    )
  })

  it('asks for the exact title when nothing else matches', async () => {
    sonarrService.searchShows.mockResolvedValue([sideQuest])

    const result = await run(recentShow)

    expect(result.pendingContext).toBeUndefined()
    expect(replyText(result)).toContain("what's the exact title")
  })

  it('still reports the undo when the new search fails', async () => {
    sonarrService.searchShows.mockRejectedValue(new Error('Sonarr down'))

    const result = await run(recentShow)

    expect(mocks.client.deleteMediaFiles).toHaveBeenCalled()
    expect(replyText(result)).toContain('removed it from the library')
    expect(result.pendingContext).toBeUndefined()
  })

  it('undoes a movie through the movie endpoints', async () => {
    const theMatrix = movie(603, 'The Matrix')
    const matrixResurrections = movie(624860, 'The Matrix Resurrections')
    radarrService.searchMovies.mockResolvedValue([
      matrixResurrections,
      theMatrix,
    ])

    const result = await run({
      type: 'recentRequest',
      mediaType: 'movie',
      title: 'The Matrix Resurrections',
      mediaId: 'tmdb:624860',
      externalId: 624860,
      jobIds: ['job-9'],
      wasInLibrary: false,
      query: 'matrix',
      timestamp: Date.now(),
    })

    expect(mocks.client.cancelMovieJob).toHaveBeenCalledWith('job-9')
    expect(mocks.client.cancelShowJob).not.toHaveBeenCalled()
    expect(mocks.client.deleteMediaFiles).toHaveBeenCalledWith('tmdb:624860')
    expect(result.pendingContext).toEqual({
      type: MediaContextType.MovieDownload,
      data: expect.objectContaining({
        type: 'movie',
        searchResults: [theMatrix],
      }),
    })
  })
})
