import {
  type AssistantMeta,
  draftOverride,
  formatMeta,
  scoreChips,
  threadReducer,
  toRequestMessages,
  type Turn,
} from 'src/app/playground/conversation'
import type { EmojiAnalysis, ResolvedEmoji } from 'src/emojis/emoji-analysis'

const emojis = (overrides: Partial<EmojiAnalysis> = {}): EmojiAnalysis => ({
  counts: { dictionary: 0, repaired: 0, hallucinated: 0, unicode: 0 },
  dictionary: [],
  repaired: [],
  hallucinated: [],
  unicode: [],
  ...overrides,
})

const meta = (overrides: Partial<AssistantMeta> = {}): AssistantMeta => ({
  model: 'gpt-5-mini',
  costUsd: 0.0042,
  durationMs: 1800,
  emojis: emojis(),
  ...overrides,
})

const user = (id: string, content: string): Turn => ({
  id,
  role: 'user',
  content,
})
const assistant = (id: string, content: string, raw = content): Turn => ({
  id,
  role: 'assistant',
  content,
  raw,
  meta: meta(),
})
const error = (id: string, retryOf: string): Turn => ({
  id,
  role: 'error',
  message: 'gpt-5 timed out after 90 s',
  retryOf,
})

describe('toRequestMessages', () => {
  it('keeps user and assistant turns in order and drops errors', () => {
    expect(
      toRequestMessages([
        user('u1', 'hi'),
        assistant('a1', 'hello'),
        user('u2', 'again'),
        error('e1', 'u2'),
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ])
  })

  it('sends the raw output for assistant turns, not the resolved content', () => {
    expect(
      toRequestMessages([
        user('u1', 'hi'),
        assistant('a1', 'hello <:EZ:758414734805696553>', 'hello :EZ:'),
      ]),
    ).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello :EZ:' },
    ])
  })
})

describe('threadReducer', () => {
  const failed: Turn[] = [
    user('u1', 'hi'),
    assistant('a1', 'hello'),
    user('u2', 'again'),
    error('e1', 'u2'),
  ]

  it('appends user, assistant and error turns', () => {
    let turns = threadReducer([], { type: 'user', id: 'u1', content: 'hi' })
    turns = threadReducer(turns, {
      type: 'assistant',
      id: 'a1',
      content: 'hello <:EZ:758414734805696553>',
      raw: 'hello :EZ:',
      meta: meta(),
    })
    turns = threadReducer(turns, {
      type: 'error',
      id: 'e1',
      message: 'boom',
      retryOf: 'u1',
    })

    expect(turns.map(t => t.id)).toEqual(['u1', 'a1', 'e1'])
    expect(turns[1]).toMatchObject({
      content: 'hello <:EZ:758414734805696553>',
      raw: 'hello :EZ:',
    })
    expect(turns[2]).toMatchObject({ role: 'error', retryOf: 'u1' })
  })

  it('retry drops only the error so the same history is re-sent', () => {
    const before = toRequestMessages(failed)
    const turns = threadReducer(failed, { type: 'retry', id: 'e1' })

    expect(turns.map(t => t.id)).toEqual(['u1', 'a1', 'u2'])
    expect(toRequestMessages(turns)).toEqual(before)
  })

  it('a new message after a failure replaces the failed attempt', () => {
    const turns = threadReducer(failed, {
      type: 'user',
      id: 'u3',
      content: 'edited',
    })

    expect(toRequestMessages(turns)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'edited' },
    ])
  })

  it('reset clears everything', () => {
    expect(threadReducer(failed, { type: 'reset' })).toEqual([])
  })
})

describe('draftOverride', () => {
  it('is undefined when the draft matches the saved prompt', () => {
    expect(draftOverride('saved', 'saved')).toBeUndefined()
  })

  it('is the draft when it differs', () => {
    expect(draftOverride('saved + more', 'saved')).toBe('saved + more')
  })
})

