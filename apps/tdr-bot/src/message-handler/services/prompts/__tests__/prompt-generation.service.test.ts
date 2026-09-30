import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'

import {
  createMockMovie,
  createMockShow,
} from 'src/media-operations/request-handling/__test-fixtures__/media-fixtures'
import {
  MOVIE_RESPONSE_CONTEXT_PROMPT,
  TV_SHOW_RESPONSE_CONTEXT_PROMPT,
} from 'src/message-handler/services/prompts/prompt.constants'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { RetryService } from 'src/utils/retry.service'

describe('response-context prompts', () => {
  const moviePrompt = String(MOVIE_RESPONSE_CONTEXT_PROMPT.content)
  const tvPrompt = String(TV_SHOW_RESPONSE_CONTEXT_PROMPT.content)

  it('describes a movie SUCCESS as a queued request, not a download', () => {
    expect(moviePrompt).toContain(
      'SUCCESS: The movie has been requested and is queued',
    )
    expect(moviePrompt).toContain('It has NOT downloaded yet')
    expect(moviePrompt).not.toContain('Confirm successful')
  })

  it('describes a TV_SHOW_SUCCESS as a queued request, not a download', () => {
    expect(tvPrompt).toContain(
      'TV_SHOW_SUCCESS: The show (or the chosen seasons/episodes) has been requested and is queued',
    )
    expect(tvPrompt).toContain('Nothing has downloaded yet')
    expect(tvPrompt).not.toContain('Confirm successful')
  })

  it('covers the already-downloaded situations', () => {
    expect(moviePrompt).toContain('- ALREADY_DOWNLOADED:')
    expect(tvPrompt).toContain('- TV_SHOW_ALREADY_DOWNLOADED:')
  })

  it('tells the model to relay status notes and per-part request results', () => {
    expect(moviePrompt).toContain('relay it plainly')
    expect(tvPrompt).toContain('A line per part of the request')
    expect(tvPrompt).toContain('Waiting for Sonarr to finish adding the show')
  })

  it('does not blame Radarr or Sonarr for request errors', () => {
    expect(moviePrompt).not.toMatch(/Radarr service|Sonarr service/)
    expect(tvPrompt).not.toMatch(/Radarr service|Sonarr service/)
  })
})

describe('PromptGenerationService', () => {
  let service: PromptGenerationService
  let invoke: jest.Mock

  /** The situation text the model was sent on the last call. */
  function sentContext(): string {
    const sent: BaseMessage[] = invoke.mock.calls.at(-1)?.[0] ?? []
    return String(sent.at(-1)?.content)
  }

  beforeEach(() => {
    invoke = jest.fn().mockResolvedValue({ content: 'reply' })
    const retryService = {
      executeWithRetry: jest.fn((operation: () => Promise<unknown>) =>
        operation(),
      ),
    }
    service = new PromptGenerationService(
      retryService as unknown as RetryService,
    )
  })

  const chatModel = (): ChatOpenAI => ({ invoke }) as unknown as ChatOpenAI

  it('blames the download app when a movie request errors without a reason', async () => {
    await service.generateMoviePrompt([], chatModel(), 'error')

    expect(sentContext()).toContain('The download app might be unavailable.')
    expect(sentContext()).not.toContain('Radarr')
  })

  it('blames the download app when a TV show request errors without a reason', async () => {
    await service.generateTvShowPrompt([], chatModel(), 'TV_SHOW_ERROR')

    expect(sentContext()).toContain('The download app might be unavailable.')
    expect(sentContext()).not.toContain('Sonarr')
  })

  describe('selection lists', () => {
    const originalDownloadUrl = process.env.DOWNLOAD_URL

    beforeEach(() => {
      delete process.env.DOWNLOAD_URL
    })

    afterEach(() => {
      if (originalDownloadUrl !== undefined) {
        process.env.DOWNLOAD_URL = originalDownloadUrl
      }
    })

    const movies = [
      createMockMovie(),
      createMockMovie({
        tmdbId: 604,
        title: 'The Matrix Reloaded',
        year: 2003,
        rating: undefined,
      }),
    ]

    const shows = [
      createMockShow(),
      createMockShow({
        tvdbId: 273181,
        title: 'Better Call Saul',
        year: 2015,
        seasons: [{ seasonNumber: 0, monitored: false }],
        ended: false,
        rating: undefined,
      }),
    ]

    const movieList = [
      '1. [The Matrix](<https://download.lilnas.io/movies/603>) (1999) ⭐8.2',
      '2. [The Matrix Reloaded](<https://download.lilnas.io/movies/604>) (2003)',
    ].join('\n')

    const showList = [
      '1. [Breaking Bad](<https://download.lilnas.io/shows/81189>) (2008) - Ended, 3 seasons ⭐9.5',
      '2. [Better Call Saul](<https://download.lilnas.io/shows/273181>) (2015) - Ongoing, 0 seasons',
    ].join('\n')

    it('appends a linked movie list to the model reply', async () => {
      const reply = await service.generateMoviePrompt(
        [],
        chatModel(),
        'multiple_results',
        { searchQuery: 'matrix', movies },
      )

      expect(reply.content).toBe(`reply\n\n${movieList}`)
      expect(sentContext()).toContain('Do NOT write the list')
    })

    it('appends the movie list to the fallback reply too', async () => {
      invoke.mockRejectedValue(new Error('OpenAI is down'))

      const reply = await service.generateMoviePrompt(
        [],
        chatModel(),
        'multiple_results',
        { searchQuery: 'matrix', movies },
      )

      expect(reply.content).toBe(
        `I found multiple movies. Which one would you like?\n\n${movieList}`,
      )
    })

    it('appends a linked show list when several shows match', async () => {
      const reply = await service.generateTvShowPrompt(
        [],
        chatModel(),
        'TV_SHOW_SELECTION_NEEDED',
        { searchQuery: 'breaking', shows },
      )

      expect(reply.content).toBe(`reply\n\n${showList}`)
      expect(sentContext()).toContain('Do NOT write the list')
    })

    it('adds no list when a single show is being narrowed down', async () => {
      const reply = await service.generateTvShowPrompt(
        [],
        chatModel(),
        'TV_SHOW_SELECTION_NEEDED',
        { searchQuery: 'breaking', shows: [createMockShow()] },
      )

      expect(reply.content).toBe('reply')
    })

    it('adds no list to other movie situations', async () => {
      const reply = await service.generateMoviePrompt(
        [],
        chatModel(),
        'success',
        { selectedMovie: movies[0], movies },
      )

      expect(reply.content).toBe('reply')
    })
  })

  it('says the files were deleted when the TV show delete reply falls back', async () => {
    invoke.mockRejectedValue(new Error('OpenAI is down'))

    const reply: HumanMessage = await service.generateTvShowDeletePrompt(
      [],
      chatModel(),
      'TV_SHOW_DELETE_SUCCESS',
      { selectedShow: { title: 'Breaking Bad' } },
    )

    expect(reply.content).toContain('The files were deleted.')
    expect(reply.content).not.toContain('permanently removed')
  })
})
