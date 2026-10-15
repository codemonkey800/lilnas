import dayjs, { extend } from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import { parseSince } from 'src/commands/tldr/since'
import { TldrError, TldrErrorCode } from 'src/commands/tldr/types'

extend(utc)
extend(timezone)

const TZ = 'America/Los_Angeles'

// Wed 2026-10-14 15:00 PDT (UTC-7) = 22:00Z
const NOW = dayjs.tz('2026-10-14 15:00', TZ).toDate()

describe('parseSince', () => {
  it('uses the fixed now as 22:00Z', () => {
    expect(NOW.toISOString()).toBe('2026-10-14T22:00:00.000Z')
  })

  describe('durations', () => {
    it.each([
      ['30m', '2026-10-14T21:30:00.000Z'],
      ['2h', '2026-10-14T20:00:00.000Z'],
      ['3d', '2026-10-11T22:00:00.000Z'],
      ['1w', '2026-10-07T22:00:00.000Z'],
      ['90 min', '2026-10-14T20:30:00.000Z'],
      ['2 hours', '2026-10-14T20:00:00.000Z'],
      ['3 days', '2026-10-11T22:00:00.000Z'],
      ['a day', '2026-10-13T22:00:00.000Z'],
      ['an hour', '2026-10-14T21:00:00.000Z'],
    ])('reads %j', (input, iso) => {
      expect(parseSince(input, NOW, TZ).toISOString()).toBe(iso)
    })
  })

  describe('clock times', () => {
    it.each([
      // 20:30 today would be after now (15:00), so it rolls to yesterday.
      ['8:30pm', '2026-10-14T03:30:00.000Z'],
      ['8pm', '2026-10-14T03:00:00.000Z'],
      ['20:30', '2026-10-14T03:30:00.000Z'],
      ['8:30 PM', '2026-10-14T03:30:00.000Z'],
      ['8am', '2026-10-14T15:00:00.000Z'],
      ['3pm', '2026-10-14T22:00:00.000Z'],
      ['12am', '2026-10-14T07:00:00.000Z'],
      ['12pm', '2026-10-14T19:00:00.000Z'],
      ['noon', '2026-10-14T19:00:00.000Z'],
      ['midnight', '2026-10-14T07:00:00.000Z'],
    ])('reads %j', (input, iso) => {
      expect(parseSince(input, NOW, TZ).toISOString()).toBe(iso)
    })

    it('reads times in the given timezone', () => {
      expect(parseSince('8pm', NOW, 'UTC').toISOString()).toBe(
        '2026-10-14T20:00:00.000Z',
      )
    })
  })

  describe('words', () => {
    it.each([
      ['today', '2026-10-14T07:00:00.000Z'],
      ['yesterday', '2026-10-13T07:00:00.000Z'],
      ['this morning', '2026-10-14T13:00:00.000Z'],
      ['last night', '2026-10-14T03:00:00.000Z'],
    ])('reads %j', (input, iso) => {
      expect(parseSince(input, NOW, TZ).toISOString()).toBe(iso)
    })
  })

  describe('dates', () => {
    it.each([
      ['10/13', '2026-10-13T07:00:00.000Z'],
      ['10/13/2026', '2026-10-13T07:00:00.000Z'],
      ['10/13/26', '2026-10-13T07:00:00.000Z'],
      ['2026-10-13', '2026-10-13T07:00:00.000Z'],
      ['oct 13', '2026-10-13T07:00:00.000Z'],
      ['Oct 13th', '2026-10-13T07:00:00.000Z'],
      ['october 13', '2026-10-13T07:00:00.000Z'],
      ['october 13, 2026', '2026-10-13T07:00:00.000Z'],
      ['10/13 8:30pm', '2026-10-14T03:30:00.000Z'],
      ['2026-10-13 20:30', '2026-10-14T03:30:00.000Z'],
      ['oct 13 at 8pm', '2026-10-14T03:00:00.000Z'],
      ['october 13 noon', '2026-10-13T19:00:00.000Z'],
      // Standard time applies before the March DST change.
      ['march 3', '2026-03-03T08:00:00.000Z'],
    ])('reads %j', (input, iso) => {
      expect(parseSince(input, NOW, TZ).toISOString()).toBe(iso)
    })

    it('rolls a year-less date that is after now back a year', () => {
      expect(parseSince('12/25', NOW, TZ).toISOString()).toBe(
        '2025-12-25T08:00:00.000Z',
      )
      expect(parseSince('10/20', NOW, TZ).toISOString()).toBe(
        '2025-10-20T07:00:00.000Z',
      )
    })
  })

  describe('Discord timestamps', () => {
    it.each(['<t:1760400000:R>', '<t:1760400000>', '<t:1760400000:F>'])(
      'reads %j',
      input => {
        expect(parseSince(input, NOW, TZ).toISOString()).toBe(
          '2025-10-14T00:00:00.000Z',
        )
      },
    )
  })

  describe('normalisation', () => {
    it.each([
      ['since 8pm', '2026-10-14T03:00:00.000Z'],
      ['Since   Yesterday', '2026-10-13T07:00:00.000Z'],
      ['2h ago', '2026-10-14T20:00:00.000Z'],
      ['2 hours ago', '2026-10-14T20:00:00.000Z'],
      ['since 3 days ago', '2026-10-11T22:00:00.000Z'],
      ['  an   HOUR  ', '2026-10-14T21:00:00.000Z'],
    ])('reads %j', (input, iso) => {
      expect(parseSince(input, NOW, TZ).toISOString()).toBe(iso)
    })
  })

  describe('errors', () => {
    const codeOf = (input: string): TldrErrorCode | undefined => {
      try {
        parseSince(input, NOW, TZ)
      } catch (err) {
        expect(err).toBeInstanceOf(TldrError)
        return (err as TldrError).code
      }
      return undefined
    }

    it.each(['tomorrow', '10/20/2026', '2026-10-20', 'oct 20 2026'])(
      'rejects %j as future_since',
      input => {
        expect(codeOf(input)).toBe('future_since')
      },
    )

    it.each([
      '',
      '   ',
      'soon',
      '25:99',
      '13/45',
      '8',
      '13pm',
      '0am',
      '10/32',
      'feb 30',
      'foo 13',
      'ago',
      'since',
    ])('rejects %j as bad_since', input => {
      expect(codeOf(input)).toBe('bad_since')
    })
  })
})
