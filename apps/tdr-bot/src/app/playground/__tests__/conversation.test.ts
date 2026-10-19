import {
  type AssistantMeta,
  draftOverride,
  formatMeta,
  scoreChips,
  threadReducer,
  toRequestMessages,
  type Turn,
} from 'src/app/playground/conversation'
import type { EmojiAnalysis } from 'src/emojis/emoji-analysis'

const emojis = (overrides: Partial<EmojiAnalysis> = {}): EmojiAnalysis => ({
  counts: { dictionary: 0, hallucinated: 0, unicode: 0, shortcode: 0 },
  dictionary: [],
  hallucinated: [],
  unicode: [],
  shortcodes: [],
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
const assistant = (id: string, content: string): Turn => ({
  id,
  role: 'assistant',
  content,
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
      content: 'hello',
      meta: meta(),
    })
    turns = threadReducer(turns, {
      type: 'error',
      id: 'e1',
      message: 'boom',
      retryOf: 'u1',
    })

    expect(turns.map(t => t.id)).toEqual(['u1', 'a1', 'e1'])
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
  it('omits the hallucinated chip when there are none', () => {
    const chips = scoreChips(
      emojis({
        counts: { dictionary: 2, hallucinated: 0, unicode: 1, shortcode: 0 },
      }),
    )

    expect(chips).toEqual([
      { label: '2 dictionary', tone: 'ok' },
      { label: '1 unicode', tone: 'warn' },
      { label: '0 shortcode', tone: 'muted' },
    ])
  })

  it('lists the raw hallucinated tokens in the chip title', () => {
    const chips = scoreChips(
      emojis({
        counts: { dictionary: 2, hallucinated: 1, unicode: 2, shortcode: 0 },
        hallucinated: [
          {
            raw: '<:PogU:564310072822333499>',
            name: 'PogU',
            id: '564310072822333499',
            animated: false,
            start: 0,
            end: 26,
            reason: 'unknown',
          },
        ],
      }),
    )

    expect(chips[1]).toEqual({
      label: '1 hallucinated',
      tone: 'bad',
      title: '<:PogU:564310072822333499>',
    })
  })
})
