import { StructuredToolInterface, tool } from '@langchain/core/tools'
import { TavilySearch } from '@langchain/tavily'
import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import { REMINDER_TIMEZONE } from 'src/reminders/reminder.constants'

dayjs.extend(utc)
dayjs.extend(timezone)

export const dateTool = tool(
  () =>
    `${dayjs().tz(REMINDER_TIMEZONE).format('MMMM DD, YYYY hh:mm:ss A')} (${REMINDER_TIMEZONE})`,
  {
    name: 'get_date',
    description: `Gets the current date and time in ${REMINDER_TIMEZONE}, formatted as <Month> <Day>, <Year> <Hour>:<Minute>:<Second> [AM/PM] (${REMINDER_TIMEZONE})`,
  },
)

/** Tools the chat skill can call. */
@Injectable()
export class LlmTools {
  readonly all: StructuredToolInterface[] = [new TavilySearch(), dateTool]
}
