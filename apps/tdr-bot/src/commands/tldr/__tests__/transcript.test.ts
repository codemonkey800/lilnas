import {
  formatWhen,
  linkifyCitations,
  renderTranscript,
  splitForDiscord,
} from 'src/commands/tldr/transcript'
import {
  MAX_MESSAGE_CHARS,
  TldrWindow,
  WindowMessage,
} from 'src/commands/tldr/types'

const TZ = 'America/Los_Angeles'
const BASE = 'https://discord.com/channels/g1'

function msg(
  id: string,
  iso: string,
  overrides: Partial<WindowMessage> = {},
): WindowMessage {
  return {
    id,
    channelId: 'c1',
    threadName: null,
    authorId: 'u1',
    authorName: 'alice',
    isBot: false,
    createdAt: new Date(iso),
    content: `message ${id}`,
    attachments: [],
    embedTitles: [],
    replyToId: null,
    url: `${BASE}/${overrides.channelId ?? 'c1'}/${id}`,
    ...overrides,
  }
}

function makeWindow(): TldrWindow {
  return {
    guildId: 'g1',
    channelId: 'c1',
    channelName: 'general',
    since: new Date('2026-10-12T18:00:00Z'), // Mon 11:00 AM PDT
    sinceSource: 'option',
    messages: [
      msg('m1', '2026-10-12T18:00:00Z'),
      msg('m2', '2026-10-12T18:05:00Z', {
        authorName: 'helper',
        isBot: true,
        replyToId: 'm1',
      }),
      msg('m3', '2026-10-13T16:30:00Z', {
        replyToId: 'old-message',
        attachments: ['cat.png'],
        embedTitles: ['A page'],
      }),
      msg('t1', '2026-10-13T17:00:00Z', {
        channelId: 't1c',
        threadName: 'side quest',
      }),
      msg('m4', '2026-10-13T17:30:00Z', {
        content: 'line one\nline two\nline three',
      }),
      msg('m5', '2026-10-13T18:00:00Z', {
        content: 'x'.repeat(MAX_MESSAGE_CHARS + 50),
      }),
    ],
    threadCount: 1,
    clipped: false,
  }
}

