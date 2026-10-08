import {
  CancelResolutionSchema,
  ContinuationSchema,
  ReminderIntentSchema,
} from 'src/llm/skills/reminder/schemas'

const FULL_NULL = {
  action: 'list',
  what: null,
  isRecurring: null,
  day: null,
  time: null,
  scheduleDescription: null,
  scheduledAt: null,
  cronExpression: null,
  endsAt: null,
  channelId: null,
  targetUserId: null,
  actionType: 'default',
}

describe('ReminderIntentSchema', () => {
  it('parses an object whose every nullable field is null', () => {
    expect(ReminderIntentSchema.parse(FULL_NULL)).toEqual(FULL_NULL)
  })

  it.each(Object.keys(FULL_NULL))('requires %s', key => {
    const rest = Object.fromEntries(
      Object.entries(FULL_NULL).filter(([k]) => k !== key),
    )

    expect(ReminderIntentSchema.safeParse(rest).success).toBe(false)
  })

  it('has no optional property', () => {
    for (const field of Object.values(ReminderIntentSchema.shape)) {
      expect(field.safeParse(undefined).success).toBe(false)
    }
  })

  it.each(['create', 'list', 'cancel', 'cancel_all'])('accepts %s', action => {
    expect(
      ReminderIntentSchema.safeParse({ ...FULL_NULL, action }).success,
    ).toBe(true)
  })

  it('rejects unknown actions and action types', () => {
    expect(
      ReminderIntentSchema.safeParse({ ...FULL_NULL, action: 'nope' }).success,
    ).toBe(false)
    expect(
      ReminderIntentSchema.safeParse({ ...FULL_NULL, actionType: 'nope' })
        .success,
    ).toBe(false)
  })

  it('rejects a what longer than 500 characters', () => {
    expect(
      ReminderIntentSchema.safeParse({ ...FULL_NULL, what: 'x'.repeat(501) })
        .success,
    ).toBe(false)
  })
})

describe('CancelResolutionSchema', () => {
  it('parses ids and confidence, and requires both', () => {
    expect(
      CancelResolutionSchema.parse({ matchIds: ['a'], confident: true }),
    ).toEqual({ matchIds: ['a'], confident: true })
    expect(CancelResolutionSchema.safeParse({ matchIds: [] }).success).toBe(
      false,
    )
    expect(CancelResolutionSchema.safeParse({ confident: false }).success).toBe(
      false,
    )
  })
})

describe('ContinuationSchema', () => {
  it('requires continuing', () => {
    expect(ContinuationSchema.parse({ continuing: false })).toEqual({
      continuing: false,
    })
    expect(ContinuationSchema.safeParse({}).success).toBe(false)
  })
})
