import { AIMessage, HumanMessage } from '@langchain/core/messages'

import { MediaSkill } from 'src/llm/skills/media.skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { createMockDiscordIdentity } from 'src/media-operations/request-handling/__test-helpers__/mock-services'
import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { DownloadStatusStrategy } from 'src/media-operations/request-handling/strategies/download-status.strategy'
import { MediaBrowsingStrategy } from 'src/media-operations/request-handling/strategies/media-browsing.strategy'
import { MovieDeleteStrategy } from 'src/media-operations/request-handling/strategies/movie-delete.strategy'
import { MovieDownloadStrategy } from 'src/media-operations/request-handling/strategies/movie-download.strategy'
import { TvDeleteStrategy } from 'src/media-operations/request-handling/strategies/tv-delete.strategy'
import { TvDownloadStrategy } from 'src/media-operations/request-handling/strategies/tv-download.strategy'
import { MediaContextType } from 'src/media-operations/request-handling/types'
import { MediaRequestType, SearchIntent } from 'src/schemas/graph'

const strategy = <T>() =>
  ({ handleRequest: jest.fn() }) as unknown as jest.Mocked<T>

describe('MediaSkill', () => {
  let llm: FakeLlmClient
  let movieDownload: jest.Mocked<MovieDownloadStrategy>
  let tvDownload: jest.Mocked<TvDownloadStrategy>
  let movieDelete: jest.Mocked<MovieDeleteStrategy>
  let tvDelete: jest.Mocked<TvDeleteStrategy>
  let browsing: jest.Mocked<MediaBrowsingStrategy>
  let status: jest.Mocked<DownloadStatusStrategy>
  let skill: MediaSkill

  const input = (content: string, extra: Partial<SkillInput> = {}) => {
    const message = new HumanMessage({ id: 'h-1', content })
    return {
      message,
      history: [new AIMessage({ id: 'a-0', content: 'earlier' })],
      userId: 'user-1',
      channelId: 'chan-1',
      guildId: 'guild-1',
      discord: createMockDiscordIdentity('user-1'),
      ...extra,
    } satisfies SkillInput
  }

  const pendingContext = {
    type: MediaContextType.MovieDownload,
    data: { type: 'movie', searchResults: [], query: 'matrix', isActive: true },
  }

  beforeEach(() => {
    llm = new FakeLlmClient()
    movieDownload = strategy()
    tvDownload = strategy()
    movieDelete = strategy()
    tvDelete = strategy()
    browsing = strategy()
    status = strategy()
    skill = new MediaSkill(
      new MediaRequestHandler(
        llm,
        movieDownload,
        tvDownload,
        movieDelete,
        tvDelete,
        browsing,
        status,
      ),
    )
  })

  describe('match', () => {
    it.each([
      'download the matrix movie',
      'please delete that show',
      'remove the film Heat',
      'download season 2 of Severance',
      "what's downloading?",
      'What is downloading right now',
    ])('matches "%s"', content => {
      expect(skill.match(input(content))).toBe(true)
    })

    it.each([
      'which movies do I have',
      'what is the weather',
      'download the report',
      'the first one',
    ])('does not match "%s"', content => {
      expect(skill.match(input(content))).toBe(false)
    })
  })

  it('asks for a selection and returns the pending context as the follow-up', async () => {
    llm.script('media.intent', {
      mediaType: MediaRequestType.Movies,
      searchIntent: SearchIntent.External,
      searchTerms: 'matrix',
    })
    const args = input('download the matrix movie')
    const ask = new AIMessage({ id: 'a-1', content: 'Which Matrix?' })
    movieDownload.handleRequest.mockImplementation(async ({ messages }) => ({
      images: [],
      messages: messages.concat(ask),
      pendingContext,
    }))

    const out = await skill.run(args)

    expect(out.messages).toEqual([ask])
    expect(out.followUp).toEqual({ data: pendingContext })
    expect(out.reroute).toBeUndefined()
  })

  it('resumes the follow-up with "the first one" and finishes the download', async () => {
    llm.script('media.topicSwitch', 'CONTINUE')
    const args = input('the first one', { followUp: pendingContext })
    const done = new AIMessage({ id: 'a-2', content: 'Downloading The Matrix' })
    const images = [{ title: 'poster', url: 'https://x/p.png' }]
    movieDownload.handleRequest.mockImplementation(async ({ messages }) => ({
      images,
      messages: messages.concat(done),
    }))

    const out = await skill.run(args)

    expect(movieDownload.handleRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        message: args.message,
        context: pendingContext.data,
        userId: 'user-1',
      }),
    )
    expect(llm.calls.map(c => c.operation)).toEqual(['media.topicSwitch'])
    expect(out.messages).toEqual([done])
    expect(out.images).toEqual(images)
    expect(out.followUp).toBeNull()
  })

  it('re-emits the follow-up when the pick needs clarifying', async () => {
    llm.script('media.topicSwitch', 'CONTINUE')
    const ask = new AIMessage({ id: 'a-3', content: 'Which one?' })
    movieDownload.handleRequest.mockImplementation(async ({ messages }) => ({
      images: [],
      messages: messages.concat(ask),
      pendingContext,
    }))

    const out = await skill.run(input('hmm', { followUp: pendingContext }))

    expect(out.followUp).toEqual({ data: pendingContext })
  })

  it('reroutes an unrelated follow-up without running a strategy', async () => {
    llm.script('media.topicSwitch', 'SWITCH')

    const out = await skill.run(
      input("what's the weather?", { followUp: pendingContext }),
    )

    expect(out).toEqual({ messages: [], followUp: null, reroute: true })
    for (const s of [movieDownload, tvDownload, movieDelete, tvDelete]) {
      expect(s.handleRequest).not.toHaveBeenCalled()
    }
    expect(browsing.handleRequest).not.toHaveBeenCalled()
    expect(status.handleRequest).not.toHaveBeenCalled()
  })

  it('answers a status request through the status strategy with no follow-up', async () => {
    llm.script('media.intent', {
      mediaType: MediaRequestType.Both,
      searchIntent: SearchIntent.Library,
      searchTerms: '',
    })
    const args = input("what's downloading?")
    expect(skill.match(args)).toBe(true)
    const reply = new AIMessage({ id: 'a-4', content: 'Nothing right now' })
    status.handleRequest.mockImplementation(async ({ message, messages }) => ({
      images: [],
      messages: [...messages, message, reply],
    }))

    const out = await skill.run(args)

    expect(status.handleRequest).toHaveBeenCalledTimes(1)
    expect(out.messages).toEqual([reply])
    expect(out.followUp).toBeNull()
  })

  it('turns a non-AI fallback reply into an AI message', async () => {
    llm.script('media.intent', {
      mediaType: MediaRequestType.Movies,
      searchIntent: SearchIntent.External,
      searchTerms: 'matrix',
    })
    movieDownload.handleRequest.mockImplementation(async ({ messages }) => ({
      images: [],
      messages: messages.concat(
        new HumanMessage({ id: 'err', content: 'Sorry, I hit an error' }),
      ),
    }))

    const out = await skill.run(input('download the matrix movie'))

    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]).toBeInstanceOf(AIMessage)
    expect(out.messages[0].content).toBe('Sorry, I hit an error')
  })
})
