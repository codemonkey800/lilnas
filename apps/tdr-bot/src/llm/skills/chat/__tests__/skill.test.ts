import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { Logger } from '@nestjs/common'

import { ChatSkill, MAX_TOOL_ROUNDS } from 'src/llm/skills/chat/skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { LlmTools } from 'src/llm/tools/tools'
import { PromptService } from 'src/messages/prompts/prompt.service'

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
  let styleNote: SystemMessage | null
  let tools: LlmTools
  const skill = () =>
    new ChatSkill(
      { getStyleNote: () => styleNote } as unknown as PromptService,
      tools,
    )

  beforeEach(() => {
    tools = { all: [fakeTool] }
    styleNote = null
  })

  it('answers directly when the model calls no tools', async () => {
    const llm = new FakeLlmClient().script('chat.respond', 'hello')
    const result = await skill().run(input(), ctx(llm))

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toBe('hello')
    // The human message is sent to the model but not returned.
    expect(llm.calls[0].messages.at(-1)?.content).toBe('what time is it?')
    expect(llm.calls[0].tools).toEqual([fakeTool])
  })

  it('runs tool calls and feeds the results back', async () => {
    let n = 0
    const llm = new FakeLlmClient().script('chat.respond', () =>
      n++ === 0 ? toolCallMessage('call-1') : new AIMessage('it is noon'),
    )
    const result = await skill().run(input(), ctx(llm))

    expect(result.messages.map(m => m.getType())).toEqual(['ai', 'tool', 'ai'])
    const toolMessage = result.messages[1] as ToolMessage
    expect(toolMessage.content).toBe('result:x')
    expect(toolMessage.tool_call_id).toBe('call-1')
    expect(llm.calls[1].messages).toContain(toolMessage)
  })

  it('runs one round of tool calls in parallel and keeps their order', async () => {
    const order: string[] = []
    const slowTool = tool(
      async () => {
        await new Promise(resolve => setTimeout(resolve, 20))
        order.push('slow')
        return 'slow result'
      },
      { name: 'slow_tool', description: 'slow' },
    )
    const fastTool = tool(
      () => {
        order.push('fast')
        return { answer: 42 }
      },
      { name: 'fast_tool', description: 'fast' },
    )
    tools = { all: [slowTool, fastTool] }
    let n = 0
    const llm = new FakeLlmClient().script('chat.respond', () =>
      n++ === 0
        ? new AIMessage({
            content: '',
            tool_calls: [
              { id: 's', name: 'slow_tool', args: {}, type: 'tool_call' },
              { id: 'f', name: 'fast_tool', args: {}, type: 'tool_call' },
            ],
          })
        : new AIMessage('done'),
    )
    const result = await skill().run(input(), ctx(llm))

    // Both started before either finished, but results keep call order.
    expect(order).toEqual(['fast', 'slow'])
    const toolMessages = result.messages.filter(ToolMessage.isInstance)
    expect(toolMessages.map(m => m.tool_call_id)).toEqual(['s', 'f'])
    expect(toolMessages.map(m => m.content)).toEqual([
      'slow result',
      '{"answer":42}',
    ])
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
    const result = await skill().run(input(), ctx(llm))

    expect((result.messages[1] as ToolMessage).status).toBe('error')
  })

  it('stops after the maximum rounds and asks for a plain answer', async () => {
    const llm = new FakeLlmClient().script('chat.respond', call =>
      call.tools ? toolCallMessage('loop') : new AIMessage('giving up'),
    )
    const result = await skill().run(input(), ctx(llm))

    expect(llm.calls).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(llm.calls[MAX_TOOL_ROUNDS].tools).toBeUndefined()
    expect(result.messages.at(-1)?.content).toBe('giving up')
  })

  it('sends the style note after the history on every round but never returns it', async () => {
    styleNote = new SystemMessage('Style for this reply: be cute.')
    const history = [new HumanMessage('earlier'), new AIMessage('hi')]
    let n = 0
    const llm = new FakeLlmClient().script('chat.respond', () =>
      n++ === 0 ? toolCallMessage('call-1') : new AIMessage('done'),
    )
    const result = await skill().run({ ...input(), history }, ctx(llm))

    for (const call of llm.calls) {
      expect(call.messages.slice(0, 4)).toEqual([
        ...history,
        styleNote,
        expect.any(HumanMessage),
      ])
    }
    expect(result.messages).not.toContain(styleNote)
  })
})
