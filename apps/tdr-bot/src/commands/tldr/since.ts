import dayjs, { extend } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import { REMINDER_TIMEZONE } from 'src/reminders/reminder.constants'

import { TldrError } from './types'

extend(utc)
extend(timezone)
extend(customParseFormat)

const LOCAL_FORMAT = 'YYYY-MM-DD HH:mm'

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

const UNIT_MS: Record<string, number> = {
  m: MINUTE_MS,
  min: MINUTE_MS,
  mins: MINUTE_MS,
  minute: MINUTE_MS,
  minutes: MINUTE_MS,
  h: HOUR_MS,
  hr: HOUR_MS,
  hrs: HOUR_MS,
  hour: HOUR_MS,
  hours: HOUR_MS,
  d: DAY_MS,
  day: DAY_MS,
  days: DAY_MS,
  w: WEEK_MS,
  wk: WEEK_MS,
  wks: WEEK_MS,
  week: WEEK_MS,
  weeks: WEEK_MS,
}

const DISCORD_TIMESTAMP_RE = /^<t:(-?\d{1,12})(?::[a-z])?>$/
const DURATION_RE = /^(?:(\d{1,4})\s*|an?\s+)([a-z]+)$/
const CLOCK_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
const NUMERIC_DATE_RE =
  /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?:\s+(?:at\s+)?(.+))?$/
const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(?:at\s+)?(.+))?$/
const NAMED_DATE_RE =
  /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?:\s+(?:at\s+)?(.+))?$/

interface Clock {
  hour: number
  minute: number
}

interface DateParts {
  year: number
  month: number
  day: number
}

