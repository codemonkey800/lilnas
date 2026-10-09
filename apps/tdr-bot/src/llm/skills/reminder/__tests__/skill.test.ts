import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { Logger } from '@nestjs/common'

import { Reminder } from 'src/db/schema'
import { ReminderFollowUp } from 'src/llm/skills/reminder/schemas'
import { ReminderSkill } from 'src/llm/skills/reminder/skill'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { createTestReminder } from 'src/reminders/__tests__/factories/reminder'
import { ReminderError, ReminderService } from 'src/reminders/reminder.service'

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString()
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString()

const intent = (overrides: Record<string, unknown> = {}) => ({
  action: 'create',
  what: 'pay rent',
  isRecurring: false,
  day: 'tomorrow',
  time: '9am',
  scheduleDescription: 'tomorrow at 9:00 AM',
  scheduledAt: tomorrow(),
  cronExpression: null,
  endsAt: null,
  channelId: null,
  targetUserIds: null,
  actionType: 'default',
  ...overrides,
})

const row = (id: string, what: string, overrides: Partial<Reminder> = {}) =>
  createTestReminder({
    id,
    what,
    userId: 'u1',
    guildId: 'g1',
    scheduleDescription: `${what} schedule`,
    ...overrides,
  })

const RENT = row('r1', 'pay rent')
const DENTIST = row('r2', 'dentist appointment')
const CLEANING = row('r3', 'dentist cleaning')

