import { HumanMessage } from '@langchain/core/messages'
import { Logger } from '@nestjs/common'

import { MathSkill } from 'src/llm/skills/math/skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { EquationImageService } from 'src/services/equation-image.service'

const input = (): SkillInput => ({
  message: new HumanMessage('integrate x^2'),
  history: [],
  userId: 'u',
  channelId: 'c',
  guildId: 'g',
  discord: {} as SkillInput['discord'],
})

describe('MathSkill', () => {
  const llm = () =>
    new FakeLlmClient()
      .script('math.latex', '$$x^3/3$$')
      .script('math.respond', 'The solution is below')
  const run = (client: FakeLlmClient, image: unknown) =>
    new MathSkill({
      getImage: jest.fn().mockResolvedValue(image),
    } as unknown as EquationImageService).run(input(), {
      llm: client,
      logger: new Logger('test'),
    })

  it('renders the LaTeX and attaches the image to the reply', async () => {
    const client = llm()
    const result = await run(client, { url: 'https://img/eq.png' })

    expect(result.messages).toHaveLength(1)
    expect(result.images).toEqual([
      {
        title: 'the solution',
        url: 'https://img/eq.png',
        parentId: result.messages[0].id,
      },
    ])
    expect(client.calls.find(c => c.operation === 'math.latex')?.role).toBe(
      'reasoning',
    )
  })

  it('asks for the chat reply without tools, since it never runs tool calls', async () => {
    const client = llm()
    await run(client, null)

    const respond = client.calls.find(c => c.operation === 'math.respond')
    expect(respond?.tools).toBeUndefined()
  })

  it('omits the image when the equation service returns null', async () => {
    const result = await run(llm(), null)

    expect(result.images).toEqual([])
    expect(result.messages[0].content).toBe('The solution is below')
  })
})
