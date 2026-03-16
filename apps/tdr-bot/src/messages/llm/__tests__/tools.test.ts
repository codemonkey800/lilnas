import dayjs from 'dayjs'

jest.mock('dayjs')
jest.mock('@langchain/tavily', () => ({
  TavilySearch: jest.fn().mockImplementation(() => ({
    name: 'tavily_search',
    invoke: jest.fn(),
  })),
}))

// Import once — module-level _tools singleton is shared for the whole test file.
// Tests for singleton behavior rely on this single import.
import { dateTool, getTools } from 'src/messages/llm/tools'

describe('dateTool', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('has the correct tool name', () => {
    expect(dateTool.name).toBe('get_date')
  })

  it('has a description mentioning date', () => {
    expect(dateTool.description).toContain('date')
  })

  it('returns the formatted date when invoked', async () => {
    const mockDayjs = {
      format: jest.fn().mockReturnValue('March 15, 2026 10:30:00 AM'),
    }
    // Use requireMock to get the same instance that the tools module uses
    const dayjsMock = jest.requireMock('dayjs') as jest.Mock
    dayjsMock.mockReturnValue(mockDayjs)

    const result = await dateTool.invoke({})

    expect(result).toBe('March 15, 2026 10:30:00 AM')
    expect(mockDayjs.format).toHaveBeenCalledWith('MMMM DD, YYYY hh:mm:ss A')
  })

  it('calls dayjs() to get the current date', async () => {
    const mockDayjs = { format: jest.fn().mockReturnValue('some date') }
    const dayjsMock = jest.requireMock('dayjs') as jest.Mock
    dayjsMock.mockReturnValue(mockDayjs)

    await dateTool.invoke({})

    expect(dayjs).toHaveBeenCalled()
  })

  it('has a valid schema that accepts an empty object', () => {
    const parsed = dateTool.schema.safeParse({})
    expect(parsed.success).toBe(true)
  })
})

describe('getTools', () => {
  it('returns an array containing dateTool', () => {
    const tools = getTools()
    expect(tools).toContain(dateTool)
  })

  it('returns an array containing a TavilySearch instance', () => {
    const tools = getTools()
    expect(tools.some(t => t.name === 'tavily_search')).toBe(true)
  })

  it('returns the same array reference on subsequent calls (singleton)', () => {
    const tools1 = getTools()
    const tools2 = getTools()
    expect(tools1).toBe(tools2)
  })

  it('returns an array with at least 2 tools', () => {
    expect(getTools().length).toBeGreaterThanOrEqual(2)
  })
})
