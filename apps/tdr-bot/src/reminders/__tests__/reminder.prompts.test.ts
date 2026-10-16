import {
  buildReminderDeliveryPrompt,
  buildReminderMathDeliveryPrompt,
  buildReminderSearchDeliveryPrompt,
} from 'src/reminders/reminder.prompts'

const DICTIONARY = 'FAKE EMOJI DICTIONARY {"<:EZ:1>":"smug"}'

describe('delivery prompts', () => {
  it('buildReminderDeliveryPrompt sets TDR Bot persona and character limit', () => {
    const content = buildReminderDeliveryPrompt(DICTIONARY).content as string

    expect(content).toContain('TDR Bot')
    expect(content).toContain('200 characters')
  })

  it('buildReminderSearchDeliveryPrompt summarises search results', () => {
    const content = buildReminderSearchDeliveryPrompt(DICTIONARY)
      .content as string

    expect(content).toContain('search results')
    expect(content).toContain('400 characters')
  })

  it('buildReminderMathDeliveryPrompt introduces the equation', () => {
    const content = buildReminderMathDeliveryPrompt(DICTIONARY)
      .content as string

    expect(content).toContain('equation')
    expect(content).toContain('200 characters')
  })

  it.each([
    ['buildReminderDeliveryPrompt', buildReminderDeliveryPrompt],
    ['buildReminderSearchDeliveryPrompt', buildReminderSearchDeliveryPrompt],
    ['buildReminderMathDeliveryPrompt', buildReminderMathDeliveryPrompt],
  ])('%s includes the given emoji dictionary', (_name, build) => {
    expect(build(DICTIONARY).content as string).toContain(DICTIONARY)
  })
})
