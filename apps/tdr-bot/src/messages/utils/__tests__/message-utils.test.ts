import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'

import { MessageUtils } from 'src/messages/utils/message-utils'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

function makeSystemPrompt() {
  return new SystemMessage({ id: TDR_SYSTEM_PROMPT_ID, content: 'System' })
}

function makeHuman(content = 'hello', id?: string) {
  return new HumanMessage({ id, content })
}

function makeAI(content = 'response', id?: string) {
  return new AIMessage({ id, content })
}

function makeAIWithToolCalls() {
  const msg = new AIMessage({ content: '' })
  ;(msg as AIMessage & { tool_calls: unknown[] }).tool_calls = [
    { id: 'call_1', name: 'get_date', args: {}, type: 'tool_call' },
  ]
  return msg
}

describe('MessageUtils', () => {
  describe('trimMessages', () => {
    it('returns empty array for empty input', () => {
      expect(MessageUtils.trimMessages([], 50)).toEqual([])
    })

    it('returns empty array when maxMessageCount is 0 (slice(-0) edge case)', () => {
      const messages = [makeHuman('a'), makeAI('b'), makeHuman('c')]
      expect(MessageUtils.trimMessages(messages, 0)).toEqual([])
    })

    it('keeps all messages when count is within limit', () => {
      const messages = [makeHuman('a'), makeAI('b')]
      const result = MessageUtils.trimMessages(messages, 50)
      expect(result).toHaveLength(2)
    })

    it('trims to last N non-system messages', () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeHuman(`msg-${i}`),
      )
      const result = MessageUtils.trimMessages(messages, 5)
      expect(result).toHaveLength(5)
      expect((result[0] as HumanMessage).content).toBe('msg-5')
      expect((result[4] as HumanMessage).content).toBe('msg-9')
    })

    it('preserves system prompt when trimming', () => {
      const sysPrompt = makeSystemPrompt()
      const messages = [
        sysPrompt,
        ...Array.from({ length: 10 }, (_, i) => makeHuman(`msg-${i}`)),
      ]
      const result = MessageUtils.trimMessages(messages, 5)
      expect(result).toHaveLength(6)
      expect(result[0].id).toBe(TDR_SYSTEM_PROMPT_ID)
      expect((result[1] as HumanMessage).content).toBe('msg-5')
      expect((result[5] as HumanMessage).content).toBe('msg-9')
    })

    it('trims correctly when system prompt is in the middle', () => {
      const sysPrompt = makeSystemPrompt()
      const messages = [
        makeHuman('before-sys'),
        sysPrompt,
        makeHuman('after-sys-1'),
        makeHuman('after-sys-2'),
      ]
      const result = MessageUtils.trimMessages(messages, 2)
      expect(result[0].id).toBe(TDR_SYSTEM_PROMPT_ID)
      const nonSys = result.filter(m => m.id !== TDR_SYSTEM_PROMPT_ID)
      expect(nonSys).toHaveLength(2)
      expect((nonSys[0] as HumanMessage).content).toBe('after-sys-1')
      expect((nonSys[1] as HumanMessage).content).toBe('after-sys-2')
    })

    it('returns messages as-is when no system prompt and count within limit', () => {
      const messages = [makeHuman('a'), makeAI('b')]
      const result = MessageUtils.trimMessages(messages, 10)
      expect(result).toEqual(messages)
    })

    it('uses default maxMessageCount of 50', () => {
      const messages = Array.from({ length: 60 }, (_, i) =>
        makeHuman(`msg-${i}`),
      )
      const result = MessageUtils.trimMessages(messages)
      expect(result).toHaveLength(50)
    })
  })

  describe('isToolsMessage', () => {
    it('returns false for a plain AI message', () => {
      expect(MessageUtils.isToolsMessage(makeAI())).toBe(false)
    })

    it('returns false for a human message', () => {
      expect(MessageUtils.isToolsMessage(makeHuman())).toBe(false)
    })

    it('returns true for an AI message with tool calls', () => {
      expect(MessageUtils.isToolsMessage(makeAIWithToolCalls())).toBe(true)
    })
  })
})
