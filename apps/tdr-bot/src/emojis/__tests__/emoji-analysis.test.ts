import {
  analyzeEmojis,
  formatEmojiScore,
  segmentCustomEmojis,
} from 'src/emojis/emoji-analysis'

const EZ = '<:EZ:758414734805696553>'
const WINE = '<a:peepoWine:1266528661318926369>'
const DICTIONARY = [EZ, WINE, 'not a key', '<:x:1>']

describe('segmentCustomEmojis', () => {
  it('returns no segments for empty text', () => {
    expect(segmentCustomEmojis('')).toEqual([])
  })

  it('returns one text run when there are no custom emojis', () => {
    expect(segmentCustomEmojis('hello :wave: 👋')).toEqual([
      { kind: 'text', text: 'hello :wave: 👋' },
    ])
  })

  it('splits text and emoji tokens in order with offsets', () => {
    const input = `hi ${EZ}${WINE} bye`
    expect(segmentCustomEmojis(input)).toEqual([
      { kind: 'text', text: 'hi ' },
      {
        kind: 'emoji',
        emoji: {
          raw: EZ,
          name: 'EZ',
          id: '758414734805696553',
          animated: false,
          start: 3,
          end: 3 + EZ.length,
        },
      },
      {
        kind: 'emoji',
        emoji: {
          raw: WINE,
          name: 'peepoWine',
          id: '1266528661318926369',
          animated: true,
          start: 3 + EZ.length,
          end: 3 + EZ.length + WINE.length,
        },
      },
      { kind: 'text', text: ' bye' },
    ])
  })

  it('round-trips: joining segments reproduces the input and offsets match', () => {
    const input = `${EZ} start, middle ${WINE}${WINE} end ${EZ}`
    const segments = segmentCustomEmojis(input)
    const joined = segments
      .map(s => (s.kind === 'text' ? s.text : s.emoji.raw))
      .join('')
    expect(joined).toBe(input)
    for (const segment of segments) {
      if (segment.kind === 'text') expect(segment.text).not.toBe('')
      else {
        expect(input.slice(segment.emoji.start, segment.emoji.end)).toBe(
          segment.emoji.raw,
        )
      }
    }
  })

  it('leaves malformed tokens in the text', () => {
    expect(segmentCustomEmojis('<:EZ:1> <:a:758414734805696553>')).toEqual([
      { kind: 'text', text: '<:EZ:1> <:a:758414734805696553>' },
    ])
  })
})

