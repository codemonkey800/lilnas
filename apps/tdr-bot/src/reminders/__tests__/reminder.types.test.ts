import { ReminderActionType } from 'src/reminders/reminder.types'

describe('ReminderActionType', () => {
  it('has the three delivery actions', () => {
    expect(Object.values(ReminderActionType).sort()).toEqual([
      'default',
      'math',
      'search',
    ])
  })
})
