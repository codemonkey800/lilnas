import dayjs from 'dayjs'

import { dateTool } from 'src/message-handler/tools'

jest.mock('dayjs')

describe('tools', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('dateTool', () => {
    it('should have correct name and description', () => {
      expect(dateTool.name).toBe('get_date')
      expect(dateTool.description).toBe(
        'Gets the current PST date in the format <Month> <Day>, <Year> <Hour>:<Minute>:<Second> [AM/PM]',
      )
    })

    it('should return formatted date when invoked', async () => {
      const mockDate = 'December 25, 2023 10:30:45 AM'
      const mockDayjs = {
        format: jest.fn().mockReturnValue(mockDate),
      }

      ;(dayjs as jest.MockedFunction<typeof dayjs>).mockReturnValue(mockDayjs)

      const result = await dateTool.invoke({})

      expect(result).toBe(mockDate)
      expect(dayjs).toHaveBeenCalled()
      expect(mockDayjs.format).toHaveBeenCalledWith('MMMM DD, YYYY hh:mm:ss A')
    })

    it('should return different dates on subsequent calls', async () => {
      const mockDayjs1 = {
        format: jest.fn().mockReturnValue('January 01, 2024 12:00:00 AM'),
      }
      const mockDayjs2 = {
        format: jest.fn().mockReturnValue('January 01, 2024 12:00:01 AM'),
      }

      ;(dayjs as jest.MockedFunction<typeof dayjs>)
        .mockReturnValueOnce(mockDayjs1)
        .mockReturnValueOnce(mockDayjs2)

      const result1 = await dateTool.invoke({})
      const result2 = await dateTool.invoke({})

      expect(result1).toBe('January 01, 2024 12:00:00 AM')
      expect(result2).toBe('January 01, 2024 12:00:01 AM')
    })

    it('should handle dayjs errors gracefully', async () => {
      ;(dayjs as jest.MockedFunction<typeof dayjs>).mockImplementation(() => {
        throw new Error('Dayjs error')
      })

      await expect(dateTool.invoke({})).rejects.toThrow('Dayjs error')
    })

    it('should work with tool execution context', async () => {
      const mockDate = 'July 04, 2024 06:00:00 PM'
      const mockDayjs = {
        format: jest.fn().mockReturnValue(mockDate),
      }

      ;(dayjs as jest.MockedFunction<typeof dayjs>).mockReturnValue(mockDayjs)

      // Simulate being called from LangChain tool node
      const toolInput = {}
      const config = {
        configurable: {
          sessionId: 'test-session',
        },
      }

      // The tool function should work regardless of config
      const result = await dateTool.invoke(toolInput, config)

      expect(result).toBe(mockDate)
    })

    it('should be serializable for LangChain', () => {
      // Test that the tool has required properties for LangChain serialization
      expect(dateTool).toHaveProperty('lc_serializable')
      expect(dateTool).toHaveProperty('name')
      expect(dateTool).toHaveProperty('description')
      expect(dateTool).toHaveProperty('invoke')
      expect(dateTool).toHaveProperty('schema')
    })

    it('should have correct schema', () => {
      // The dateTool should have a schema that expects no input
      expect(dateTool.schema).toBeDefined()

      // Since it's created with tool() function, it should have proper Zod schema
      const parsed = dateTool.schema.safeParse({})
      expect(parsed.success).toBe(true)
    })
  })

  describe('tool integration with LangChain', () => {
    it('should be compatible with ToolNode', async () => {
      const mockDate = 'March 15, 2024 03:14:15 PM'
      const mockDayjs = {
        format: jest.fn().mockReturnValue(mockDate),
      }

      ;(dayjs as jest.MockedFunction<typeof dayjs>).mockReturnValue(mockDayjs)

      // Simulate how ToolNode would call the tool
      const toolCall = {
        id: 'call_123',
        name: 'get_date',
        args: {},
      }

      const result = await dateTool.invoke(toolCall.args)

      expect(result).toBe(mockDate)
    })

    it('should handle being called multiple times in sequence', async () => {
      const dates = [
        'January 01, 2024 12:00:00 AM',
        'January 01, 2024 12:00:01 AM',
        'January 01, 2024 12:00:02 AM',
      ]

      dates.forEach(date => {
        const mockDayjs = {
          format: jest.fn().mockReturnValue(date),
        }
        ;(dayjs as jest.MockedFunction<typeof dayjs>).mockReturnValueOnce(
          mockDayjs,
        )
      })

      const results = await Promise.all([
        dateTool.invoke({}),
        dateTool.invoke({}),
        dateTool.invoke({}),
      ])

      expect(results).toEqual(dates)
      expect(dayjs).toHaveBeenCalledTimes(3)
    })
  })
})
