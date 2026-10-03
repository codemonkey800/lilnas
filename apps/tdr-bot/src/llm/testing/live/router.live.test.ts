import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { trimConversation } from 'src/llm/conversation/trim'
import { buildGraph } from 'src/llm/graph/build-graph'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { CHAT_SKILL_DESCRIPTION } from 'src/llm/skills/chat/prompts'
import { IMAGE_SKILL_DESCRIPTION } from 'src/llm/skills/image/prompts'
import { MATH_SKILL_DESCRIPTION } from 'src/llm/skills/math/prompts'
import { MediaSkill } from 'src/llm/skills/media.skill'
import { ReminderSkill } from 'src/llm/skills/reminder.skill'
import { Skill } from 'src/llm/skills/skill.interface'
import { SkillRegistry } from 'src/llm/skills/skill.registry'
import { ROUTER_CASES } from 'src/llm/testing/golden/router-cases'

import { describeLive, LiveLlm, MAX_RUN_COST_USD, recordCost } from './live-env'

const MIN_ACCURACY = 0.9

// Real ids and descriptions, but no fast-path `match`, so every case reaches
// the router LLM; each skill just echoes its id.
function stub(id: string, description: string): Skill {
  return {
    id,
    description,
    run: () => Promise.resolve({ messages: [new AIMessage(id)] }),
  }
}

const skills: Skill[] = [
  stub('chat', CHAT_SKILL_DESCRIPTION),
  stub('math', MATH_SKILL_DESCRIPTION),
  stub('image', IMAGE_SKILL_DESCRIPTION),
  stub('media', new MediaSkill(null as never).description),
  stub('reminder', new ReminderSkill(null as never).description),
]

describeLive('live router', () => {
  const live = new LiveLlm()
  const graph = buildGraph({
    registry: new SkillRegistry(skills),
    llm: live.client,
    metrics: new LlmMetricsService(),
    trim: trimConversation,
    systemPrompt: () => new SystemMessage('You are a helpful assistant.'),
    checkpointer: new MemorySaver(),
  })

  afterAll(() => {
    const total = recordCost('router', live.costUsd)
    expect(total).toBeLessThanOrEqual(MAX_RUN_COST_USD)
  })

  it('routes the golden cases with at least 90% accuracy', async () => {
    const misses: string[] = []
    let correct = 0
    for (const [i, c] of ROUTER_CASES.entries()) {
      const out = await graph.invoke(
        {
          messages: [new HumanMessage(c.input)],
          userId: 'live-user',
          channelId: `live-channel-${i}`,
          guildId: 'live-guild',
          discord: { userId: 'live-user', username: 'live' },
        },
        { configurable: { thread_id: `live-router-${i}` } },
      )
      if (out.skill === c.expected) correct++
      else misses.push(`"${c.input}": expected ${c.expected}, got ${out.skill}`)
    }
    const accuracy = correct / ROUTER_CASES.length

    console.log(
      `[live] router accuracy ${(accuracy * 100).toFixed(1)}% (${correct}/${ROUTER_CASES.length})${misses.length ? `\n${misses.join('\n')}` : ''}`,
    )
    expect(accuracy).toBeGreaterThanOrEqual(MIN_ACCURACY)
  }, 600_000)
})
