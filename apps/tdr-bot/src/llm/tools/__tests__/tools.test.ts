jest.mock('@langchain/tavily', () => ({
  TavilySearch: jest.fn().mockImplementation(() => ({
    name: 'tavily_search',
    invoke: jest.fn(),
  })),
}))

import { dateTool, LlmTools } from 'src/llm/tools/tools'
import { REMINDER_TIMEZONE } from 'src/reminders/reminder.constants'

describe('dateTool', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('has the correct tool name', () => {
    expect(dateTool.name).toBe('get_date')
  })

  it('names the timezone in its description', () => {
    expect(dateTool.description).toContain('date')
    expect(dateTool.description).toContain(REMINDER_TIMEZONE)
  })

  it('formats the current time in the reminder timezone', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T17:30:00Z'))

    const result = await dateTool.invoke({})

    expect(result).toBe('March 15, 2026 10:30:00 AM (America/Los_Angeles)')
  })

  it('has a valid schema that accepts an empty object', () => {
    const parsed = dateTool.schema.safeParse({})
    expect(parsed.success).toBe(true)
  })
})

describe('LlmTools', () => {
  it('provides Tavily search and the date tool', () => {
    const { all } = new LlmTools()

    expect(all).toContain(dateTool)
    expect(all.some(t => t.name === 'tavily_search')).toBe(true)
  })
})