describe('formatMeta', () => {
  it('formats cost to 4 dp and seconds to 1 dp', () => {
    expect(formatMeta(meta())).toBe('gpt-5-mini · $0.0042 · 1.8 s')
  })

  it('shows tiny costs as < $0.0001 and zero as $0.0000', () => {
    expect(formatMeta(meta({ costUsd: 0.00004 }))).toBe(
      'gpt-5-mini · < $0.0001 · 1.8 s',
    )
    expect(formatMeta(meta({ costUsd: 0 }))).toBe(
      'gpt-5-mini · $0.0000 · 1.8 s',
    )
  })

  it('shows sub-second durations in ms', () => {
    expect(formatMeta(meta({ durationMs: 820 }))).toBe(
      'gpt-5-mini · $0.0042 · 820 ms',
    )
    expect(formatMeta(meta({ durationMs: 1000 }))).toBe(
      'gpt-5-mini · $0.0042 · 1.0 s',
    )
  })
})

describe('scoreChips', () => {
  const pogu = (overrides: Partial<ResolvedEmoji> = {}): ResolvedEmoji => ({
    raw: '<:PogU:564310072822333499>',
    form: 'token',
    name: 'PogU',
    start: 0,
    end: 26,
    key: null,
    status: 'dropped',
    fixes: [],
    ...overrides,
  })

  it('shows only dictionary and unicode when nothing was repaired or dropped', () => {
    const chips = scoreChips(
      emojis({
        counts: { dictionary: 2, repaired: 0, hallucinated: 0, unicode: 1 },
      }),
    )

    expect(chips).toEqual([
      { label: '2 dictionary', tone: 'ok' },
      { label: '1 unicode', tone: 'warn' },
    ])
  })

  it('lists raw → key for each repaired ref in the chip title', () => {
    const chips = scoreChips(
      emojis({
        counts: { dictionary: 0, repaired: 2, hallucinated: 0, unicode: 0 },
        repaired: [
          pogu({
            raw: ':PogU:',
            form: 'shortcode',
            key: '<:PogU:564310072822333499>',
            status: 'repaired',
          }),
          pogu({
            raw: '<:pogu:564310072822333499>',
            name: 'pogu',
            key: '<:PogU:564310072822333499>',
            status: 'repaired',
            fixes: ['case'],
          }),
        ],
      }),
    )

    expect(chips).toEqual([
      { label: '0 dictionary', tone: 'ok' },
      {
        label: '2 repaired',
        tone: 'warn',
        title:
          ':PogU: → <:PogU:564310072822333499>, <:pogu:564310072822333499> → <:PogU:564310072822333499>',
      },
      { label: '0 unicode', tone: 'warn' },
    ])
  })

  it('lists the raw hallucinated refs in the chip title', () => {
    const chips = scoreChips(
      emojis({
        counts: { dictionary: 2, repaired: 0, hallucinated: 2, unicode: 2 },
        hallucinated: [pogu(), pogu({ raw: ':kek:', form: 'shortcode' })],
      }),
    )

    expect(chips).toEqual([
      { label: '2 dictionary', tone: 'ok' },
      {
        label: '2 hallucinated',
        tone: 'bad',
        title: '<:PogU:564310072822333499> :kek:',
      },
      { label: '2 unicode', tone: 'warn' },
    ])
  })

  it('orders repaired before hallucinated', () => {
    const chips = scoreChips(
      emojis({
        counts: { dictionary: 1, repaired: 1, hallucinated: 1, unicode: 0 },
        repaired: [
          pogu({ status: 'repaired', key: '<:PogU:564310072822333499>' }),
        ],
        hallucinated: [pogu()],
      }),
    )

    expect(chips.map(c => c.label)).toEqual([
      '1 dictionary',
      '1 repaired',
      '1 hallucinated',
      '0 unicode',
    ])
  })
})