/** Named days and their fixed times, relative to today in the user's zone. */
const WORDS: Record<string, { dayOffset: number; clock: Clock }> = {
  today: { dayOffset: 0, clock: { hour: 0, minute: 0 } },
  yesterday: { dayOffset: -1, clock: { hour: 0, minute: 0 } },
  tomorrow: { dayOffset: 1, clock: { hour: 0, minute: 0 } },
  'this morning': { dayOffset: 0, clock: { hour: 6, minute: 0 } },
  'last night': { dayOffset: -1, clock: { hour: 20, minute: 0 } },
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** The local wall-clock moment in `tz`, or null when the date does not exist. */
function localMoment(
  { year, month, day }: DateParts,
  { hour, minute }: Clock,
  tz: string,
): Date | null {
  const text = `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`
  if (!dayjs.utc(text, LOCAL_FORMAT, true).isValid()) return null
  return dayjs.tz(text, LOCAL_FORMAT, tz).toDate()
}

function partsIn(date: Date, tz: string): DateParts {
  const local = dayjs(date).tz(tz)
  return { year: local.year(), month: local.month() + 1, day: local.date() }
}

function shiftDays({ year, month, day }: DateParts, delta: number): DateParts {
  const shifted = new Date(Date.UTC(year, month - 1, day + delta))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function parseClock(text: string): Clock | null {
  if (text === 'noon') return { hour: 12, minute: 0 }
  if (text === 'midnight') return { hour: 0, minute: 0 }

  const match = CLOCK_RE.exec(text)
  if (!match) return null
  const [, hourText, minuteText, meridiem] = match
  // A bare number like "8" is too ambiguous to read as a time.
  if (minuteText === undefined && meridiem === undefined) return null

  const hour = Number(hourText)
  const minute = minuteText === undefined ? 0 : Number(minuteText)
  if (minute > 59) return null

  if (meridiem === undefined) {
    return hour <= 23 ? { hour, minute } : null
  }
  if (hour < 1 || hour > 12) return null
  return { hour: (hour % 12) + (meridiem === 'pm' ? 12 : 0), minute }
}

function parseDiscordTimestamp(text: string): Date | null {
  const match = DISCORD_TIMESTAMP_RE.exec(text)
  return match ? new Date(Number(match[1]) * 1000) : null
}

function parseWord(text: string, now: Date, tz: string): Date | null {
  const word = WORDS[text]
  if (!word) return null
  return localMoment(
    shiftDays(partsIn(now, tz), word.dayOffset),
    word.clock,
    tz,
  )
}

function parseDuration(text: string, now: Date): Date | null {
  const match = DURATION_RE.exec(text)
  if (!match) return null
  const unitMs = UNIT_MS[match[2]]
  if (unitMs === undefined) return null
  const count = match[1] === undefined ? 1 : Number(match[1])
  return new Date(now.getTime() - count * unitMs)
}

function parseClockToday(text: string, now: Date, tz: string): Date | null {
  const clock = parseClock(text)
  if (!clock) return null
  const today = partsIn(now, tz)
  const moment = localMoment(today, clock, tz)
  if (!moment || moment.getTime() <= now.getTime()) return moment
  return localMoment(shiftDays(today, -1), clock, tz)
}

function parseMonthName(word: string): number | null {
  if (word === 'sept') return 9
  const index = MONTHS.findIndex(month => month.startsWith(word))
  // Three letters is the shortest unambiguous form ("mar" vs "may").
  return index === -1 || word.length < 3 ? null : index + 1
}

/** Resolve a month/day, with or without a year, plus an optional clock time. */
function resolveDate(
  month: number,
  day: number,
  yearText: string | undefined,
  clockText: string | undefined,
  now: Date,
  tz: string,
): Date | null {
  let clock: Clock = { hour: 0, minute: 0 }
  if (clockText !== undefined) {
    const parsed = parseClock(clockText.trim())
    if (!parsed) return null
    clock = parsed
  }

  if (yearText !== undefined) {
    const year =
      yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
    return localMoment({ year, month, day }, clock, tz)
  }

  const thisYear = partsIn(now, tz).year
  const candidate = localMoment({ year: thisYear, month, day }, clock, tz)
  if (candidate && candidate.getTime() > now.getTime()) {
    return localMoment({ year: thisYear - 1, month, day }, clock, tz)
  }
  return candidate
}

function parseDate(text: string, now: Date, tz: string): Date | null {
  const numeric = NUMERIC_DATE_RE.exec(text)
  if (numeric) {
    const [, month, day, year, clock] = numeric
    return resolveDate(Number(month), Number(day), year, clock, now, tz)
  }

  const iso = ISO_DATE_RE.exec(text)
  if (iso) {
    const [, year, month, day, clock] = iso
    return resolveDate(Number(month), Number(day), year, clock, now, tz)
  }

  const named = NAMED_DATE_RE.exec(text)
  if (named) {
    const [, monthWord, day, year, clock] = named
    const month = parseMonthName(monthWord)
    if (month === null) return null
    return resolveDate(month, Number(day), year, clock, now, tz)
  }

  return null
}

function resolve(input: string, now: Date, tz: string): Date | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^since\s+/, '')
    .replace(/\s+ago$/, '')

  return (
    parseDiscordTimestamp(text) ??
    parseWord(text, now, tz) ??
    parseDuration(text, now) ??
    parseClockToday(text, now, tz) ??
    parseDate(text, now, tz)
  )
}

/**
 * Deterministically parse the `/tldr since` option into an instant. Clock
 * times, words and dates are read in `tz`. Throws `TldrError('bad_since')` for
 * input it cannot read and `TldrError('future_since')` for a result after
 * `now`.
 */
export function parseSince(
  input: string,
  now: Date = new Date(),
  tz: string = REMINDER_TIMEZONE,
): Date {
  const result = resolve(input, now, tz)
  if (!result || Number.isNaN(result.getTime())) {
    throw new TldrError('bad_since', `Could not read "${input}" as a time`)
  }
  if (result.getTime() > now.getTime()) {
    throw new TldrError('future_since', `"${input}" is in the future`)
  }
  return result
}