describe('analyzeEmojis', () => {
  it('returns zero counts and empty lists for text without emojis', () => {
    expect(analyzeEmojis('just words', DICTIONARY)).toEqual({
      counts: { dictionary: 0, hallucinated: 0, unicode: 0, shortcode: 0 },
      dictionary: [],
      hallucinated: [],
      unicode: [],
      shortcodes: [],
    })
  })

  it('handles empty text', () => {
    expect(analyzeEmojis('', DICTIONARY).counts).toEqual({
      dictionary: 0,
      hallucinated: 0,
      unicode: 0,
      shortcode: 0,
    })
  })

  it('classifies both static and animated dictionary keys', () => {
    const result = analyzeEmojis(`${EZ} ${WINE}`, DICTIONARY)
    expect(result.counts.dictionary).toBe(2)
    expect(result.dictionary.map(e => e.raw)).toEqual([EZ, WINE])
    expect(result.dictionary.map(e => e.animated)).toEqual([false, true])
    expect(result.hallucinated).toEqual([])
  })

  it('flags an unknown token', () => {
    const result = analyzeEmojis('<:nope:111111111111111111>', DICTIONARY)
    expect(result.counts.hallucinated).toBe(1)
    expect(result.hallucinated[0]).toMatchObject({
      name: 'nope',
      id: '111111111111111111',
      reason: 'unknown',
    })
  })

  it('flags a known id used under another name', () => {
    const result = analyzeEmojis('<:EZClap:758414734805696553>', DICTIONARY)
    expect(result.hallucinated).toHaveLength(1)
    expect(result.hallucinated[0].reason).toBe('name-mismatch')
  })

  it('flags a known id under another name even when the animated flag differs too', () => {
    const result = analyzeEmojis('<a:EZClap:758414734805696553>', DICTIONARY)
    expect(result.hallucinated[0].reason).toBe('name-mismatch')
  })

  it('flags the wrong animated prefix in both directions', () => {
    const staticAsAnimated = analyzeEmojis(
      '<a:EZ:758414734805696553>',
      DICTIONARY,
    )
    expect(staticAsAnimated.hallucinated[0]).toMatchObject({
      animated: true,
      reason: 'animated-mismatch',
    })

    const animatedAsStatic = analyzeEmojis(
      '<:peepoWine:1266528661318926369>',
      DICTIONARY,
    )
    expect(animatedAsStatic.hallucinated[0]).toMatchObject({
      animated: false,
      reason: 'animated-mismatch',
    })
  })

  it('counts repeated emojis each time they appear', () => {
    const result = analyzeEmojis(`${EZ}${EZ} 👍 👍 :kek: :kek:`, DICTIONARY)
    expect(result.counts).toEqual({
      dictionary: 2,
      hallucinated: 0,
      unicode: 2,
      shortcode: 2,
    })
  })

  it('analyzes a reply with all four kinds at once', () => {
    const text = `lmao ${EZ} that's :kek: 🔥🔥 <:fake:222222222222222222> ${WINE}`
    const result = analyzeEmojis(text, DICTIONARY)
    expect(result.counts).toEqual({
      dictionary: 2,
      hallucinated: 1,
      unicode: 2,
      shortcode: 1,
    })
    expect(result.dictionary.map(e => e.raw)).toEqual([EZ, WINE])
    expect(result.hallucinated.map(e => e.reason)).toEqual(['unknown'])
    expect(result.unicode).toEqual(['🔥', '🔥'])
    expect(result.shortcodes).toEqual(['kek'])
    expect(result.counts.dictionary).toBe(result.dictionary.length)
    expect(result.counts.hallucinated).toBe(result.hallucinated.length)
    expect(result.counts.unicode).toBe(result.unicode.length)
    expect(result.counts.shortcode).toBe(result.shortcodes.length)
  })

  it('ignores dictionary keys that do not parse', () => {
    const result = analyzeEmojis('<:x:1> not a key', ['not a key', '<:x:1>'])
    expect(result.counts).toEqual({
      dictionary: 0,
      hallucinated: 0,
      unicode: 0,
      shortcode: 0,
    })
  })

  it('accepts any iterable of keys', () => {
    const result = analyzeEmojis(EZ, new Set([EZ]))
    expect(result.counts.dictionary).toBe(1)
  })

  describe('shortcodes', () => {
    it('matches bare :name: occurrences', () => {
      expect(analyzeEmojis('ok :thumbsup: and :Pog_2:', []).shortcodes).toEqual(
        ['thumbsup', 'Pog_2'],
      )
    })

    it('does not match times, URLs or custom tokens', () => {
      const result = analyzeEmojis(
        'at 12:30:45 see https://x and <:EZ:1> or :EZ:1',
        [],
      )
      expect(result.shortcodes).toEqual([])
    })

    it('never scans inside a custom emoji token', () => {
      expect(analyzeEmojis(`${EZ}${WINE}`, DICTIONARY).shortcodes).toEqual([])
    })

    it('requires a letter first and at least two characters', () => {
      expect(analyzeEmojis(':1abc: :a: :ab:', []).shortcodes).toEqual(['ab'])
    })
  })

  describe('unicode', () => {
    it('counts a ZWJ family sequence once', () => {
      expect(analyzeEmojis('👨‍👩‍👧', []).unicode).toEqual(['👨‍👩‍👧'])
    })

    it('counts a skin-tone modified emoji once', () => {
      expect(analyzeEmojis('👍🏽', []).unicode).toEqual(['👍🏽'])
    })

    it('keeps the VS16 selector with its base', () => {
      expect(analyzeEmojis('❤️ and ☺️', []).unicode).toEqual(['❤️', '☺️'])
    })

    it('counts a regional indicator pair as one flag', () => {
      expect(analyzeEmojis('🇺🇸🇯🇵', []).unicode).toEqual(['🇺🇸', '🇯🇵'])
    })

    it('excludes ©, ® and ™', () => {
      expect(analyzeEmojis('Acme© Widgets® Inc™', []).unicode).toEqual([])
    })

    it('counts separate emojis separately', () => {
      expect(analyzeEmojis('🔥😂🔥', []).unicode).toEqual(['🔥', '😂', '🔥'])
    })
  })
})

describe('formatEmojiScore', () => {
  it('formats zero counts', () => {
    expect(
      formatEmojiScore({
        dictionary: 0,
        hallucinated: 0,
        unicode: 0,
        shortcode: 0,
      }),
    ).toBe('0 dictionary · 0 hallucinated · 0 unicode · 0 shortcode')
  })

  it('formats one of each', () => {
    expect(
      formatEmojiScore({
        dictionary: 1,
        hallucinated: 1,
        unicode: 1,
        shortcode: 1,
      }),
    ).toBe('1 dictionary · 1 hallucinated · 1 unicode · 1 shortcode')
  })

  it('formats many', () => {
    expect(
      formatEmojiScore({
        dictionary: 5,
        hallucinated: 1,
        unicode: 2,
        shortcode: 0,
      }),
    ).toBe('5 dictionary · 1 hallucinated · 2 unicode · 0 shortcode')
  })
})
