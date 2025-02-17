import { tool } from '@langchain/core/tools'
import dayjs from 'dayjs'

export const dateTool = tool(() => dayjs().format('MMMM DD, YYYY hh:mm:ss A'), {
  name: 'get_date',
  description:
    'Gets the current PST date in the format <Month> <Day>, <Year> <Hour>:<Minute>:<Second> [AM/PM]',
})
