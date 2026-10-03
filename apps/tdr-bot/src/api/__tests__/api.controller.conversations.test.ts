import { SystemMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'
import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'discord.js'

import { createMockMetricsService } from 'src/__tests__/test-utils'
import { ApiController } from 'src/api/api.controller'
import { LlmClient } from 'src/llm/client/llm-client'
import { GRAPH_CHECKPOINTER } from 'src/llm/graph/checkpointer'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { SettingsService } from 'src/llm/settings/settings.service'
import { ChatSkill } from 'src/llm/skills/chat/skill'
import { SKILLS } from 'src/llm/skills/skill.interface'
import { SkillRegistry } from 'src/llm/skills/skill.registry'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { EquationImageService } from 'src/services/equation-image.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

jest.mock('src/messages/llm/tools', () => ({ getTools: jest.fn(() => []) }))

describe('ApiController GET /conversations/:channelId', () => {
  let app: INestApplication
  let base: string
  let llm: LLMOrchestrationService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        LLMOrchestrationService,
        { provide: GRAPH_CHECKPOINTER, useValue: new MemorySaver() },
        {
          provide: PromptService,
          useValue: {
            getSystemPrompt: jest
              .fn()
              .mockReturnValue(
                new SystemMessage({ id: TDR_SYSTEM_PROMPT_ID, content: 'sys' }),
              ),
          },
        },
        { provide: SKILLS, useValue: [new ChatSkill()] },
        SkillRegistry,
        {
          provide: LlmClient,
          useValue: new FakeLlmClient()
            .script('router.classify', { skill: 'chat' })
            .script('chat.respond', 'hi there'),
        },
        {
          provide: LlmMetricsService,
          useValue: { routerDecision: jest.fn() },
        },
        { provide: TdrBotMetricsService, useValue: createMockMetricsService() },
        { provide: ModelRegistry, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: EquationImageService, useValue: {} },
        { provide: Client, useValue: {} },
      ],
    }).compile()
    app = module.createNestApplication({ logger: false })
    await app.init()
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
    llm = module.get(LLMOrchestrationService)
  })

  afterEach(async () => {
    await app.close()
  })

  it('returns an empty array for an unknown channel', async () => {
    const res = await fetch(`${base}/conversations/nope`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns the checkpointed messages for a seeded thread', async () => {
    await llm.sendMessage({
      message: 'hello',
      user: 'tester',
      channelId: 'chan-1',
    })

    const res = await fetch(`${base}/conversations/chan-1`)
    const json = (await res.json()) as Array<Record<string, unknown>>

    expect(res.status).toBe(200)
    expect(json.map(m => [m.type, m.content])).toEqual(
      expect.arrayContaining([['ai', 'hi there']]),
    )
    expect(json.some(m => m.type === 'human')).toBe(true)

    const other = await fetch(`${base}/conversations/chan-2`)
    expect(await other.json()).toEqual([])
  })
})
