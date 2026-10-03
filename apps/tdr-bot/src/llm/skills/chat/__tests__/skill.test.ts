import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { Logger } from '@nestjs/common'

import { ChatSkill, MAX_TOOL_ROUNDS } from 'src/llm/skills/chat/skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { getTools } from 'src/messages/llm/tools'

jest.mock('src/messages/llm/tools', () => ({ getTools: jest.fn() }))

const input = (): SkillInput => ({
  message: new HumanMessage('what time is it?'),
  history: [],
  userId: 'u',
  channelId: 'c',
  guildId: 'g',
  discord: {} as SkillInput['discord'],
})

const toolCallMessage = (id: string) =>
  new AIMessage({
    content: '',
    tool_calls: [
      { id, name: 'fake_tool', args: { q: 'x' }, type: 'tool_call' },
    ],
  })

describe('ChatSkill', () => {
  const fakeTool = tool(({ q }: { q: string }) => `result:${q}`, {
    name: 'fake_tool',
    description: 'fake',
    schema: (jest.requireActual('zod') as typeof import('zod')).z.object({
      q: (jest.requireActual('zod') as typeof import('zod')).z.string(),
    }),
  })
  const ctx = (llm: FakeLlmClient) => ({ llm, logger: new Logger('test') })

  beforeEach(() => {
    jest.mocked(getTools).mockReturnValue([fakeTool])
  })

  it('answers directly when the model calls no tools', async () => {
    const llm = new FakeLlmClient().script('chat.respond', 'hello')
    const result = await new ChatSkill().run(input(), ctx(llm))

    expect(result.messages).toHaveLength(2)
    expect(result.messages[1].content).toBe('hello')
    expect(llm.calls[0].tools).toEqual([fakeTool])
  })

  it('runs tool calls and feeds the results back', async () => {
    let n = 0
    const llm = new FakeLlmClient().script('chat.respond', () =>
      n++ === 0 ? toolCallMessage('call-1') : new AIMessage('it is noon'),
    )
    const result = await new ChatSkill().run(input(), ctx(llm))

    expect(result.messages.map(m => m.getType())).toEqual([
      'human',
      'ai',
      'tool',
      'ai',
    ])
    const toolMessage = result.messages[2] as ToolMessage
    expect(toolMessage.content).toBe('result:x')
    expect(toolMessage.tool_call_id).toBe('call-1')
    expect(llm.calls[1].messages).toContain(toolMessage)
  })

  it('turns a failing or unknown tool into an error ToolMessage', async () => {
    let n = 0
    const llm = new FakeLlmClient().script('chat.respond', () =>
      n++ === 0
        ? new AIMessage({
            content: '',
            tool_calls: [
              { id: 'c1', name: 'missing', args: {}, type: 'tool_call' },
            ],
          })
        : new AIMessage('done'),
    )
    const result = await new ChatSkill().run(input(), ctx(llm))

    expect((result.messages[2] as ToolMessage).status).toBe('error')
  })

  it('stops after the maximum rounds and asks for a plain answer', async () => {
    const llm = new FakeLlmClient().script('chat.respond', call =>
      call.tools ? toolCallMessage('loop') : new AIMessage('giving up'),
    )
    const result = await new ChatSkill().run(input(), ctx(llm))

    expect(llm.calls).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(llm.calls[MAX_TOOL_ROUNDS].tools).toBeUndefined()
    expect(result.messages.at(-1)?.content).toBe('giving up')
  })
})
