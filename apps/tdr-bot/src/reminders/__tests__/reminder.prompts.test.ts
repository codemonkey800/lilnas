import {
  REMINDER_DELIVERY_PROMPT,
  REMINDER_MATH_DELIVERY_PROMPT,
  REMINDER_SEARCH_DELIVERY_PROMPT,
} from 'src/reminders/reminder.prompts'
import { EMOJI_DICTIONARY } from 'src/utils/prompts'

describe('delivery prompts', () => {
  it('REMINDER_DELIVERY_PROMPT sets TDR Bot persona and character limit', () => {
    const content = REMINDER_DELIVERY_PROMPT.content as string

    expect(content).toContain('TDR Bot')
    expect(content).toContain('200 characters')
  })

  it('REMINDER_SEARCH_DELIVERY_PROMPT summarises search results', () => {
    const content = REMINDER_SEARCH_DELIVERY_PROMPT.content as string

    expect(content).toContain('search results')
    expect(content).toContain('400 characters')
  })

  it('REMINDER_MATH_DELIVERY_PROMPT introduces the equation', () => {
    const content = REMINDER_MATH_DELIVERY_PROMPT.content as string

    expect(content).toContain('equation')
    expect(content).toContain('200 characters')
  })

  it.each([
    ['REMINDER_DELIVERY_PROMPT', REMINDER_DELIVERY_PROMPT],
    ['REMINDER_SEARCH_DELIVERY_PROMPT', REMINDER_SEARCH_DELIVERY_PROMPT],
    ['REMINDER_MATH_DELIVERY_PROMPT', REMINDER_MATH_DELIVERY_PROMPT],
  ])('%s includes the emoji dictionary', (_name, prompt) => {
    expect(prompt.content as string).toContain(EMOJI_DICTIONARY)
  })
})
