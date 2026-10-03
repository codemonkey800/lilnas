import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { Logger } from '@nestjs/common'

import { Reminder } from 'src/db/schema'
import { ReminderSkill } from 'src/llm/skills/reminder.skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { ReminderService } from 'src/reminders/reminder.service'

const extraction = (overrides: Record<string, unknown> = {}) => ({
  action: 'create',
  what: 'pay rent',
  isRecurring: false,
  day: 'tomorrow',
  time: '9am',
  recurringPattern: null,
  scheduledAt: '2026-03-18T09:00:00',
  cronExpression: null,
  reminderIdToCancel: null,
  channelId: null,
  ...overrides,
})

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: 'r1',
  userId: 'u1',
  guildId: 'g1',
  what: 'pay rent',
  isRecurring: false,
  cronExpression: null,
  scheduledAt: new Date('2026-03-18T09:00:00'),
  dayDescription: 'tomorrow',
  timeDescription: '9:00 AM',
  channelId: null,
  targetUserId: null,
  actionType: 'default',
  createdAt: new Date(),
  ...overrides,
})

function setup(reminders: Reminder[] = []) {
  const llm = new FakeLlmClient()
    .script('reminder.list', 'listed')
    .script('reminder.cancel', 'cancel reply')
    .script('reminder.askMissing', 'what day?')
    .script('reminder.confirm', 'confirmed')
  const service = {
    create: jest.fn().mockResolvedValue(reminders[0] ?? reminder()),
    listForUser: jest.fn().mockResolvedValue(reminders),
    cancel: jest.fn().mockResolvedValue(true),
  }
  const skill = new ReminderSkill(service as unknown as ReminderService)
  const run = (text: string, overrides: Partial<SkillInput> = {}) =>
    skill.run(
      {
        message: new HumanMessage(text),
        history: [new SystemMessage('system')],
        userId: 'u1',
        channelId: 'c1',
        guildId: 'g1',
        discord: { userId: 'u1', username: 'user' },
        ...overrides,
      },
      { llm, logger: new Logger('test') },
    )
  return { llm, service, skill, run }
}

describe('ReminderSkill', () => {
  it.each([
    ['remind me to pay rent', true],
    ['  Set a reminder for 5pm', true],
    ['list my reminders', true],
    ['cancel the reminder about rent', true],
    ['what is the weather', false],
  ])('match(%j) = %s', (text, expected) => {
    const { skill } = setup()
    expect(skill.match({ message: new HumanMessage(text) } as SkillInput)).toBe(
      expected,
    )
  })

  it('creates a reminder when all fields are present', async () => {
    const { llm, service, run } = setup()
    llm.script('reminder.extract', extraction())

    const out = await run('remind me to pay rent tomorrow')

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        guildId: 'g1',
        what: 'pay rent',
        dayDescription: 'tomorrow',
        scheduledAt: new Date('2026-03-18T09:00:00'),
        cronExpression: null,
      }),
    )
    expect(out.messages[0].content).toBe('confirmed')
    expect(out.followUp).toBeNull()
  })

  it('asks for a missing day and sets a follow-up', async () => {
    const { llm, service, run } = setup()
    llm.script('reminder.extract', extraction({ day: null, time: '9am' }))

    const out = await run('remind me to pay rent')

    expect(service.create).not.toHaveBeenCalled()
    expect(out.messages[0].content).toBe('what day?')
    expect(out.followUp).toEqual({
      data: {
        partialExtraction: expect.objectContaining({
          what: 'pay rent',
          time: '9am',
        }),
      },
    })
  })

  it('completes the reminder when the follow-up supplies the day', async () => {
    const { llm, service, run } = setup()
    llm
      .script('reminder.topicSwitch', { continuing: true })
      .script('reminder.extract', extraction({ what: null }))

    const out = await run('tomorrow', {
      followUp: { partialExtraction: { what: 'pay rent', isRecurring: false } },
    })

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ what: 'pay rent', dayDescription: 'tomorrow' }),
    )
    expect(
      llm.calls.filter(c => c.operation === 'reminder.topicSwitch'),
    ).toHaveLength(1)
    const extractCall = llm.calls.find(c => c.operation === 'reminder.extract')
    expect(String(extractCall?.messages[0].content)).toContain('pay rent')
    expect(out.followUp).toBeNull()
  })

  it('reroutes and clears the follow-up on a topic switch', async () => {
    const { llm, service, run } = setup()
    llm.script('reminder.topicSwitch', { continuing: false })

    const out = await run("what's the weather?", {
      followUp: { partialExtraction: { what: 'pay rent' } },
    })

    expect(out).toEqual({ messages: [], followUp: null, reroute: true })
    expect(llm.calls.map(c => c.operation)).toEqual(['reminder.topicSwitch'])
    expect(service.create).not.toHaveBeenCalled()
  })

  it('lists reminders', async () => {
    const { llm, service, run } = setup([reminder()])
    llm.script('reminder.extract', extraction({ action: 'list', what: null }))

    const out = await run('list my reminders')

    expect(service.listForUser).toHaveBeenCalledWith('u1')
    const listCall = llm.calls.find(c => c.operation === 'reminder.list')
    expect(String(listCall?.messages[2].content)).toContain('pay rent')
    expect(out.messages[0].content).toBe('listed')
  })

  it('cancels a single match', async () => {
    const { llm, service, run } = setup([reminder()])
    llm.script(
      'reminder.extract',
      extraction({ action: 'cancel', what: 'rent' }),
    )

    await run('cancel the reminder about rent')

    expect(service.cancel).toHaveBeenCalledWith('r1', 'u1')
  })

  it('does not cancel when several reminders match', async () => {
    const { llm, service, run } = setup([
      reminder(),
      reminder({ id: 'r2', what: 'pay rent deposit' }),
    ])
    llm.script(
      'reminder.extract',
      extraction({ action: 'cancel', what: 'rent' }),
    )

    const out = await run('cancel my reminder rent')

    expect(service.cancel).not.toHaveBeenCalled()
    const cancelCall = llm.calls.find(c => c.operation === 'reminder.cancel')
    expect(String(cancelCall?.messages[2].content)).toContain(
      'Multiple reminders match',
    )
    expect(out.messages[0].content).toBe('cancel reply')
  })

  it('refuses to create reminders outside a guild', async () => {
    const { llm, service, run } = setup()
    llm.script('reminder.extract', extraction())

    const out = await run('remind me to pay rent tomorrow', { guildId: '' })

    expect(service.create).not.toHaveBeenCalled()
    expect(out.messages[0].content).toMatch(/only be set in a server/)
    expect(out.followUp).toBeNull()
  })
})