describe('renderTranscript', () => {
  const { text, links } = renderTranscript(makeWindow(), TZ)
  const lines = text.split('\n')

  it('writes the header line', () => {
    expect(lines[0]).toMatch(
      /^Channel: #general · 6 messages · 1 threads · window .+ → .+$/,
    )
    expect(lines[0]).not.toContain('clipped')
  })

  it('notes when the window was clipped', () => {
    const clipped = renderTranscript({ ...makeWindow(), clipped: true }, TZ)
    expect(clipped.text.split('\n')[0]).toMatch(
      / · clipped to the newest 1000$/,
    )
  })

  it('inserts a marker when the day changes', () => {
    expect(lines).toContain('== Mon Oct 12 ==')
    expect(lines).toContain('== Tue Oct 13 ==')
    expect(lines.indexOf('== Mon Oct 12 ==')).toBeLessThan(
      lines.indexOf('== Tue Oct 13 =='),
    )
  })

  it('numbers messages and flags bots', () => {
    expect(text).toContain('[1] 11:00 AM alice: message m1')
    expect(text).toContain('[2] 11:05 AM helper [bot]: message m2')
  })

  it('marks replies inside and outside the window', () => {
    expect(text).toContain('(reply to [1])')
    expect(text).toMatch(/\[3\] 9:30 AM alice: message m3 \(reply\) /)
  })

  it('lists attachments and embeds', () => {
    expect(text).toContain('[attachment: cat.png] [embed: A page]')
  })

  it('puts the thread after the channel and keeps numbering going', () => {
    const heading = lines.indexOf('== thread: side quest ==')
    expect(heading).toBeGreaterThan(lines.findIndex(l => l.startsWith('[5]')))
    expect(lines.slice(heading).join('\n')).toContain(
      '[6] 10:00 AM alice: message t1',
    )
    expect(lines[heading + 1]).toBe('== Tue Oct 13 ==')
  })

  it('indents continuation lines by four spaces', () => {
    expect(text).toContain(
      '[4] 10:30 AM alice: line one\n    line two\n    line three',
    )
  })

  it('cuts over-long content with an ellipsis', () => {
    expect(text).toContain(`${'x'.repeat(MAX_MESSAGE_CHARS)}…`)
    expect(text).not.toContain('x'.repeat(MAX_MESSAGE_CHARS + 1))
  })

  it('maps every number to its message url', () => {
    expect(links.size).toBe(6)
    expect(links.get(1)).toBe(`${BASE}/c1/m1`)
    expect(links.get(6)).toBe(`${BASE}/t1c/t1`)
  })

  it('handles an empty window', () => {
    const empty = renderTranscript(
      { ...makeWindow(), messages: [], threadCount: 0 },
      TZ,
    )
    expect(empty.links.size).toBe(0)
    expect(empty.text).toMatch(/^Channel: #general · 0 messages/)
  })
})

describe('linkifyCitations', () => {
  const links = new Map([
    [1, 'https://x/1'],
    [2, 'https://x/2'],
    [3, 'https://x/3'],
    [4, 'https://x/4'],
    [5, 'https://x/5'],
  ])

  it('replaces a single citation', () => {
    expect(linkifyCitations('They agreed [2].', links)).toBe(
      'They agreed [↗](<https://x/2>).',
    )
  })

  it('expands comma lists', () => {
    expect(linkifyCitations('Plans [1, 3]', links)).toBe(
      'Plans [↗](<https://x/1>) [↗](<https://x/3>)',
    )
  })

  it('drops unknown indexes', () => {
    expect(linkifyCitations('Said so [9] today', links)).toBe('Said so today')
    expect(linkifyCitations('Said [1, 9]', links)).toBe(
      'Said [↗](<https://x/1>)',
    )
  })

  it('leaves other bracketed text alone', () => {
    const input = 'The [bot] and [docs](https://a.b) and [1](https://c.d)'
    expect(linkifyCitations(input, links)).toBe(input)
  })

  it('collapses more than three citations to the first three', () => {
    expect(linkifyCitations('Lots [1][2][3][4][5].', links)).toBe(
      'Lots [↗](<https://x/1>) [↗](<https://x/2>) [↗](<https://x/3>).',
    )
    expect(linkifyCitations('Lots [1, 2, 3, 4]', links)).toBe(
      'Lots [↗](<https://x/1>) [↗](<https://x/2>) [↗](<https://x/3>)',
    )
  })
})

describe('splitForDiscord', () => {
  it('returns one chunk when under the limit', () => {
    expect(splitForDiscord('hello', 20)).toEqual(['hello'])
  })

  it('prefers a paragraph break', () => {
    expect(splitForDiscord('aaaa bbbb\n\ncccc\ndddd eeee', 16)).toEqual([
      'aaaa bbbb',
      'cccc\ndddd eeee',
    ])
  })

  it('falls back to a line break, then a space', () => {
    expect(splitForDiscord('aaaa bbbb\ncccc dddd', 14)).toEqual([
      'aaaa bbbb',
      'cccc dddd',
    ])
    expect(splitForDiscord('aaaa bbbb cccc', 10)).toEqual(['aaaa bbbb', 'cccc'])
  })

  it('hard-cuts a single long token', () => {
    expect(splitForDiscord('x'.repeat(25), 10)).toEqual([
      'x'.repeat(10),
      'x'.repeat(10),
      'x'.repeat(5),
    ])
  })

  it('keeps every chunk within the limit and never empty', () => {
    const text = `${'word '.repeat(300)}\n\n\n\n${'y'.repeat(500)}\n\n`
    const chunks = splitForDiscord(text, 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0)
      expect(chunk.length).toBeLessThanOrEqual(100)
    }
  })

  it('does not split a surrogate pair', () => {
    const chunks = splitForDiscord('😀'.repeat(6), 5)
    expect(chunks.join('')).toBe('😀'.repeat(6))
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(5)
  })
})

describe('formatWhen', () => {
  const now = new Date('2026-10-14T20:00:00Z') // Wed 1:00 PM PDT

  it('shows only the time for today', () => {
    expect(formatWhen(new Date('2026-10-14T16:05:00Z'), now, TZ)).toBe(
      '9:05 AM',
    )
  })

  it('adds the weekday within the last 6 days', () => {
    expect(formatWhen(new Date('2026-10-13T16:05:00Z'), now, TZ)).toBe(
      'Tue 9:05 AM',
    )
    expect(formatWhen(new Date('2026-10-08T16:05:00Z'), now, TZ)).toBe(
      'Thu 9:05 AM',
    )
  })

  it('uses the date beyond that', () => {
    expect(formatWhen(new Date('2026-10-07T16:05:00Z'), now, TZ)).toBe(
      'Oct 7, 9:05 AM',
    )
  })

  it('uses the calendar day in the given timezone', () => {
    // 03:00 UTC on the 14th is still the 13th in Los Angeles.
    expect(formatWhen(new Date('2026-10-14T03:00:00Z'), now, TZ)).toBe(
      'Tue 8:00 PM',
    )
  })
})
