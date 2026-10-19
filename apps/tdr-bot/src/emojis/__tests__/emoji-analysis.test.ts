import {
  analyzeEmojis,
  formatEmojiScore,
  resolveEmojis,
  segmentCustomEmojis,
} from 'src/emojis/emoji-analysis'

const EZ = '<:EZ:758414734805696553>'
const WINE = '<a:peepoWine:1266528661318926369>'

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
  const COZY = '<:peepoCozy:781403748580589598>'
  const KEYS = [EZ, WINE, COZY, 'not a key', '<:x:1>']
  const EMPTY_COUNTS = {
    dictionary: 0,
    repaired: 0,
    hallucinated: 0,
    unicode: 0,
  }

  it('returns zero counts and empty lists for text without emojis', () => {
    expect(analyzeEmojis('just words', KEYS)).toEqual({
      counts: EMPTY_COUNTS,
      dictionary: [],
      repaired: [],
      hallucinated: [],
      unicode: [],
    })
  })

  it('handles empty text', () => {
    expect(analyzeEmojis('', KEYS).counts).toEqual(EMPTY_COUNTS)
  })

  it('counts both static and animated dictionary keys as dictionary', () => {
    const result = analyzeEmojis(`${EZ} ${WINE}`, KEYS)

    expect(result.counts).toEqual({ ...EMPTY_COUNTS, dictionary: 2 })
    expect(result.dictionary.map(e => e.raw)).toEqual([EZ, WINE])
    expect(result.dictionary.every(e => e.status === 'dictionary')).toBe(true)
  })

  it('counts an exact :name: shortcode as dictionary (the incident)', () => {
    const result = analyzeEmojis('so cozy :peepoCozy:', KEYS)

    expect(result.counts).toEqual({ ...EMPTY_COUNTS, dictionary: 1 })
    expect(result.dictionary[0]).toMatchObject({
      raw: ':peepoCozy:',
      form: 'shortcode',
      key: COZY,
    })
  })

  it('counts wrong-case, wrong-id and wrong-flag tokens as repaired', () => {
    const result = analyzeEmojis(
      '<:peepocozy:781403748580589598> <:EZ:111111111111111111> <:peepoWine:1266528661318926369>',
      KEYS,
    )

    expect(result.counts).toEqual({ ...EMPTY_COUNTS, repaired: 3 })
    expect(result.repaired).toEqual([
      expect.objectContaining({
        raw: '<:peepocozy:781403748580589598>',
        key: COZY,
        fixes: ['case'],
      }),
      expect.objectContaining({
        raw: '<:EZ:111111111111111111>',
        key: EZ,
        fixes: ['id'],
      }),
      expect.objectContaining({
        raw: '<:peepoWine:1266528661318926369>',
        key: WINE,
        fixes: ['animated'],
      }),
    ])
    expect(result.repaired.every(e => e.status === 'repaired')).toBe(true)
  })

  it('counts a wrong-case :name: shortcode as repaired', () => {
    const result = analyzeEmojis(':ez:', KEYS)

    expect(result.counts).toEqual({ ...EMPTY_COUNTS, repaired: 1 })
    expect(result.repaired[0]).toMatchObject({ key: EZ, fixes: ['case'] })
  })

  it('counts an unknown token and an unknown :name: as hallucinated', () => {
    const result = analyzeEmojis('<:nope:111111111111111111> and :kek:', KEYS)

    expect(result.counts).toEqual({ ...EMPTY_COUNTS, hallucinated: 2 })
    expect(result.hallucinated).toEqual([
      expect.objectContaining({
        raw: '<:nope:111111111111111111>',
        form: 'token',
        status: 'dropped',
        key: null,
      }),
      expect.objectContaining({
        raw: ':kek:',
        form: 'shortcode',
        status: 'dropped',
        key: null,
      }),
    ])
  })

  it('counts repeated refs each time they appear', () => {
    const result = analyzeEmojis(`${EZ}${EZ} 👍 👍 :kek: :kek:`, KEYS)

    expect(result.counts).toEqual({
      dictionary: 2,
      repaired: 0,
      hallucinated: 2,
      unicode: 2,
    })
  })

  it('counts unicode beside shortcodes and tokens', () => {
    const result = analyzeEmojis(`🔥:peepoCozy:😂${EZ}❤️ :ez: :kek: 👍🏽`, KEYS)

    expect(result.counts).toEqual({
      dictionary: 2,
      repaired: 1,
      hallucinated: 1,
      unicode: 4,
    })
    expect(result.unicode).toEqual(['🔥', '😂', '❤️', '👍🏽'])
  })

  it('ignores refs and unicode inside code', () => {
    const result = analyzeEmojis(
      `\`${EZ} 🔥 :kek:\` real ${EZ}\n\`\`\`\n:peepoCozy: 😂\n\`\`\`\n👍`,
      KEYS,
    )

    expect(result.counts).toEqual({
      ...EMPTY_COUNTS,
      dictionary: 1,
      unicode: 1,
    })
    expect(result.unicode).toEqual(['👍'])
  })

  it('keeps ref offsets from the raw text', () => {
    const result = analyzeEmojis(`hi ${EZ}`, KEYS)

    expect(result.dictionary[0]).toMatchObject({
      start: 3,
      end: 3 + EZ.length,
    })
  })

  it('accepts any iterable of keys', () => {
    const result = analyzeEmojis(EZ, new Set([EZ]))

    expect(result.counts.dictionary).toBe(1)
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
        repaired: 0,
        hallucinated: 0,
        unicode: 0,
      }),
    ).toBe('0 dictionary · 0 repaired · 0 hallucinated · 0 unicode')
  })

  it('formats many', () => {
    expect(
      formatEmojiScore({
        dictionary: 5,
        repaired: 1,
        hallucinated: 1,
        unicode: 2,
      }),
    ).toBe('5 dictionary · 1 repaired · 1 hallucinated · 2 unicode')
  })
})

