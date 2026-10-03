import { AIMessage, HumanMessage } from '@langchain/core/messages'

import { MessageUtils } from 'src/messages/utils/message-utils'

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
