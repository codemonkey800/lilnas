import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import dayjs from 'dayjs'
import { z } from 'zod'

import { LlmCall } from 'src/llm/client/llm-call.types'
import {
  buildExtractReminderPrompt,
  REMINDER_CANCEL_RESOLUTION_PROMPT,
  REMINDER_TOPIC_SWITCH_PROMPT,
} from 'src/llm/skills/reminder/prompts'
import {
  CancelResolutionSchema,
  ContinuationSchema,
  ReminderIntentSchema,
} from 'src/llm/skills/reminder/schemas'
import { MediaRequestSchema } from 'src/schemas/graph'
import { MediaTypeClassificationSchema } from 'src/schemas/media-classification'
import { SearchSelectionSchema } from 'src/schemas/search-selection'
import {
  TvShowSelectionLlmSchema,
  TvShowSelectionSchema,
} from 'src/schemas/tv-show'
import {
  GET_MEDIA_TYPE_PROMPT,
  MOVIE_SELECTION_PARSING_PROMPT,
  TV_SHOW_SELECTION_PARSING_PROMPT,
} from 'src/utils/prompts'

import { describeLive, LiveLlm, MAX_RUN_COST_USD, recordCost } from './live-env'

interface SchemaCase {
  name: string
  call: LlmCall<unknown>
  /** The shape `output` must have, when `call.schema` transforms it */
  outputSchema?: z.ZodType
}

const human = (text: string) => new HumanMessage(text)

// One representative prompt per `schema:` used in src/llm/skills/** and
// src/media-operations/**, with the same prompt and settings as production.
const CASES: SchemaCase[] = [
  {
    name: 'reminder.topicSwitch',
    call: {
      operation: 'reminder.topicSwitch',
      role: 'reasoning',
      messages: [REMINDER_TOPIC_SWITCH_PROMPT, human('tomorrow at 5pm')],
      schema: ContinuationSchema,
    },
  },
  {
    name: 'reminder.extract',
    call: {
      operation: 'reminder.extract',
      role: 'reasoning',
      messages: [
        buildExtractReminderPrompt(
          dayjs().format('YYYY-MM-DDTHH:mm:ss'),
          dayjs().format('dddd'),
        ),
        human('remind me to take out the trash tomorrow at 8am'),
      ],
      schema: ReminderIntentSchema,
    },
  },
  {
    name: 'reminder.resolveCancel',
    call: {
      operation: 'reminder.resolveCancel',
      role: 'reasoning',
      messages: [
        REMINDER_CANCEL_RESOLUTION_PROMPT,
        human(
          'Active reminders:\n' +
            JSON.stringify([
              {
                id: 'r1',
                index: 1,
                what: 'dentist appointment',
                scheduleDescription: 'tomorrow at 9:00 AM',
                isRecurring: false,
              },
              {
                id: 'r2',
                index: 2,
                what: 'water the plants',
                scheduleDescription: 'every Tuesday at 10:00 AM',
                isRecurring: true,
              },
            ]),
        ),
        human('cancel the dentist one'),
      ],
      schema: CancelResolutionSchema,
    },
  },
  {
    name: 'media.intent',
    call: {
      operation: 'media.intent',
      role: 'reasoning',
      messages: [
        GET_MEDIA_TYPE_PROMPT,
        human('download the new Dune movie in 4k'),
      ],
      schema: MediaRequestSchema,
    },
  },
  {
    name: 'media.classifyType',
    call: {
      operation: 'media.classifyType',
      role: 'reasoning',
      messages: [
        new SystemMessage(
          'You are a media type classifier. Determine if the user is asking for a movie or a TV show.',
        ),
        human('I want to watch Breaking Bad'),
      ],
      schema: MediaTypeClassificationSchema,
    },
  },
  {
    name: 'media.parseSelection',
    call: {
      operation: 'media.parseSelection',
      role: 'reasoning',
      messages: [MOVIE_SELECTION_PARSING_PROMPT, human('the one from 2008')],
      schema: SearchSelectionSchema,
    },
  },
  {
    name: 'media.parseTvSelection',
    call: {
      operation: 'media.parseTvSelection',
      role: 'reasoning',
      messages: [
        TV_SHOW_SELECTION_PARSING_PROMPT,
        human('season 2 and episodes 3 and 4 of season 3'),
      ],
      schema: TvShowSelectionLlmSchema,
    },
    outputSchema: TvShowSelectionSchema,
  },
]

describeLive('live structured output', () => {
  const live = new LiveLlm()

  afterAll(() => {
    const total = recordCost('schemas', live.costUsd)
    expect(total).toBeLessThanOrEqual(MAX_RUN_COST_USD)
  })

  it.each(CASES)(
    '$name parses against the real model',
    async ({ call, outputSchema }) => {
      const result = await live.client.call(call)
      const schema = outputSchema ?? call.schema
      expect(schema?.safeParse(result.output).success).toBe(true)
    },
    120_000,
  )
})
