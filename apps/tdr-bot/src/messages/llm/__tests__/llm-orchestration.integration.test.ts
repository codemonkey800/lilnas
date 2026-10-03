/**
 * Integration tests for LLMOrchestrationService.
 *
 * Full turns through the real compiled skills graph: real SkillRegistry, the
 * five real skills, the real PromptService and a MemorySaver checkpointer.
 * Only the LlmClient (a scripted FakeLlmClient) and I/O services
 * (EquationImageService, MediaRequestHandler, ReminderService, Tavily) are
 * faked. The T3 golden SCENARIOS are replayed end to end with scripted
 * responses.
 */

// Distinct message ids per turn: the global nanoid mock would collapse them.
let nanoidCounter = 0
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => `nano-${++nanoidCounter}`),
}))
jest.mock('@langchain/tavily')
const mockTools: StructuredToolInterface[] = []
jest.mock('src/messages/llm/tools', () => ({
  getTools: jest.fn(() => mockTools),
}))

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages'
import { StructuredToolInterface, tool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph'
import { Test, TestingModule } from '@nestjs/testing'
import { z } from 'zod'

import { createMockMetricsService } from 'src/__tests__/test-utils'
import { LlmClient } from 'src/llm/client/llm-client'
import { GRAPH_CHECKPOINTER } from 'src/llm/graph/checkpointer'
import { threadIdFor } from 'src/llm/graph/thread-id'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { ChatSkill } from 'src/llm/skills/chat/skill'
import { ImageSkill } from 'src/llm/skills/image/skill'
import { MathSkill } from 'src/llm/skills/math/skill'
import { MediaSkill } from 'src/llm/skills/media.skill'
import { ReminderSkill } from 'src/llm/skills/reminder.skill'
import { SKILLS } from 'src/llm/skills/skill.interface'
import { SkillRegistry } from 'src/llm/skills/skill.registry'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { SCENARIOS } from 'src/llm/testing/golden/scenarios'
import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import {
  type ActiveMediaContext,
  MediaContextType,
} from 'src/media-operations/request-handling/types'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { ReminderService } from 'src/reminders/reminder.service'
import { EquationImageService } from 'src/services/equation-image.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

const TEST_TIMEOUT = 15_000

const REMINDER_EXTRACTION = {
  action: 'create',
  what: null,
  isRecurring: null,
  day: null,
  time: null,
  recurringPattern: null,
  scheduledAt: null,
  cronExpression: null,
  reminderIdToCancel: null,
  channelId: null,
  targetUserId: null,
  actionType: 'default',
}

type Responses = Record<string, object | string>

/** Scripted LLM responses and fake-service behaviour for one turn. */
interface TurnScript {
  llm: Responses
  media?: {
    messages: AIMessage[]
    pendingContext?: ActiveMediaContext
    reroute?: true
  }
}

/** Per-scenario scripts, one entry per turn of the matching SCENARIOS entry. */
const SCENARIO_SCRIPTS: Record<string, TurnScript[]> = {
  'reminder missing the day, then supplied': [
    {
      llm: {
        'reminder.extract': {
          ...REMINDER_EXTRACTION,
          what: 'call mom',
          time: '5pm',
        },
        'reminder.askMissing': 'Which day should I remind you?',
      },
    },
    {
      llm: {
        'reminder.topicSwitch': { continuing: true },
        'reminder.extract': { ...REMINDER_EXTRACTION, day: 'tomorrow' },
        'reminder.confirm': 'Got it! I will remind you tomorrow at 5pm.',
      },
    },
  ],
  'reminder then topic switch': [
    {
      llm: {
        'reminder.extract': {
          ...REMINDER_EXTRACTION,
          what: 'water the plants',
        },
        'reminder.askMissing': 'Which day should I remind you?',
      },
    },
    {
      llm: {
        'reminder.topicSwitch': { continuing: false },
        'router.classify': { skill: 'chat' },
        'chat.respond': 'Leonardo da Vinci painted the Mona Lisa.',
      },
    },
  ],
  'media search then pick the first one': [
    {
      llm: { 'router.classify': { skill: 'media' } },
      media: {
        messages: [new AIMessage('I found two Dunes. Which one?')],
        pendingContext: {
          type: MediaContextType.MovieDownload,
          data: { results: [1, 2] },
        },
      },
    },
    {
      llm: {},
      media: { messages: [new AIMessage('Downloading Dune (2021).')] },
    },
  ],
  'media search then unrelated question': [
    {
      llm: { 'router.classify': { skill: 'media' } },
      media: {
        messages: [new AIMessage('I found two Dunes. Which one?')],
        pendingContext: {
          type: MediaContextType.MovieDownload,
          data: { results: [1, 2] },
        },
      },
    },
    {
      llm: {
        'router.classify': { skill: 'chat' },
        'chat.respond': 'The capital of France is Paris.',
      },
      media: { messages: [], reroute: true },
    },
  ],
  'image request returns an image': [
    {
      llm: {
        'router.classify': { skill: 'image' },
        'image.extractQueries': [
          { query: 'a cat wearing a top hat', title: 'top hat cat' },
        ],
        'image.respond': 'Here is your dapper cat!',
      },
    },
  ],
}

function ai(content: string, id = 'ai-id'): AIMessage {
  return new AIMessage({ id, content })
}

describe('LLMOrchestrationService - Integration', () => {
  /** The checkpointed state values for a channel's thread. */
  async function checkpoint(
    channelId: string,
    guildId?: string,
  ): Promise<Record<string, unknown>> {
    const tuple = await checkpointer.getTuple({
      configurable: { thread_id: threadIdFor({ channelId, guildId }) },
    })
    return tuple?.checkpoint.channel_values ?? {}
  }

  async function history(channelId: string): Promise<BaseMessage[]> {
    return ((await checkpoint(channelId)).messages as BaseMessage[]) ?? []
  }

  /** The skill the router picked for the latest turn. */
  function lastSkill(): string | undefined {
    return metrics.intentDetected.mock.calls.at(-1)?.[0]
  }

  let module: TestingModule
  let service: LLMOrchestrationService
  let checkpointer: MemorySaver
  let llm: FakeLlmClient
  let metrics: jest.Mocked<TdrBotMetricsService>
  let equationImageService: jest.Mocked<EquationImageService>
  let mediaRequestHandler: jest.Mocked<MediaRequestHandler>
  let reminderService: jest.Mocked<ReminderService>
  let settings: { get: jest.Mock }

  beforeEach(async () => {
    jest.clearAllMocks()

    mockTools.length = 0
    checkpointer = new MemorySaver()
    llm = new FakeLlmClient()
    metrics = createMockMetricsService()

    settings = {
      get: jest.fn().mockReturnValue({
        ...defaultSettings(),
        systemPrompt: 'You are TDR, a kawaii Discord bot.',
      }),
    }

    equationImageService = {
      getImage: jest.fn().mockResolvedValue({
        url: 'https://example.com/eq.png',
        bucket: 'test',
        file: 'eq.png',
      }),
    } as unknown as jest.Mocked<EquationImageService>

    mediaRequestHandler = {
      handleRequest: jest.fn().mockResolvedValue({
        messages: [ai('Found the movie Inception.')],
        images: [],
      }),
    } as unknown as jest.Mocked<MediaRequestHandler>

    reminderService = {
      create: jest.fn().mockImplementation(async input => ({
        ...input,
        scheduledAt: input.scheduledAt ?? null,
      })),
      listForUser: jest.fn().mockResolvedValue([]),
      cancel: jest.fn(),
    } as unknown as jest.Mocked<ReminderService>

    module = await Test.createTestingModule({
      providers: [
        LLMOrchestrationService,
        PromptService,
        SkillRegistry,
        ChatSkill,
        MathSkill,
        ImageSkill,
        MediaSkill,
        ReminderSkill,
        {
          provide: SKILLS,
          useFactory: (...skills: unknown[]) => skills,
          inject: [ChatSkill, MathSkill, ImageSkill, MediaSkill, ReminderSkill],
        },
        { provide: GRAPH_CHECKPOINTER, useValue: checkpointer },
        { provide: EquationImageService, useValue: equationImageService },
        { provide: MediaRequestHandler, useValue: mediaRequestHandler },
        { provide: ReminderService, useValue: reminderService },
        { provide: LlmClient, useValue: llm },
        { provide: LlmMetricsService, useValue: { routerDecision: jest.fn() } },
        { provide: SettingsService, useValue: settings },
        { provide: TdrBotMetricsService, useValue: metrics },
      ],
    }).compile()

    // Trigger onModuleInit so the real LangGraph StateGraph is compiled.
    await module.init()

    service = module.get(LLMOrchestrationService)
  })

  afterEach(async () => {
    await module?.close()
  })

  describe('chat skill', () => {
    it(
      'routes through the classifier to chat and returns content',
      async () => {
        llm
          .script('router.classify', { skill: 'chat' })
          .script('chat.respond', 'Hello! How can I help you?')

        const result = await service.sendMessage({
          message: 'Hello!',
          user: 'Alice',
          userId: 'u-1',
          channelId: 'chan-1',
        })

        expect(result.content).toBe('Hello! How can I help you?')
        expect(result.images ?? []).toEqual([])
        expect(lastSkill()).toBe('chat')
        expect(metrics.llmRequest).toHaveBeenCalledWith('chat', 'success')
      },
      TEST_TIMEOUT,
    )

    it(
      'a second turn in the same channel sees the first turn',
      async () => {
        let seen: string[] = []
        llm.script('router.classify', { skill: 'chat' })
        llm.script('chat.respond', call => {
          seen = call.messages.map(m => String(m.content))
          return seen.includes('What is my name?')
            ? 'Your name is Bob.'
            : 'Nice to meet you!'
        })

        await service.sendMessage({
          message: 'My name is Bob',
          user: 'Bob',
          userId: 'u-2',
          channelId: 'chan-1',
        })
        const result2 = await service.sendMessage({
          message: 'What is my name?',
          user: 'Bob',
          userId: 'u-2',
          channelId: 'chan-1',
        })

        expect(result2.content).toBe('Your name is Bob.')
        expect(seen).toEqual([
          expect.stringContaining('TDR'),
          'My name is Bob',
          'Nice to meet you!',
          'What is my name?',
        ])
      },
      TEST_TIMEOUT,
    )

    it(
      'does not share history between channels',
      async () => {
        const seenByChannel: Record<string, string[]> = {}
        llm.script('router.classify', { skill: 'chat' })
        llm.script('chat.respond', call => {
          const texts = call.messages.map(m => String(m.content))
          const channel = texts.includes('hello chan-a') ? 'chan-a' : 'chan-b'
          seenByChannel[channel] = texts
          return `reply in ${channel}`
        })

        for (const channelId of ['chan-a', 'chan-b']) {
          await service.sendMessage({
            message: `hello ${channelId}`,
            user: 'Alice',
            userId: 'u-1',
            channelId,
          })
        }

        expect(seenByChannel['chan-b']).toContain('hello chan-b')
        expect(seenByChannel['chan-b']).not.toContain('hello chan-a')
        expect(seenByChannel['chan-b']).not.toContain('reply in chan-a')
      },
      TEST_TIMEOUT,
    )

    it(
      'serialises concurrent turns in one channel so both land in order',
      async () => {
        let releaseFirst!: () => void
        const firstGate = new Promise<void>(resolve => {
          releaseFirst = resolve
        })
        let secondSaw: string[] = []
        llm.script('router.classify', { skill: 'chat' })
        llm.script('chat.respond', async call => {
          const texts = call.messages.map(m => String(m.content))
          if (texts.includes('second')) {
            secondSaw = texts
            return 'reply two'
          }
          await firstGate
          return 'reply one'
        })

        const first = service.sendMessage({
          message: 'first',
          user: 'Alice',
          userId: 'u-1',
          channelId: 'chan-1',
        })
        const second = service.sendMessage({
          message: 'second',
          user: 'Bob',
          userId: 'u-2',
          channelId: 'chan-1',
        })
        // Let the second turn queue behind the first, then release the first.
        await new Promise(resolve => setTimeout(resolve, 20))
        releaseFirst()
        const [r1, r2] = await Promise.all([first, second])

        expect(r1.content).toBe('reply one')
        expect(r2.content).toBe('reply two')
        expect(secondSaw.slice(1)).toEqual(['first', 'reply one', 'second'])
        expect((await history('chan-1')).map(m => String(m.content))).toEqual([
          'first',
          'reply one',
          'second',
          'reply two',
        ])
      },
      TEST_TIMEOUT,
    )

    it(
      'stamps the human message with the Discord display name',
      async () => {
        llm
          .script('router.classify', { skill: 'chat' })
          .script('chat.respond', 'hey')

        await service.sendMessage({
          message: 'hello there',
          user: 'Alice Display',
          userId: 'u-1',
          channelId: 'chan-1',
        })

        const humans = (await history('chan-1')).filter(
          m => m instanceof HumanMessage,
        )
        expect(humans).toHaveLength(1)
        expect(humans[0].content).toBe('hello there')
        expect(humans[0].name).toBe('Alice_Display')
        expect(humans[0].additional_kwargs.displayName).toBe('Alice Display')
      },
      TEST_TIMEOUT,
    )

    it(
      'completes a tool-call round trip',
      async () => {
        mockTools.push(
          tool(async ({ q }: { q: string }) => `result for ${q}`, {
            name: 'lookup',
            description: 'Looks something up',
            schema: z.object({ q: z.string() }),
          }),
        )
        const toolCall = new AIMessage({
          id: 'ai-tool',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'lookup',
              args: { q: 'cats' },
              type: 'tool_call',
            },
          ],
        })
        const responses = [toolCall, ai('Cats are great.', 'ai-final')]
        llm.script('router.classify', { skill: 'chat' })
        llm.script('chat.respond', () => responses.shift() as AIMessage)

        const result = await service.sendMessage({
          message: 'tell me about cats',
          user: 'Alice',
          userId: 'u-1',
          channelId: 'chan-1',
        })

        expect(result.content).toBe('Cats are great.')
        const toolMessage = (await history('chan-1')).find(
          m => m instanceof ToolMessage,
        )
        expect(toolMessage?.content).toBe('result for cats')
      },
      TEST_TIMEOUT,
    )
  })

  describe('failures', () => {
    it(
      'records an error metric under the skill label and rethrows',
      async () => {
        llm
          .script('router.classify', { skill: 'chat' })
          .script('chat.respond', new Error('model down'))

        await expect(
          service.sendMessage({
            message: 'hello',
            user: 'Alice',
            userId: 'u-1',
            channelId: 'chan-1',
          }),
        ).rejects.toThrow('model down')

        expect(metrics.llmRequest).toHaveBeenCalledWith('unknown', 'error')
        expect(metrics.observeLlmDuration).toHaveBeenCalledWith(
          'unknown',
          expect.any(Number),
        )
      },
      TEST_TIMEOUT,
    )
  })

  describe('math skill', () => {
    it(
      'renders the equation image and returns the chat reply',
      async () => {
        llm
          .script('router.classify', { skill: 'math' })
          .script('math.latex', '2 + 2 = 4')
          .script('math.respond', ai('The answer is 4.', 'chat-id'))

        const result = await service.sendMessage({
          message: 'What is 2 + 2?',
          user: 'Eve',
          userId: 'u-5',
          channelId: 'chan-1',
        })

        expect(lastSkill()).toBe('math')
        expect(result.content).toBe('The answer is 4.')
        expect(equationImageService.getImage).toHaveBeenCalledWith('2 + 2 = 4')
        expect(result.images).toEqual([
          {
            title: 'the solution',
            url: 'https://example.com/eq.png',
            parentId: 'chat-id',
          },
        ])
      },
      TEST_TIMEOUT,
    )
  })

  describe('image skill', () => {
    it(
      'generates images and records the success metric',
      async () => {
        llm
          .script('router.classify', { skill: 'image' })
          .script('image.extractQueries', [{ query: 'a fox', title: 'fox' }])
          .script('image.respond', 'Here is a fox')
          .scriptImage('https://example.com/fox.png')

        const result = await service.sendMessage({
          message: 'make a picture of a fox',
          user: 'Ivan',
          userId: 'u-9',
          channelId: 'chan-1',
        })

        expect(lastSkill()).toBe('image')
        expect(result.content).toBe('Here is a fox')
        expect(result.images).toEqual([
          expect.objectContaining({
            title: 'fox',
            url: 'https://example.com/fox.png',
          }),
        ])
        expect(metrics.imageGeneration).toHaveBeenCalledWith('success')
      },
      TEST_TIMEOUT,
    )
  })

  describe('media skill', () => {
    it(
      'takes the fast path for a download request and skips the classifier',
      async () => {
        mediaRequestHandler.handleRequest.mockResolvedValue({
          messages: [ai('Downloading Inception now.')],
          images: [],
        })

        const result = await service.sendMessage({
          message: 'download the movie Inception',
          user: 'Charlie',
          userId: 'u-3',
          channelId: 'chan-1',
        })

        expect(llm.calls.map(c => c.operation)).not.toContain('router.classify')
        expect(mediaRequestHandler.handleRequest).toHaveBeenCalled()
        expect(lastSkill()).toBe('media')
        expect(result.content).toBe('Downloading Inception now.')
      },
      TEST_TIMEOUT,
    )
  })

  describe('reminder skill', () => {
    it(
      'creates a reminder and returns the confirmation',
      async () => {
        llm
          .script('reminder.extract', {
            ...REMINDER_EXTRACTION,
            what: 'pay rent',
            day: 'tomorrow',
            time: '9:00 AM',
            scheduledAt: '2026-03-19T09:00:00',
          })
          .script('reminder.confirm', 'Got it! Reminder set for tomorrow.')

        const result = await service.sendMessage({
          message: 'remind me to pay rent tomorrow at 9am',
          user: 'Judy',
          userId: 'u-10',
          guildId: 'guild-1',
          channelId: 'chan-1',
        })

        expect(lastSkill()).toBe('reminder')
        expect(result.content).toBe('Got it! Reminder set for tomorrow.')
        expect(reminderService.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'u-10',
            guildId: 'guild-1',
            what: 'pay rent',
          }),
        )
      },
      TEST_TIMEOUT,
    )
  })

  describe('system prompt', () => {
    it(
      'is given to the skill once, fresh each turn, and not checkpointed',
      async () => {
        let captured: BaseMessage[] = []
        llm.script('router.classify', { skill: 'chat' })
        llm.script('chat.respond', call => {
          captured = call.messages
          return 'response'
        })

        await service.sendMessage({
          message: 'hi',
          user: 'Heidi',
          userId: 'u-8',
          channelId: 'chan-1',
        })
        settings.get.mockReturnValue({
          ...defaultSettings(),
          systemPrompt: 'You are TDR, now extra formal.',
        })
        await service.sendMessage({
          message: 'follow-up',
          user: 'Heidi',
          userId: 'u-8',
          channelId: 'chan-1',
        })

        const prompts = captured.filter(m => m.id === TDR_SYSTEM_PROMPT_ID)
        expect(prompts).toHaveLength(1)
        expect(String(prompts[0].content)).toContain('now extra formal')
        expect(String(prompts[0].content)).not.toContain('kawaii')
        expect(
          (await history('chan-1')).some(m => m.id === TDR_SYSTEM_PROMPT_ID),
        ).toBe(false)
      },
      TEST_TIMEOUT,
    )
  })

  describe('golden SCENARIOS replayed end to end', () => {
    it('has a script for every scenario', () => {
      expect(Object.keys(SCENARIO_SCRIPTS).sort()).toEqual(
        SCENARIOS.map(s => s.name).sort(),
      )
    })

    it.each(SCENARIOS.map(s => [s.name, s] as const))(
      '%s',
      async (_name, scenario) => {
        const scripts = SCENARIO_SCRIPTS[scenario.name]
        llm.scriptImage('https://example.com/image.png')
        expect(scripts).toHaveLength(scenario.turns.length)

        for (const [index, turn] of scenario.turns.entries()) {
          const script = scripts[index]
          for (const [operation, response] of Object.entries(script.llm)) {
            llm.script(operation, response)
          }
          if (script.media) {
            mediaRequestHandler.handleRequest.mockResolvedValueOnce({
              images: [],
              ...script.media,
            })
          }

          const result = await service.sendMessage({
            message: turn.input,
            user: 'Tester',
            userId: 'u-1',
            guildId: 'guild-1',
            channelId: 'chan-1',
          })

          const { skill, followUp, images, contains } = turn.expect
          if (skill !== undefined) expect(lastSkill()).toBe(skill)
          if (followUp !== undefined) {
            const pending = (await checkpoint('chan-1', 'guild-1'))
              .pendingFollowUp
            expect(!!pending).toBe(followUp)
          }
          if (images !== undefined) expect(result.images).toHaveLength(images)
          if (contains !== undefined) {
            expect(result.content.toLowerCase()).toContain(
              contains.toLowerCase(),
            )
          }
        }
      },
      TEST_TIMEOUT,
    )
  })
})
