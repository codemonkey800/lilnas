import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  RemoveMessage,
  ToolMessage,
} from '@langchain/core/messages'

import { MAX_THREAD_MESSAGES, pruneHistory } from 'src/llm/conversation/prune'

const human = (id: string) => new HumanMessage({ id, content: id })
const ai = (id: string) => new AIMessage({ id, content: id })
const toolCall = (id: string, callId: string) =>
  new AIMessage({
    id,
    content: '',
    tool_calls: [{ id: callId, name: 'search', args: {}, type: 'tool_call' }],
  })
const toolResult = (id: string, callId: string) =>
  new ToolMessage({ id, content: 'found', tool_call_id: callId })

const removedIds = (removals: RemoveMessage[]) => removals.map(r => r.id)

/** `turns` human/AI pairs, ids h0/a0, h1/a1, ... */
function conversation(turns: number): BaseMessage[] {
  return Array.from({ length: turns }, (_, i) => [
    human(`h${i}`),
    ai(`a${i}`),
  ]).flat()
}

describe('pruneHistory', () => {
  it('keeps a thread at or under the limit untouched', () => {
    expect(pruneHistory(conversation(2), 4)).toEqual([])
    expect(pruneHistory(conversation(MAX_THREAD_MESSAGES / 2))).toEqual([])
  })

  it('removes the oldest messages past the limit', () => {
    const removals = pruneHistory(conversation(3), 4)

    expect(removals.every(r => RemoveMessage.isInstance(r))).toBe(true)
    expect(removedIds(removals)).toEqual(['h0', 'a0'])
  })

  it('moves the cutoff forward to the next human message', () => {
    // A limit of 3 would start the kept history on a0.
    const removals = pruneHistory(conversation(3), 3)

    expect(removedIds(removals)).toEqual(['h0', 'a0', 'h1', 'a1'])
  })

  it('removes a tool call together with its tool results', () => {
    const messages = [
      human('h0'),
      toolCall('call', 'c1'),
      toolResult('result', 'c1'),
      ai('a0'),
      human('h1'),
      ai('a1'),
    ]

    expect(removedIds(pruneHistory(messages, 3))).toEqual([
      'h0',
      'call',
      'result',
      'a0',
    ])
  })

  it('never keeps a tool result whose call is removed', () => {
    // h1 sits between the call and its result, so cutting there would orphan it.
    const messages = [
      human('h0'),
      toolCall('call', 'c1'),
      human('h1'),
      toolResult('result', 'c1'),
      ai('a1'),
      human('h2'),
      ai('a2'),
    ]

    expect(removedIds(pruneHistory(messages, 5))).toEqual([
      'h0',
      'call',
      'h1',
      'result',
      'a1',
    ])
  })

  it('keeps a single turn longer than the limit whole', () => {
    const messages = [
      human('h0'),
      ai('a0'),
      human('h1'),
      toolCall('call', 'c1'),
      toolResult('result', 'c1'),
      ai('a1'),
    ]

    expect(removedIds(pruneHistory(messages, 2))).toEqual(['h0', 'a0'])
  })

  it('removes nothing when the only human message starts the thread', () => {
    const messages = [
      human('h0'),
      toolCall('call', 'c1'),
      toolResult('r', 'c1'),
    ]

    expect(pruneHistory(messages, 2)).toEqual([])
  })
})
