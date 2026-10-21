import { AIMessage, HumanMessage } from '@langchain/core/messages'

import { EmojiRow } from 'src/db/schema'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { formatEmojiDictionary } from 'src/utils/prompts'

// Real-length snowflakes: shorter ids don't parse as emoji tokens.
const ID_A = '758414734805696553'
const ID_B = '758414734805696554'
const ID_C = '1178865973156139009'

function row(overrides: Partial<EmojiRow> & Pick<EmojiRow, 'id'>): EmojiRow {
  return {
    guildId: 'guild-1',
    name: `emoji${overrides.id}`,
    animated: false,
    description: `description of ${overrides.id}`,
    source: 'ai',
    model: 'gpt-6-luna',
    describedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  }
}

describe('EmojiDictionaryService', () => {
  let repo: { listActiveDescribed: jest.Mock }
  let service: EmojiDictionaryService

  beforeEach(() => {
    repo = { listActiveDescribed: jest.fn().mockResolvedValue([]) }
    service = new EmojiDictionaryService(
      repo as unknown as EmojiDictionaryRepository,
    )
  })

  it('starts with an empty dictionary', () => {
    expect(service.size()).toBe(0)
    expect(service.keys()).toEqual([])
    expect(service.promptText()).toBe(formatEmojiDictionary({}))
  })

  it('keys rows by :name: and orders them by numeric id', async () => {
    // Lexical order would put '1000…' before '999…'
    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_C, name: 'EZ', description: 'smug' }),
      row({ id: ID_A, name: 'peepo', animated: true, description: 'poo' }),
    ])

    await service.onModuleInit()

    expect(service.size()).toBe(2)
    expect(service.promptText()).toBe(
      formatEmojiDictionary({ ':peepo:': 'poo', ':EZ:': 'smug' }),
    )
    expect(service.promptText()).toContain('{":peepo:":"poo",":EZ:":"smug"}')
  })

  it('keys() lists the canonical tokens in prompt order', async () => {
    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_C, name: 'EZ' }),
      row({ id: ID_A, name: 'peepo', animated: true }),
      row({ id: ID_B, name: 'blank', description: null }),
    ])
    await service.refresh()

    expect(service.keys()).toEqual([`<a:peepo:${ID_A}>`, `<:EZ:${ID_C}>`])
    expect(service.keys()).toHaveLength(service.size())
    expect(service.promptText()).not.toContain('blank')
  })

  it('collapses duplicate exact names to the newest snowflake', async () => {
    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_C, name: 'peepoLeave', description: 'new' }),
      row({ id: ID_A, name: 'peepoLeave', description: 'old' }),
      row({ id: ID_B, name: 'EZ', description: 'smug' }),
    ])
    await service.refresh()

    expect(service.size()).toBe(2)
    expect(service.keys()).toEqual([`<:EZ:${ID_B}>`, `<:peepoLeave:${ID_C}>`])
    expect(service.promptText()).toContain(
      '{":EZ:":"smug",":peepoLeave:":"new"}',
    )
    expect(service.promptText()).not.toContain('old')
  })

  it('keeps names that differ only in case', async () => {
    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_A, name: 'Pog', description: 'upper' }),
      row({ id: ID_B, name: 'pog', description: 'lower' }),
    ])
    await service.refresh()

    expect(service.size()).toBe(2)
    expect(service.keys()).toEqual([`<:Pog:${ID_A}>`, `<:pog:${ID_B}>`])
    expect(service.promptText()).toContain('{":Pog:":"upper",":pog:":"lower"}')
  })

  it('shows no ids or tokens in the prompt', async () => {
    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_A, name: 'EZ', description: 'smug' }),
      row({ id: ID_C, name: 'peepo', animated: true, description: 'poo' }),
    ])
    await service.refresh()

    expect(service.promptText()).not.toMatch(/\d{17}/)
    expect(service.promptText()).not.toContain('<:')
    expect(service.promptText()).not.toContain('<a:')
  })

  it('refresh picks up changes in the table', async () => {
    repo.listActiveDescribed.mockResolvedValue([row({ id: ID_A, name: 'a' })])
    await service.onModuleInit()

    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_A, name: 'a', description: 'edited' }),
      row({ id: ID_B, name: 'b', description: 'new' }),
    ])
    await service.refresh()

    expect(service.size()).toBe(2)
    expect(service.promptText()).toContain('{":a:":"edited",":b:":"new"}')
  })

  it('resolve() uses the cached keys and follows refresh()', async () => {
    expect(service.resolve('hi :EZ:')).toEqual({
      text: 'hi',
      emojis: [
        expect.objectContaining({ raw: ':EZ:', key: null, status: 'dropped' }),
      ],
    })

    repo.listActiveDescribed.mockResolvedValue([
      row({ id: ID_A, name: 'EZ' }),
      row({ id: ID_C, name: 'pog', animated: true }),
    ])
    await service.refresh()

    const resolved = service.resolve('hi :EZ: and :pog:')
    expect(resolved.text).toBe(`hi <:EZ:${ID_A}> and <a:pog:${ID_C}>`)
    expect(resolved.emojis.map(e => e.status)).toEqual([
      'dictionary',
      'dictionary',
    ])

    repo.listActiveDescribed.mockResolvedValue([row({ id: ID_A, name: 'EZ' })])
    await service.refresh()

    const after = service.resolve('hi :EZ: and :pog:')
    expect(after.text).toBe(`hi <:EZ:${ID_A}> and`)
    expect(after.emojis.map(e => e.status)).toEqual(['dictionary', 'dropped'])
  })

  it('keeps an empty dictionary when the repository fails at init', async () => {
    repo.listActiveDescribed.mockRejectedValue(new Error('db down'))

    await expect(service.onModuleInit()).resolves.toBeUndefined()

    expect(service.size()).toBe(0)
    expect(service.promptText()).toBe(formatEmojiDictionary({}))
  })

  describe('names and recentlyUsed', () => {
    beforeEach(async () => {
      repo.listActiveDescribed.mockResolvedValue([
        row({ id: ID_C, name: 'EZ', description: 'smug' }),
        row({ id: ID_A, name: 'pog', animated: true, description: 'hype' }),
        row({ id: ID_B, name: 'VIBE', description: 'chill' }),
      ])
      await service.onModuleInit()
    })

    it('names() lists the shortcode names in prompt order', () => {
      expect(service.names()).toEqual(['pog', 'VIBE', 'EZ'])
    })

    it('collects dictionary emojis from AI messages, most recent first', () => {
      const history = [
        new AIMessage(`old <a:pog:${ID_A}>`),
        new HumanMessage('user said :VIBE:'),
        new AIMessage('new :EZ: and :ez: and <:VIBE:>'),
      ]

      expect(service.recentlyUsed(history)).toEqual(['EZ', 'VIBE', 'pog'])
    })

    it('skips unknown emojis and only scans the last `replies` AI messages', () => {
      const history = [new AIMessage(':pog:'), new AIMessage(':nope: :VIBE:')]

      expect(service.recentlyUsed(history, 1)).toEqual(['VIBE'])
    })
  })
})

describe('formatEmojiDictionary', () => {
  it('inlines the map as JSON between the instructions', () => {
    const emojis = { ':EZ:': 'smug', ':pog:': 'hype' }
    const text = formatEmojiDictionary(emojis)

    expect(text).toMatch(/^The emoji dictionary is defined in the below JSON/)
    expect(text).toContain(`\n\n${JSON.stringify(emojis)}\n\n`)
    expect(text).toMatch(
      /For every message you send, you must use only the emojis in the dictionary\nabove\.$/,
    )
  })

  it('explains shortcodes and never shows an id or token format', () => {
    const text = formatEmojiDictionary({ ':EZ:': 'smug' })

    expect(text).toContain('shortcode')
    expect(text).toContain('":EZ:" or ":peepoPooPoo:"')
    expect(text).toContain('converted automatically')
    expect(text).not.toMatch(/\d{17}/)
    expect(text).not.toContain('<:')
    expect(text).not.toContain('<a:')
  })
})
