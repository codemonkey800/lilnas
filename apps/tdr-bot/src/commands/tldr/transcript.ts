import dayjs, { extend } from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

import { DISCORD_MAX_MESSAGE_LENGTH } from 'src/constants/chat'
import { REMINDER_TIMEZONE } from 'src/reminders/reminder.constants'

import { MAX_MESSAGE_CHARS, TldrWindow, WindowMessage } from './types'

extend(utc)
extend(timezone)

export interface Transcript {
  text: string
  /** Citation index → message url. */
  links: Map<number, string>
}

/** Most citation links kept when several sit together. */
const MAX_CITATIONS_PER_SPOT = 3

/** Most citation links kept in a whole reply; later citations are dropped. */
const MAX_CITATIONS_TOTAL = 30

export interface CitationBudget {
  remaining: number
}

/** A fresh whole-reply link allowance, shared across a reply's messages. */
export function createCitationBudget(): CitationBudget {
  return { remaining: MAX_CITATIONS_TOTAL }
}

const CONTINUATION_INDENT = '    '

const CITATION = String.raw`\[\d+(?:\s*,\s*\d+)*\](?!\()`
// Citations joined by spaces, commas, or "and" count as one spot, so a
// runaway "[1], [2], [3], …" list collapses instead of linking every index.
const CITATION_RUN = new RegExp(
  `([ \\t]?)${CITATION}(?:[ \\t]*(?:,|and)?[ \\t]*${CITATION})*`,
  'g',
)

/** `text` without `[n]` citations, for judging how much prose it holds. */
export function stripCitations(text: string): string {
  return text.replace(new RegExp(CITATION, 'g'), '')
}

const DAY_KEY = 'YYYY-MM-DD'

export function formatWhen(
  date: Date,
  now: Date = new Date(),
  tz = REMINDER_TIMEZONE,
): string {
  const then = dayjs(date).tz(tz)
  const today = dayjs(now).tz(tz)
  const daysAgo = dayjs
    .utc(today.format(DAY_KEY))
    .diff(dayjs.utc(then.format(DAY_KEY)), 'day')

  if (daysAgo === 0) return then.format('h:mm A')
  if (daysAgo > 0 && daysAgo <= 6) return then.format('ddd h:mm A')
  return then.format('MMM D, h:mm A')
}

function truncate(content: string): string {
  return content.length > MAX_MESSAGE_CHARS
    ? `${content.slice(0, MAX_MESSAGE_CHARS)}…`
    : content
}

function renderMessage(
  message: WindowMessage,
  n: number,
  numbers: Map<string, number>,
  tz: string,
): string {
  const time = dayjs(message.createdAt).tz(tz).format('h:mm A')
  const [first = '', ...rest] = truncate(message.content)
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)

  const suffix: string[] = []
  if (message.replyToId !== null) {
    const target = numbers.get(message.replyToId)
    suffix.push(target === undefined ? '(reply)' : `(reply to [${target}])`)
  }
  for (const name of message.attachments) suffix.push(`[attachment: ${name}]`)
  for (const title of message.embedTitles) suffix.push(`[embed: ${title}]`)

  const head = [first, ...suffix].filter(part => part.length > 0).join(' ')
  const author = message.isBot
    ? `${message.authorName} [bot]`
    : message.authorName
  const lines = [`[${n}] ${time} ${author}: ${head}`.trimEnd()]
  for (const line of rest) lines.push(`${CONTINUATION_INDENT}${line}`)
  return lines.join('\n')
}

/** Splits messages into the parent channel and one group per thread. */
function groupSections(messages: WindowMessage[]): WindowMessage[][] {
  const parent: WindowMessage[] = []
  const threads = new Map<string, WindowMessage[]>()
  for (const message of messages) {
    if (message.threadName === null) {
      parent.push(message)
      continue
    }
    const group = threads.get(message.channelId)
    if (group) group.push(message)
    else threads.set(message.channelId, [message])
  }
  return [parent, ...threads.values()]
}

