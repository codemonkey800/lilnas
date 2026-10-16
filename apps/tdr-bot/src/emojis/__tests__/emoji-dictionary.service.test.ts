import { EmojiRow } from 'src/db/schema'
import { EmojiDictionaryRepository } from 'src/emojis/emoji-dictionary.repository'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { formatEmojiDictionary } from 'src/utils/prompts'

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
    expect(service.promptText()).toBe(formatEmojiDictionary({}))
  })

  it('keys rows by emojiKey and orders them by numeric id', async () => {
    // Lexical order would put '1000' before '999'
    repo.listActiveDescribed.mockResolvedValue([
      row({ id: '1000', name: 'EZ', description: 'smug' }),
      row({ id: '999', name: 'peepo', animated: true, description: 'poo' }),
    ])

    await service.onModuleInit()

    expect(service.size()).toBe(2)
    expect(service.promptText()).toBe(
      formatEmojiDictionary({ '<a:peepo:999>': 'poo', '<:EZ:1000>': 'smug' }),
    )
    expect(service.promptText()).toContain(
      '{"<a:peepo:999>":"poo","<:EZ:1000>":"smug"}',
    )
  })

  it('refresh picks up changes in the table', async () => {
    repo.listActiveDescribed.mockResolvedValue([row({ id: '1', name: 'a' })])
    await service.onModuleInit()

    repo.listActiveDescribed.mockResolvedValue([
      row({ id: '1', name: 'a', description: 'edited' }),
      row({ id: '2', name: 'b', description: 'new' }),
    ])
    await service.refresh()

    expect(service.size()).toBe(2)
    expect(service.promptText()).toContain('{"<:a:1>":"edited","<:b:2>":"new"}')
  })

  it('keeps an empty dictionary when the repository fails at init', async () => {
    repo.listActiveDescribed.mockRejectedValue(new Error('db down'))

    await expect(service.onModuleInit()).resolves.toBeUndefined()

    expect(service.size()).toBe(0)
    expect(service.promptText()).toBe(formatEmojiDictionary({}))
  })
})

describe('formatEmojiDictionary', () => {
  it('inlines the map as JSON between the instructions', () => {
    const emojis = { '<:EZ:758414734805696553>': 'smug', '<a:pog:2>': 'hype' }
    const text = formatEmojiDictionary(emojis)

    expect(text).toMatch(/^The emoji dictionary is defined in the below JSON/)
    expect(text).toContain(`\n\n${JSON.stringify(emojis)}\n\n`)
    expect(text).toMatch(
      /For every message you send, you must use only the emojis in the dictionary\nabove\.$/,
    )
  })
})
