import { ReminderExtractionSchema } from 'src/reminders/reminder.types'

describe('ReminderExtractionSchema', () => {
  // ── valid "create" extraction ─────────────────────────────────────────────

  describe('create action', () => {
    it('parses a complete one-time create extraction', () => {
      const input = {
        action: 'create',
        what: 'pay rent',
        isRecurring: false,
        day: 'tomorrow',
        time: '9:00 AM',
        recurringPattern: null,
        scheduledAt: '2026-03-18T09:00:00',
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      const result = ReminderExtractionSchema.parse(input)

      expect(result.action).toBe('create')
      expect(result.what).toBe('pay rent')
      expect(result.isRecurring).toBe(false)
      expect(result.day).toBe('tomorrow')
      expect(result.scheduledAt).toBe('2026-03-18T09:00:00')
    })

    it('parses a recurring create extraction with cron expression', () => {
      const input = {
        action: 'create',
        what: 'I am a cool person',
        isRecurring: true,
        day: 'every Tuesday',
        time: null,
        recurringPattern: 'every week on Tuesday',
        scheduledAt: null,
        cronExpression: '0 9 * * 2',
        reminderIdToCancel: null,
        channelId: null,
      }

      const result = ReminderExtractionSchema.parse(input)

      expect(result.action).toBe('create')
      expect(result.isRecurring).toBe(true)
      expect(result.cronExpression).toBe('0 9 * * 2')
      expect(result.scheduledAt).toBeNull()
    })

    it('allows all nullable fields to be null', () => {
      const input = {
        action: 'create',
        what: null,
        isRecurring: null,
        day: null,
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      expect(() => ReminderExtractionSchema.parse(input)).not.toThrow()
    })
  })

  // ── valid "list" extraction ───────────────────────────────────────────────

  describe('list action', () => {
    it('parses a list extraction with all null fields', () => {
      const input = {
        action: 'list',
        what: null,
        isRecurring: null,
        day: null,
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      const result = ReminderExtractionSchema.parse(input)

      expect(result.action).toBe('list')
      expect(result.what).toBeNull()
      expect(result.isRecurring).toBeNull()
    })
  })

  // ── valid "cancel" extraction ─────────────────────────────────────────────

  describe('cancel action', () => {
    it('parses a cancel extraction with a "what" description', () => {
      const input = {
        action: 'cancel',
        what: 'dentist',
        isRecurring: null,
        day: null,
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      const result = ReminderExtractionSchema.parse(input)

      expect(result.action).toBe('cancel')
      expect(result.what).toBe('dentist')
    })

    it('parses a cancel extraction with a reminderIdToCancel', () => {
      const input = {
        action: 'cancel',
        what: null,
        isRecurring: null,
        day: null,
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: 'reminder-abc-123',
        channelId: null,
      }

      const result = ReminderExtractionSchema.parse(input)

      expect(result.reminderIdToCancel).toBe('reminder-abc-123')
    })
  })

  // ── invalid inputs ────────────────────────────────────────────────────────

  describe('invalid inputs', () => {
    it('rejects an unknown action value', () => {
      const input = {
        action: 'snooze',
        what: 'dentist',
        isRecurring: null,
        day: null,
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      expect(() => ReminderExtractionSchema.parse(input)).toThrow()
    })

    it('rejects a missing action field', () => {
      const input = {
        what: 'pay rent',
        isRecurring: false,
        day: 'tomorrow',
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      expect(() => ReminderExtractionSchema.parse(input)).toThrow()
    })

    it('rejects a non-boolean isRecurring value (when not null)', () => {
      const input = {
        action: 'create',
        what: 'pay rent',
        isRecurring: 'yes',
        day: 'tomorrow',
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      expect(() => ReminderExtractionSchema.parse(input)).toThrow()
    })

    it('rejects a non-string "what" value (when not null)', () => {
      const input = {
        action: 'create',
        what: 42,
        isRecurring: false,
        day: 'tomorrow',
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      expect(() => ReminderExtractionSchema.parse(input)).toThrow()
    })
  })

  // ── safeParse ─────────────────────────────────────────────────────────────

  describe('safeParse', () => {
    it('returns success=true for valid input', () => {
      const input = {
        action: 'list',
        what: null,
        isRecurring: null,
        day: null,
        time: null,
        recurringPattern: null,
        scheduledAt: null,
        cronExpression: null,
        reminderIdToCancel: null,
        channelId: null,
      }

      const result = ReminderExtractionSchema.safeParse(input)

      expect(result.success).toBe(true)
    })

    it('returns success=false for invalid input', () => {
      const result = ReminderExtractionSchema.safeParse({ action: 'invalid' })

      expect(result.success).toBe(false)
    })
  })
})
