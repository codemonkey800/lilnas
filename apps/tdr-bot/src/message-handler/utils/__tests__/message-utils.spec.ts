import {
  CONVERSATION_WITH_TOOLS,
  createAIMessage,
  createHumanMessage,
  createSystemMessage,
  createTdrSystemPrompt,
  createToolCall,
  createToolMessage,
  LONG_CONVERSATION,
  SAMPLE_CONVERSATION,
} from 'src/message-handler/__tests__/fixtures/messages.fixture'
import { MessageUtils } from 'src/message-handler/utils/message-utils'

describe('MessageUtils', () => {
  describe('isToolsMessage', () => {
    it('should return true when message has tool_calls array with items', () => {
      const message = createAIMessage('test', [
        createToolCall('search', { query: 'test' }),
      ])
      expect(MessageUtils.isToolsMessage(message)).toBe(true)
    })

    it('should return true when message has multiple tool calls', () => {
      const message = createAIMessage('test', [
        createToolCall('search', { query: 'test' }, 'call-1'),
        createToolCall('calculator', { expression: '2+2' }, 'call-2'),
      ])
      expect(MessageUtils.isToolsMessage(message)).toBe(true)
    })

    it('should return false when message has no tool_calls property', () => {
      const message = createAIMessage('test')
      expect(MessageUtils.isToolsMessage(message)).toBe(false)
    })

    it('should return false when message has empty tool_calls array', () => {
      const message = createAIMessage('test', [])
      expect(MessageUtils.isToolsMessage(message)).toBe(false)
    })

    it('should return false for human messages', () => {
      const message = createHumanMessage('test')
      expect(MessageUtils.isToolsMessage(message)).toBe(false)
    })

    it('should return false for system messages', () => {
      const message = createSystemMessage('test')
      expect(MessageUtils.isToolsMessage(message)).toBe(false)
    })

    it('should return false for tool messages', () => {
      const message = createToolMessage('result', 'tool-call-1')
      expect(MessageUtils.isToolsMessage(message)).toBe(false)
    })
  })

  describe('trimMessages', () => {
    it('should keep system prompt and trim from middle when over limit', () => {
      const result = MessageUtils.trimMessages(LONG_CONVERSATION, 10)

      expect(result.length).toBe(11) // 1 system + 10 others
      expect(result[0].id).toBe('tdr-system-prompt') // System prompt preserved
      // LONG_CONVERSATION has 60 messages total (1 system + 59 others, alternating human/ai starting with human)
      // Last 10 of 59 = indices 49-58 (0-indexed), which corresponds to human-long-49 through ai-long-58
      // But the loop creates: i=58 is even, so it's human-long-58
      expect(result[result.length - 1].id).toBe('human-long-58') // Last message
    })

    it('should keep all messages when under limit', () => {
      const result = MessageUtils.trimMessages(SAMPLE_CONVERSATION, 50)

      expect(result.length).toBe(SAMPLE_CONVERSATION.length)
      expect(result).toEqual(SAMPLE_CONVERSATION)
    })

    it('should handle messages without system prompt', () => {
      const messages = [
        createHumanMessage('msg1', 'h1'),
        createAIMessage('msg2', undefined, 'a1'),
        createHumanMessage('msg3', 'h2'),
        createAIMessage('msg4', undefined, 'a2'),
      ]

      const result = MessageUtils.trimMessages(messages, 2)

      expect(result.length).toBe(2)
      expect(result[0].id).toBe('h2') // Last 2 messages
      expect(result[1].id).toBe('a2')
    })

    it('should default to 50 messages when maxMessageCount not specified', () => {
      const result = MessageUtils.trimMessages(LONG_CONVERSATION)

      // 60 messages total: 1 system + 59 others
      // Should keep system + 50 most recent = 51 total
      expect(result.length).toBe(51)
      expect(result[0].id).toBe('tdr-system-prompt')
    })

    it('should handle empty message array', () => {
      const result = MessageUtils.trimMessages([])

      expect(result).toEqual([])
    })

    it('should handle single message', () => {
      const message = createHumanMessage('test')
      const result = MessageUtils.trimMessages([message], 10)

      expect(result).toEqual([message])
    })

    it('should return only system prompt when maxMessageCount is 0', () => {
      const messages = [
        createTdrSystemPrompt(),
        createHumanMessage('msg1', 'h1'),
        createAIMessage('msg2', undefined, 'a1'),
      ]
      const result = MessageUtils.trimMessages(messages, 0)

      expect(result.length).toBe(1)
      expect(result[0].id).toBe('tdr-system-prompt')
    })
  })

  describe('getToolCallNames', () => {
    it('should return array of tool call names', () => {
      const message = createAIMessage('test', [
        createToolCall('search', { query: 'test' }, 'call-1'),
        createToolCall('calculator', { expression: '2+2' }, 'call-2'),
      ])

      const result = MessageUtils.getToolCallNames(message)

      expect(result).toEqual(['search', 'calculator'])
    })

    it('should return single tool name for single call', () => {
      const message = createAIMessage('test', [
        createToolCall('search', { query: 'test' }),
      ])

      const result = MessageUtils.getToolCallNames(message)

      expect(result).toEqual(['search'])
    })

    it('should return empty array when message has no tool calls', () => {
      const message = createAIMessage('test')

      const result = MessageUtils.getToolCallNames(message)

      expect(result).toEqual([])
    })

    it('should return empty array for human messages', () => {
      const message = createHumanMessage('test')

      const result = MessageUtils.getToolCallNames(message)

      expect(result).toEqual([])
    })

    it('should return empty array when tool_calls is empty array', () => {
      const message = createAIMessage('test', [])

      const result = MessageUtils.getToolCallNames(message)

      expect(result).toEqual([])
    })
  })

  describe('countMessagesByType', () => {
    it('should count messages correctly in simple conversation', () => {
      const result = MessageUtils.countMessagesByType(SAMPLE_CONVERSATION)

      expect(result).toEqual({
        human: 2,
        ai: 2,
        system: 1,
        tool: 0,
        other: 0,
      })
    })

    it('should count messages correctly in conversation with tools', () => {
      const result = MessageUtils.countMessagesByType(CONVERSATION_WITH_TOOLS)

      expect(result).toEqual({
        human: 1,
        ai: 2,
        system: 1,
        tool: 1,
        other: 0,
      })
    })

    it('should handle empty message array', () => {
      const result = MessageUtils.countMessagesByType([])

      expect(result).toEqual({
        human: 0,
        ai: 0,
        system: 0,
        tool: 0,
        other: 0,
      })
    })

    it('should handle single message', () => {
      const message = createHumanMessage('test')
      const result = MessageUtils.countMessagesByType([message])

      expect(result).toEqual({
        human: 1,
        ai: 0,
        system: 0,
        tool: 0,
        other: 0,
      })
    })

    it('should count multiple messages of same type', () => {
      const messages = [
        createHumanMessage('msg1', 'h1'),
        createHumanMessage('msg2', 'h2'),
        createHumanMessage('msg3', 'h3'),
      ]

      const result = MessageUtils.countMessagesByType(messages)

      expect(result).toEqual({
        human: 3,
        ai: 0,
        system: 0,
        tool: 0,
        other: 0,
      })
    })

    it('should not double-count system prompt', () => {
      const messages = [
        createTdrSystemPrompt(),
        createSystemMessage('another system message'),
      ]

      const result = MessageUtils.countMessagesByType(messages)

      expect(result).toEqual({
        human: 0,
        ai: 0,
        system: 2,
        tool: 0,
        other: 0,
      })
    })
  })
})