export function renderTranscript(
  window: TldrWindow,
  tz = REMINDER_TIMEZONE,
): Transcript {
  const now = new Date()
  const sections = groupSections(window.messages)

  const numbers = new Map<string, number>()
  const links = new Map<number, string>()
  let n = 0
  for (const message of sections.flat()) {
    n += 1
    numbers.set(message.id, n)
    links.set(n, message.url)
  }

  const last = window.messages.reduce(
    (latest, message) =>
      message.createdAt > latest ? message.createdAt : latest,
    window.since,
  )
  let header =
    `Channel: #${window.channelName} · ${window.messages.length} messages` +
    ` · ${window.threadCount} threads` +
    ` · window ${formatWhen(window.since, now, tz)} → ${formatWhen(last, now, tz)}`
  if (window.clipped) header += ' · clipped to the newest 1000'

  const lines = [header]
  for (const section of sections) {
    if (section.length === 0) continue
    const threadName = section[0].threadName
    if (threadName !== null) lines.push('', `== thread: ${threadName} ==`)

    let day = ''
    for (const message of section) {
      const messageDay = dayjs(message.createdAt).tz(tz).format('ddd MMM D')
      if (messageDay !== day) {
        day = messageDay
        lines.push(`== ${day} ==`)
      }
      lines.push(renderMessage(message, numbers.get(message.id)!, numbers, tz))
    }
  }

  return { text: lines.join('\n'), links }
}

export function linkifyCitations(
  output: string,
  links: Map<number, string>,
  budget: CitationBudget = createCitationBudget(),
): string {
  return output.replace(CITATION_RUN, (run: string, lead: string) => {
    const seen = new Set<number>()
    for (const digits of run.match(/\d+/g) ?? []) {
      const index = Number(digits)
      if (links.has(index)) seen.add(index)
    }
    const kept = [...seen]
      .slice(0, Math.min(MAX_CITATIONS_PER_SPOT, budget.remaining))
      .map(index => `[↗](<${links.get(index)}>)`)
    budget.remaining -= kept.length
    return kept.length > 0 ? `${lead}${kept.join(' ')}` : ''
  })
}

/**
 * Index to cut `text` at (chunk is `text.slice(0, index)`), or -1. Prefers the
 * coarsest break in the back half of the limit, so a short header ahead of one
 * long paragraph is not stranded alone; falls back to any break past the start.
 */
function findBreak(text: string, limit: number): number {
  const separators = ['\n\n', '\n', ' ']
  for (const min of [limit / 2, 0]) {
    for (const separator of separators) {
      const index = text.lastIndexOf(separator, limit)
      if (index > min) return index
    }
  }
  return -1
}

export function splitForDiscord(
  text: string,
  limit = DISCORD_MAX_MESSAGE_LENGTH,
): string[] {
  const chunks: string[] = []
  let rest = text

  while (rest.length > limit) {
    let index = findBreak(rest, limit)
    if (index === -1) {
      index = limit
      // Don't split a surrogate pair.
      const code = rest.charCodeAt(index - 1)
      if (limit > 1 && code >= 0xd800 && code <= 0xdbff) index -= 1
    }
    const chunk = rest.slice(0, index).trimEnd()
    if (chunk.length > 0) chunks.push(chunk)
    rest = rest.slice(index).trimStart()
  }

  if (rest.trim().length > 0) chunks.push(rest)
  return chunks
}

/**
 * Fits `messages` to Discord's limit while keeping the model's own breaks.
 * A message over `limit` is split at its natural breaks; the leftover tail
 * joins the next message only when the two fit together, otherwise it stands
 * alone. Nothing is ever pushed further down, so one long message moves at
 * most its own tail and never reshuffles the messages after it.
 */
export function reflowForDiscord(
  messages: string[],
  limit = DISCORD_MAX_MESSAGE_LENGTH,
): string[] {
  const out: string[] = []
  let carry = ''

  for (const message of messages) {
    let text = message
    if (carry.length > 0) {
      const merged = `${carry}\n\n${message}`
      if (merged.length <= limit) text = merged
      else out.push(carry)
      carry = ''
    }

    const pieces = splitForDiscord(text, limit)
    if (pieces.length > 1) carry = pieces.pop() ?? ''
    out.push(...pieces)
  }

  if (carry.length > 0) out.push(carry)
  return out
}
