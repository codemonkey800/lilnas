import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages'

import {
  DEFAULT_TRIM_TOKENS,
  trimConversation,
} from 'src/llm/conversation/trim'

// One token per message keeps the budgets in these tests easy to reason about.
const perMessage = (m: unknown[]) => m.length

describe('trimConversation', () => {
  const system = new SystemMessage({ content: 'be nice', id: 'sys' })

  it('returns an empty list for no messages', async () => {
    expect(await trimConversation([], { maxTokens: 100 })).toEqual([])
  })

  it('leaves messages under budget unchanged', async () => {
    const messages = [system, new HumanMessage('hi'), new AIMessage('hello')]
    expect(await trimConversation(messages, { maxTokens: 1000 })).toEqual(
      messages,
    )
    expect(DEFAULT_TRIM_TOKENS).toBe(24_000)
  })

  it('keeps the system prompt and the most recent turns', async () => {
    const messages = [
      system,
      new HumanMessage('one'),
      new AIMessage('a1'),
      new HumanMessage('two'),
      new AIMessage('a2'),
    ]
    const result = await trimConversation(messages, {
      maxTokens: 3,
      tokenCounter: perMessage,
    })
    expect(result).toEqual([system, messages[3], messages[4]])
  })

  it('keeps only the system prompt with a budget of 0', async () => {
    const result = await trimConversation(
      [system, new HumanMessage('hi'), new AIMessage('yo')],
      { maxTokens: 0 },
    )
    expect(result).toEqual([system])
  })

  it('moves the cut earlier rather than splitting a tool call from its result', async () => {
    const human = new HumanMessage('search it')
    const call = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'search', args: {} }],
    })
    const tool = new ToolMessage({ content: 'found', tool_call_id: 'c1' })
    const answer = new AIMessage('here')
    const result = await trimConversation([system, human, call, tool, answer], {
      maxTokens: 3,
      tokenCounter: perMessage,
    })

    // Budget fits system + 2, but the cut would land on the tool result, so it
    // moves earlier to the human turn that started the exchange... which no
    // longer fits, so nothing but the system prompt survives.
    expect(result).toEqual([system])
    expect(result.some(m => ToolMessage.isInstance(m))).toBe(false)
  })

  it('never starts with a tool message or keeps unanswered tool calls', async () => {
    const call = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'search', args: {} }],
    })
    const tool = new ToolMessage({ content: 'found', tool_call_id: 'c1' })
    const human = new HumanMessage('next')
    const result = await trimConversation(
      [new HumanMessage('q'), call, tool, human, new AIMessage('done')],
      { maxTokens: 3, tokenCounter: perMessage },
    )
    expect(result[0]).toEqual(human)
  })

  it('keeps a tool call together with its results when the exchange fits', async () => {
    const human = new HumanMessage('search it')
    const call = new AIMessage({
      content: '',
      tool_calls: [{ id: 'c1', name: 'search', args: {} }],
    })
    const tool = new ToolMessage({ content: 'found', tool_call_id: 'c1' })
    const answer = new AIMessage('here')
    const result = await trimConversation(
      [
        system,
        new HumanMessage('old'),
        new AIMessage('older'),
        human,
        call,
        tool,
        answer,
      ],
      { maxTokens: 5, tokenCounter: perMessage },
    )
    expect(result).toEqual([system, human, call, tool, answer])
  })
})