function setup(active: Reminder[] = []) {
  const llm = new FakeLlmClient()
    .script('reminder.askMissing', 'what day?')
    .script('reminder.confirm', 'confirmed')
  const service = {
    create: jest.fn().mockResolvedValue(RENT),
    listForUser: jest.fn().mockResolvedValue(active),
    cancel: jest
      .fn()
      .mockImplementation(async (id: string) => active.find(r => r.id === id)),
    cancelAllForUser: jest.fn().mockResolvedValue(active.length),
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
  const ops = () => llm.calls.map(c => c.operation)
  return { llm, service, skill, run, ops }
}

const content = (out: { messages: { content: unknown }[] }) =>
  String(out.messages[0].content)

describe('ReminderSkill', () => {
  describe('match', () => {
    it.each([
      ['remind me to pay rent', true],
      ['remind us about the meeting', true],
      ['remind <@123> to eat', true],
      ['  Set a reminder for 5pm', true],
      ['set up a reminder', true],
      ['list my reminders', true],
      ['show reminders', true],
      ["what's on my reminders", true],
      ['what are my reminders', true],
      ['do I have any reminders', true],
      ['cancel the reminder about rent', true],
      ['delete all of my reminders', true],
      ['remove my dentist reminder', true],
      ['CLEAR my reminders', true],
      ['what is the weather', false],
      ['remove the movie Cats from the server', false],
      ['remind everyone in #general', false],
      ['I want to cancel my plans', false],
    ])('match(%j) = %s', (text, expected) => {
      const { skill } = setup()
      expect(
        skill.match({ message: new HumanMessage(text) } as SkillInput),
      ).toBe(expected)
    })

    it('keeps its id and description', () => {
      const { skill } = setup()
      expect(skill.id).toBe('reminder')
      expect(skill.description).toContain('reminders')
    })
  })

  describe('create', () => {
    it('creates a one-time reminder and confirms through the LLM', async () => {
      const { llm, service, run } = setup()
      const at = tomorrow()
      llm.script('reminder.extract', intent({ scheduledAt: at }))

      const out = await run('remind me to pay rent tomorrow')

      expect(service.create).toHaveBeenCalledWith({
        userId: 'u1',
        userName: 'user',
        guildId: 'g1',
        what: 'pay rent',
        schedule: { kind: 'once', at: new Date(at) },
        scheduleDescription: 'tomorrow at 9:00 AM',
        channelId: null,
        targetUserIds: [],
        actionType: 'default',
      })
      expect(content(out)).toBe('confirmed')
      expect(out.followUp).toBeNull()
    })

    it('creates a recurring reminder with an end date', async () => {
      const { llm, service, run } = setup()
      const endsAt = tomorrow()
      llm.script(
        'reminder.extract',
        intent({
          isRecurring: true,
          scheduledAt: null,
          cronExpression: '0 10 * * 2',
          endsAt,
          channelId: 'c9',
          targetUserIds: ['222', '<requester ID>'],
          actionType: 'search',
        }),
      )

      await run('every Tuesday')

      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          schedule: {
            kind: 'recurring',
            cron: '0 10 * * 2',
            endsAt: new Date(endsAt),
          },
          channelId: 'c9',
          targetUserIds: ['222'],
          actionType: 'search',
        }),
      )
    })

    it('puts the reminder details in the confirm prompt', async () => {
      const target = row('r9', 'pay rent', {
        nextRunAt: new Date('2026-03-18T17:00:00Z'),
        channelId: 'c9',
        targetUserIds: ['u2', 'u3'],
        endsAt: new Date('2026-11-02T06:00:00Z'),
      })
      const s = setup()
      s.service.create.mockResolvedValue(target)
      s.llm.script('reminder.extract', intent())

      await s.run('remind me')

      const call = s.llm.calls.find(c => c.operation === 'reminder.confirm')
      const details = String(call?.messages.at(-1)?.content)
      expect(details).toContain('pay rent')
      expect(details).toContain('Mar 18, 2026 at 10:00 AM')
      expect(details).toContain('<#c9>')
      expect(details).toContain('Reminder is for: <@u2> <@u3>')
      expect(details).toContain('Ends: Nov 1, 2026')
    })

    it('asks for a missing day and keeps a create follow-up', async () => {
      const { llm, service, run } = setup()
      llm.script('reminder.extract', intent({ day: null, scheduledAt: null }))

      const out = await run('remind me to pay rent')

      expect(service.create).not.toHaveBeenCalled()
      expect(content(out)).toBe('what day?')
      expect(out.followUp).toEqual({
        data: {
          stage: 'create',
          partial: expect.objectContaining({ what: 'pay rent', time: '9am' }),
        },
      })
    })

    it('asks for a missing what', async () => {
      const { llm, run } = setup()
      llm.script('reminder.extract', intent({ what: null }))

      const out = await run('remind me tomorrow')

      const ask = llm.calls.find(c => c.operation === 'reminder.askMissing')
      expect(String(ask?.messages.at(-1)?.content)).toContain('what to be')
      expect(out.followUp).toEqual({
        data: { stage: 'create', partial: expect.any(Object) },
      })
    })

    it('completes the reminder when the follow-up supplies the day', async () => {
      const { llm, service, run, ops } = setup()
      llm
        .script('reminder.topicSwitch', { continuing: true })
        .script('reminder.extract', intent({ what: null }))
      const followUp: ReminderFollowUp = {
        stage: 'create',
        partial: { what: 'pay rent', isRecurring: false },
      }

      const out = await run('tomorrow', { followUp })

      expect(ops()[0]).toBe('reminder.topicSwitch')
      expect(service.create).toHaveBeenCalledWith(
        expect.objectContaining({ what: 'pay rent' }),
      )
      const extract = llm.calls.find(c => c.operation === 'reminder.extract')
      expect(String(extract?.messages[0].content)).toContain('pay rent')
      expect(out.followUp).toBeNull()
    })

    it('rejects a past time and clears the time fields', async () => {
      const { llm, service, run } = setup()
      llm.script('reminder.extract', intent({ scheduledAt: yesterday() }))

      const out = await run('remind me yesterday')

      expect(service.create).not.toHaveBeenCalled()
      expect(content(out)).toBe(
        'That time has already passed, when should I remind you?',
      )
      const data = (out.followUp?.data as { partial: Record<string, unknown> })
        .partial
      expect(data).toMatchObject({
        what: 'pay rent',
        day: null,
        time: null,
        scheduledAt: null,
      })
    })

    it('rejects an unparseable scheduledAt', async () => {
      const { llm, service, run } = setup()
      llm.script('reminder.extract', intent({ scheduledAt: 'soon' }))

      const out = await run('remind me soon')

      expect(service.create).not.toHaveBeenCalled()
      expect(content(out)).toContain('already passed')
    })

    it('rejects an invalid cron and clears it', async () => {
      const { llm, service, run } = setup()
      llm.script(
        'reminder.extract',
        intent({ isRecurring: true, cronExpression: 'nope' }),
      )

      const out = await run('every blue moon')

      expect(service.create).not.toHaveBeenCalled()
      expect(content(out)).toContain("couldn't work out")
      expect(out.followUp).toEqual({
        data: {
          stage: 'create',
          partial: expect.objectContaining({ cronExpression: null }),
        },
      })
    })

    it('rejects a cron that fires every minute', async () => {
      const { llm, service, run } = setup()
      llm.script(
        'reminder.extract',
        intent({ isRecurring: true, cronExpression: '* * * * *' }),
      )

      const out = await run('every minute')

      expect(service.create).not.toHaveBeenCalled()
      expect(content(out)).toContain("can't repeat more than once")
      expect(out.followUp).not.toBeNull()
    })

    it('turns a limit error into friendly text', async () => {
      const { llm, service, run } = setup()
      llm.script('reminder.extract', intent())
      service.create.mockRejectedValue(
        new ReminderError('limit_reached', 'limit'),
      )

      const out = await run('remind me to pay rent tomorrow')

      expect(content(out)).toMatch(/25 active reminders — cancel one first/)
      expect(out.followUp).toBeNull()
    })

    it('rethrows unexpected errors', async () => {
      const { llm, service, run } = setup()
      llm.script('reminder.extract', intent())
      service.create.mockRejectedValue(new Error('db down'))

      await expect(run('remind me')).rejects.toThrow('db down')
    })

    it('refuses in DMs', async () => {
      const { llm, service, run } = setup()
      llm.script('reminder.extract', intent())

      const out = await run('remind me to pay rent', { guildId: '' })

      expect(service.create).not.toHaveBeenCalled()
      expect(content(out)).toContain('only be set in a server channel')
    })
  })

  describe('list', () => {
    it('says so when there are none, without asking the LLM again', async () => {
      const { llm, run, ops } = setup([])
      llm.script('reminder.extract', intent({ action: 'list' }))

      const out = await run('show my reminders')

      expect(content(out)).toBe("You don't have any reminders right now.")
      expect(ops()).toEqual(['reminder.extract'])
    })

    it('formats the reminders deterministically', async () => {
      const { llm, run } = setup([RENT, DENTIST])
      llm.script('reminder.extract', intent({ action: 'list' }))

      const out = await run('show my reminders')

      expect(content(out)).toMatch(
        /^You have 2 reminders:\n1\. \*\*pay rent\*\* — pay rent schedule/,
      )
      expect(content(out)).toContain('2. **dentist appointment**')
    })
  })

  describe('cancel', () => {
    const cancelIntent = intent({ action: 'cancel', what: 'rent' })

    it('says so when there is nothing to cancel', async () => {
      const { llm, run, ops } = setup([])
      llm.script('reminder.extract', cancelIntent)

      const out = await run('cancel my rent reminder')

      expect(content(out)).toBe("You don't have any reminders right now.")
      expect(ops()).not.toContain('reminder.resolveCancel')
    })

    it('cancels the single confident match', async () => {
      const { llm, service, run } = setup([RENT, DENTIST])
      llm
        .script('reminder.extract', cancelIntent)
        .script('reminder.resolveCancel', { matchIds: ['r1'], confident: true })

      const out = await run('cancel my rent reminder')

      expect(service.cancel).toHaveBeenCalledWith('r1', { userId: 'u1' })
      expect(content(out)).toBe('Cancelled: **pay rent** — pay rent schedule')
      expect(out.followUp).toBeNull()
    })

    it('sends the numbered active list to the resolver', async () => {
      const { llm, run } = setup([RENT, DENTIST])
      llm
        .script('reminder.extract', cancelIntent)
        .script('reminder.resolveCancel', { matchIds: ['r1'], confident: true })

      await run('cancel my rent reminder')

      const call = llm.calls.find(c => c.operation === 'reminder.resolveCancel')
      const list = String(call?.messages[1].content)
      expect(list).toContain('"index": 2')
      expect(list).toContain('"id": "r2"')
      expect(String(call?.messages[2].content)).toBe('cancel my rent reminder')
    })

    it('lists everything when nothing matches', async () => {
      const { llm, service, run } = setup([RENT, DENTIST])
      llm
        .script('reminder.extract', cancelIntent)
        .script('reminder.resolveCancel', { matchIds: [], confident: false })

      const out = await run('cancel the gym one')

      expect(service.cancel).not.toHaveBeenCalled()
      expect(content(out)).toMatch(
        /^I couldn't tell which one you meant:\n1\. \*\*pay rent\*\*[\s\S]*2\. \*\*dentist appointment\*\*/,
      )
      expect(out.followUp).toEqual({
        data: { stage: 'cancel', candidateIds: ['r1', 'r2'], rounds: 1 },
      })
    })

    it('asks which one when several match', async () => {
      const { llm, run } = setup([RENT, DENTIST, CLEANING])
      llm
        .script('reminder.extract', cancelIntent)
        .script('reminder.resolveCancel', {
          matchIds: ['r2', 'r3', 'bogus'],
          confident: false,
        })

      const out = await run('cancel the dentist one')

      expect(content(out)).toMatch(
        /^Which one\?\n1\. \*\*dentist appointment\*\*.*\n2\. \*\*dentist cleaning\*\*/,
      )
      expect(content(out)).not.toContain('pay rent')
      expect(out.followUp).toEqual({
        data: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })
    })

    it('picks a candidate by number without asking the resolver', async () => {
      const { llm, service, run, ops } = setup([RENT, DENTIST, CLEANING])
      llm.script('reminder.topicSwitch', { continuing: true })

      const out = await run('2', {
        followUp: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })

      expect(service.cancel).toHaveBeenCalledWith('r3', { userId: 'u1' })
      expect(content(out)).toContain('Cancelled: **dentist cleaning**')
      expect(ops()).not.toContain('reminder.resolveCancel')
      expect(out.followUp).toBeNull()
    })

    it('picks by ordinal', async () => {
      const { llm, service, run } = setup([RENT, DENTIST, CLEANING])
      llm.script('reminder.topicSwitch', { continuing: true })

      await run('the first one', {
        followUp: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })

      expect(service.cancel).toHaveBeenCalledWith('r2', { userId: 'u1' })
    })

    it('resolves a descriptive reply against the candidates only', async () => {
      const { llm, service, run } = setup([RENT, DENTIST, CLEANING])
      llm
        .script('reminder.topicSwitch', { continuing: true })
        .script('reminder.resolveCancel', { matchIds: ['r3'], confident: true })

      await run('the cleaning', {
        followUp: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })

      const call = llm.calls.find(c => c.operation === 'reminder.resolveCancel')
      expect(String(call?.messages[1].content)).not.toContain('pay rent')
      expect(service.cancel).toHaveBeenCalledWith('r3', { userId: 'u1' })
    })

    it('gives up once the round limit is reached', async () => {
      const { llm, service, run } = setup([RENT, DENTIST, CLEANING])
      llm
        .script('reminder.topicSwitch', { continuing: true })
        .script('reminder.resolveCancel', {
          matchIds: ['r2', 'r3'],
          confident: false,
        })

      const out = await run('the dentist', {
        followUp: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })

      expect(service.cancel).not.toHaveBeenCalled()
      expect(content(out)).toBe(
        "Let's start over — tell me which reminder to cancel.",
      )
      expect(out.followUp).toBeNull()
    })

    it('treats an out-of-range number as a description', async () => {
      const { llm, run, ops } = setup([RENT, DENTIST, CLEANING])
      llm
        .script('reminder.topicSwitch', { continuing: true })
        .script('reminder.resolveCancel', { matchIds: [], confident: false })

      await run('7', {
        followUp: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })

      expect(ops()).toContain('reminder.resolveCancel')
    })

    it.each(['forbidden', 'not_active'] as const)(
      'reports a %s error as already gone, with the fresh list',
      async code => {
        const { llm, service, run } = setup([RENT, DENTIST])
        llm
          .script('reminder.extract', cancelIntent)
          .script('reminder.resolveCancel', {
            matchIds: ['r1'],
            confident: true,
          })
        service.cancel.mockRejectedValue(new ReminderError(code, 'nope'))

        const out = await run('cancel my rent reminder')

        expect(content(out)).toMatch(
          /^That reminder is already gone\.\nYou have 2 reminders:/,
        )
        expect(out.followUp).toBeNull()
      },
    )

    it('reports vanished candidates on a follow-up', async () => {
      const { llm, run } = setup([RENT])
      llm.script('reminder.topicSwitch', { continuing: true })

      const out = await run('1', {
        followUp: { stage: 'cancel', candidateIds: ['r2', 'r3'], rounds: 1 },
      })

      expect(content(out)).toMatch(/^That reminder is already gone\./)
    })
  })

  describe('cancel all', () => {
    it('says so when there is nothing to cancel', async () => {
      const { llm, run } = setup([])
      llm.script('reminder.extract', intent({ action: 'cancel_all' }))

      const out = await run('nuke all my reminders')

      expect(content(out)).toBe("You don't have any reminders right now.")
      expect(out.followUp).toBeNull()
    })

    it('lists them and waits for a yes', async () => {
      const { llm, service, run } = setup([RENT, DENTIST])
      llm.script('reminder.extract', intent({ action: 'cancel_all' }))

      const out = await run('nuke all my reminders')

      expect(service.cancelAllForUser).not.toHaveBeenCalled()
      expect(content(out)).toContain('You have 2 reminders:')
      expect(content(out)).toContain('Reply **yes** to cancel all 2.')
      expect(out.followUp).toEqual({
        data: { stage: 'cancelAll', ids: ['r1', 'r2'] },
      })
    })

    it.each(['yes', 'Yep!', 'yeah do it', 'sure', 'do it', 'confirm'])(
      'cancels everything on %j',
      async text => {
        const { llm, service, run } = setup([RENT, DENTIST])
        llm.script('reminder.topicSwitch', { continuing: true })

        const out = await run(text, {
          followUp: { stage: 'cancelAll', ids: ['r1', 'r2'] },
        })

        expect(service.cancelAllForUser).toHaveBeenCalledWith('u1')
        expect(content(out)).toBe('Cancelled 2 reminders.')
        expect(out.followUp).toBeNull()
      },
    )

    it('keeps them on any other continuing message', async () => {
      const { llm, service, run } = setup([RENT, DENTIST])
      llm.script('reminder.topicSwitch', { continuing: true })

      const out = await run('no, keep them', {
        followUp: { stage: 'cancelAll', ids: ['r1', 'r2'] },
      })

      expect(service.cancelAllForUser).not.toHaveBeenCalled()
      expect(content(out)).toBe('Okay, I kept them.')
      expect(out.followUp).toBeNull()
    })
  })

  describe('follow-up topic switch', () => {
    it.each<[string, ReminderFollowUp]>([
      ['create', { stage: 'create', partial: { what: 'pay rent' } }],
      ['cancel', { stage: 'cancel', candidateIds: ['r1'], rounds: 1 }],
      ['cancelAll', { stage: 'cancelAll', ids: ['r1'] }],
    ])('reroutes and clears the %s follow-up', async (_stage, followUp) => {
      const { llm, service, run, ops } = setup([RENT])
      llm.script('reminder.topicSwitch', { continuing: false })

      const out = await run("what's the weather?", { followUp })

      expect(out).toEqual({ messages: [], followUp: null, reroute: true })
      expect(ops()).toEqual(['reminder.topicSwitch'])
      expect(service.create).not.toHaveBeenCalled()
      expect(service.cancelAllForUser).not.toHaveBeenCalled()
    })

    it('assumes the user is continuing when the check fails', async () => {
      const { llm, service, run } = setup([RENT])
      llm.script('reminder.topicSwitch', new Error('timeout'))

      const out = await run('yes', {
        followUp: { stage: 'cancelAll', ids: ['r1'] },
      })

      expect(service.cancelAllForUser).toHaveBeenCalled()
      expect(out.reroute).toBeUndefined()
    })

    it('ignores a follow-up payload it does not recognise', async () => {
      const { llm, ops, run } = setup()
      llm.script('reminder.extract', intent({ action: 'list' }))

      await run('show my reminders', { followUp: { partialExtraction: {} } })

      expect(ops()).toEqual(['reminder.extract'])
    })
  })
})