describe('resolveEmojis', () => {
  const COZY = '<:peepoCozy:781403748580589598>'
  const DANCE = '<a:peepoDance:1266528661318926370>'
  const FIVE_HEAD = '<:5Head:758414734805696554>'
  const KEYS = [EZ, WINE, COZY, DANCE, FIVE_HEAD, 'not a key', '<:x:1>']

  it('resolves a shortcode to its dictionary key (the incident)', () => {
    expect(resolveEmojis('so cozy :peepoCozy:', KEYS)).toEqual({
      text: `so cozy ${COZY}`,
      emojis: [
        {
          raw: ':peepoCozy:',
          form: 'shortcode',
          name: 'peepoCozy',
          start: 8,
          end: 19,
          key: COZY,
          status: 'dictionary',
          fixes: [],
        },
      ],
    })
  })

  it('repairs a token with the wrong id', () => {
    const { text, emojis } = resolveEmojis(
      '<:peepoCozy:758403748580589598>',
      KEYS,
    )
    expect(text).toBe(COZY)
    expect(emojis).toMatchObject([
      { form: 'token', key: COZY, status: 'repaired', fixes: ['id'] },
    ])
  })

  it('repairs a token with the wrong id and animated flag', () => {
    const { text, emojis } = resolveEmojis(
      '<a:peepoCozy:758403748580589598>',
      KEYS,
    )
    expect(text).toBe(COZY)
    expect(emojis).toMatchObject([
      { key: COZY, status: 'repaired', fixes: ['id', 'animated'] },
    ])
  })

  it('resolves an animated shortcode to an <a:…> key', () => {
    expect(resolveEmojis(':peepoDance:', KEYS)).toMatchObject({
      text: DANCE,
      emojis: [{ key: DANCE, status: 'dictionary', fixes: [] }],
    })
  })

  it('repairs case in shortcodes and tokens', () => {
    expect(resolveEmojis(':PEEPOcozy:', KEYS)).toMatchObject({
      text: COZY,
      emojis: [
        { name: 'PEEPOcozy', key: COZY, status: 'repaired', fixes: ['case'] },
      ],
    })
    expect(
      resolveEmojis('<a:Peepocozy:758403748580589598>', KEYS),
    ).toMatchObject({
      text: COZY,
      emojis: [
        { key: COZY, status: 'repaired', fixes: ['case', 'id', 'animated'] },
      ],
    })
  })

  it('lets the newest snowflake win a duplicate name in either key order', () => {
    const old = '<:peepoLeave:781402364796076034>'
    const next = '<:peepoLeave:1178865973156139009>'
    for (const keys of [
      [old, next],
      [next, old],
    ]) {
      expect(resolveEmojis(':peepoLeave:', keys).text).toBe(next)
      expect(resolveEmojis(':PEEPOLEAVE:', keys).text).toBe(next)
      expect(resolveEmojis(old, keys)).toMatchObject({
        text: old,
        emojis: [{ status: 'dictionary' }],
      })
    }
  })

  it('falls back to the id after a rename', () => {
    expect(resolveEmojis('<:oldWine:1266528661318926369>', KEYS)).toEqual({
      text: WINE,
      emojis: [
        {
          raw: '<:oldWine:1266528661318926369>',
          form: 'token',
          name: 'oldWine',
          start: 0,
          end: 30,
          key: WINE,
          status: 'repaired',
          fixes: ['name', 'animated'],
        },
      ],
    })
    expect(
      resolveEmojis('<a:oldWine:1266528661318926369>', KEYS),
    ).toMatchObject({
      text: WINE,
      emojis: [{ status: 'repaired', fixes: ['name'] }],
    })
  })

  it('drops unknown shortcodes and collapses the whitespace', () => {
    expect(resolveEmojis('hi :nope: there', KEYS)).toMatchObject({
      text: 'hi there',
      emojis: [
        {
          raw: ':nope:',
          form: 'shortcode',
          name: 'nope',
          start: 3,
          end: 9,
          key: null,
          status: 'dropped',
          fixes: [],
        },
      ],
    })
    expect(resolveEmojis('bye :nope:', KEYS).text).toBe('bye')
    expect(resolveEmojis(':nope: hi', KEYS).text).toBe('hi')
    expect(resolveEmojis('hi\t:nope:  \t:nah:  there', KEYS).text).toBe(
      'hi there',
    )
    expect(resolveEmojis('(:nope:)', KEYS).text).toBe('()')
  })

  it('drops unknown tokens and keeps newlines', () => {
    const { text, emojis } = resolveEmojis(
      `line one :nope:\n<:fake:123456789012345678> line two\n\n:nah:`,
      KEYS,
    )
    expect(text).toBe('line one\nline two\n\n')
    expect(emojis).toMatchObject([
      { form: 'shortcode', status: 'dropped' },
      { form: 'token', name: 'fake', key: null, status: 'dropped' },
      { form: 'shortcode', status: 'dropped' },
    ])
  })

  it('keeps digit-first unknown names but resolves digit-first keys', () => {
    expect(resolveEmojis('ratio :50: :50:', KEYS)).toEqual({
      text: 'ratio :50: :50:',
      emojis: [],
    })
    expect(resolveEmojis('big brain :5Head:', KEYS)).toMatchObject({
      text: `big brain ${FIVE_HEAD}`,
      emojis: [{ key: FIVE_HEAD, status: 'dictionary' }],
    })
  })

  it('ignores times, URLs and adjacent colons', () => {
    const input = 'at 12:30:45 see https://x.test and a::EZ::b, :EZ::'
    expect(resolveEmojis(input, KEYS)).toEqual({ text: input, emojis: [] })
  })

  it('leaves code spans and fences untouched', () => {
    const input = [
      `use \`:EZ:\` or \`<:nope:123456789012345678>\` :EZ:`,
      '```',
      ':peepoCozy: <:nope:123456789012345678>',
      '```',
      ':peepoCozy:',
    ].join('\n')
    expect(resolveEmojis(input, KEYS)).toMatchObject({
      text: [
        `use \`:EZ:\` or \`<:nope:123456789012345678>\` ${EZ}`,
        '```',
        ':peepoCozy: <:nope:123456789012345678>',
        '```',
        COZY,
      ].join('\n'),
      emojis: [
        { raw: ':EZ:', start: input.indexOf(' :EZ:') + 1 },
        { raw: ':peepoCozy:', start: input.lastIndexOf(':peepoCozy:') },
      ],
    })
  })

  it('is idempotent', () => {
    const input = `hey :peepoCozy: :nope: <a:Peepocozy:758403748580589598> :nah:\n:EZ:`
    const once = resolveEmojis(input, KEYS)
    const twice = resolveEmojis(once.text, KEYS)
    expect(once.text).toBe(`hey ${COZY} ${COZY}\n${EZ}`)
    expect(twice.text).toBe(once.text)
    expect(twice.emojis.every(e => e.status === 'dictionary')).toBe(true)
  })

  it('handles empty text and an empty dictionary', () => {
    expect(resolveEmojis('', KEYS)).toEqual({ text: '', emojis: [] })
    expect(resolveEmojis(`hi :EZ: ${EZ}`, [])).toMatchObject({
      text: 'hi',
      emojis: [
        { raw: ':EZ:', status: 'dropped' },
        { raw: EZ, status: 'dropped' },
      ],
    })
  })

  it('reports offsets into the input in order', () => {
    const input = `${EZ} :nope: :peepoCozy: <:xx:758414734805696553>`
    const { emojis } = resolveEmojis(input, KEYS)
    expect(emojis.map(e => e.raw)).toEqual([
      EZ,
      ':nope:',
      ':peepoCozy:',
      '<:xx:758414734805696553>',
    ])
    for (const emoji of emojis) {
      expect(input.slice(emoji.start, emoji.end)).toBe(emoji.raw)
    }
    expect(emojis.at(-1)).toMatchObject({
      key: EZ,
      status: 'repaired',
      fixes: ['name'],
    })
  })
})
