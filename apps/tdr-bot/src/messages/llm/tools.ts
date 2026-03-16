import { StructuredToolInterface, tool } from '@langchain/core/tools'
import { TavilySearch } from '@langchain/tavily'
import dayjs from 'dayjs'

export const dateTool = tool(() => dayjs().format('MMMM DD, YYYY hh:mm:ss A'), {
  name: 'get_date',
  description:
    'Gets the current date in the format <Month> <Day>, <Year> <Hour>:<Minute>:<Second> [AM/PM] (server local time)',
})

let _tools: StructuredToolInterface[] | null = null

export function getTools(): StructuredToolInterface[] {
  if (!_tools) {
    const tavilySearch = new TavilySearch()
    _tools = [tavilySearch as unknown as StructuredToolInterface, dateTool]
  }
  return _tools!
}
