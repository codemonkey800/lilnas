import { HumanMessage } from '@langchain/core/messages'
import { Logger } from '@nestjs/common'

import { ImageSkill } from 'src/llm/skills/image/skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

jest.mock('src/messages/llm/tools', () => ({ getTools: () => [] }))

const input = (): SkillInput => ({
  message: new HumanMessage('draw a cat and a dog'),
  history: [],
  userId: 'u',
  channelId: 'c',
  guildId: 'g',
  discord: {} as SkillInput['discord'],
})

describe('ImageSkill', () => {
  const metrics = { imageGeneration: jest.fn() }
  const skill = () => new ImageSkill(metrics as unknown as TdrBotMetricsService)
  const ctx = (llm: FakeLlmClient) => ({ llm, logger: new Logger('test') })

  beforeEach(() => metrics.imageGeneration.mockClear())

  it('generates an image per query and replies', async () => {
    const llm = new FakeLlmClient()
      .script('image.extractQueries', [
        { title: 'Cat', query: 'a cat' },
        { title: 'Dog', query: 'a dog' },
      ])
      .script('image.respond', 'Here they are')
      .scriptImage('https://img/1.png')

    const result = await skill().run(input(), ctx(llm))

    expect(llm.imageCalls.map(c => c.prompt)).toEqual(['a cat', 'a dog'])
    expect(result.images).toEqual([
      {
        title: 'Cat',
        url: 'https://img/1.png',
        parentId: result.messages[1].id,
      },
      {
        title: 'Dog',
        url: 'https://img/1.png',
        parentId: result.messages[1].id,
      },
    ])
    expect(metrics.imageGeneration).toHaveBeenCalledWith('success')
  })

  it('apologises and records an error when generation fails', async () => {
    const llm = new FakeLlmClient()
      .script('image.extractQueries', [{ title: 'Cat', query: 'a cat' }])
      .script('image.respond', 'unused')
    // no image scripted: generateImage throws

    const result = await skill().run(input(), ctx(llm))

    expect(result.images).toEqual([])
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].content).toMatch(/couldn't generate the image/)
    expect(metrics.imageGeneration).toHaveBeenCalledWith('error')
    expect(metrics.imageGeneration).not.toHaveBeenCalledWith('success')
  })
})
