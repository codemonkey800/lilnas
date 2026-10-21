import { AIMessage, SystemMessage } from '@langchain/core/messages'

import { createTestingModule } from 'src/__tests__/test-utils'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import {
  PromptService,
  STYLE_NOTE_PICKS,
  STYLE_NOTE_RECENT_REPLIES,
} from 'src/messages/prompts/prompt.service'
import {
  EMOJI_PLACEMENT_HINTS,
  INPUT_FORMAT,
  PERSONA_REMINDER,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

const FAKE_EMOJI_DICTIONARY = 'FAKE EMOJI DICTIONARY {"<:EZ:1>":"smug"}'

describe('PromptService', () => {
  let service: PromptService
  let settings: { get: jest.Mock }
  let dictionary: { names: jest.Mock; recentlyUsed: jest.Mock }

  beforeEach(async () => {
    settings = {
      get: jest.fn().mockReturnValue({
        ...defaultSettings(),
        systemPrompt: 'Be a helpful kawaii assistant.',
      }),
    }

    dictionary = {
      names: jest.fn().mockReturnValue(['EZ', 'pog', 'HYPERS', 'VIBE', 'Hmmm']),
      recentlyUsed: jest.fn().mockReturnValue([]),
    }

    const module = await createTestingModule([
      PromptService,
      { provide: SettingsService, useValue: settings },
      {
        provide: EmojiDictionaryService,
        useValue: {
          promptText: () => FAKE_EMOJI_DICTIONARY,
          names: dictionary.names,
          recentlyUsed: dictionary.recentlyUsed,
        },
      },
    ])

    service = module.get(PromptService)
  })

  describe('getSystemPrompt', () => {
    it('returns a SystemMessage instance', () => {
      const result = service.getSystemPrompt()

      expect(result).toBeInstanceOf(SystemMessage)
    })

    it('sets the correct system prompt id', () => {
      const result = service.getSystemPrompt()

      expect(result.id).toBe(TDR_SYSTEM_PROMPT_ID)
    })

    it('includes the settings system prompt in the content', () => {
      const content = service.getSystemPrompt().content as string

      expect(content).toContain('Be a helpful kawaii assistant.')
    })

    it('includes PROMPT_INTRO in the content', () => {
      const content = service.getSystemPrompt().content as string

      expect(content).toContain(PROMPT_INTRO.trim())
    })

    it('includes INPUT_FORMAT in the content', () => {
      const content = service.getSystemPrompt().content as string

      expect(content).toContain(INPUT_FORMAT.trim())
    })

    it('includes the cached emoji dictionary in the content', () => {
      const content = service.getSystemPrompt().content as string

      expect(content).toContain(FAKE_EMOJI_DICTIONARY)
    })

    it('an empty options object equals the saved prompt', () => {
      expect(service.getSystemPrompt({}).content).toBe(
        service.getSystemPrompt().content,
      )
    })

    it('a systemPrompt override replaces only the saved prompt', () => {
      const result = service.getSystemPrompt({ systemPrompt: 'Draft prompt.' })
      const content = result.content as string

      expect(result.id).toBe(TDR_SYSTEM_PROMPT_ID)
      expect(content.startsWith(PROMPT_INTRO.trim())).toBe(true)
      expect(content).toContain(INPUT_FORMAT.trim())
      expect(content).toContain('Draft prompt.')
      expect(content).not.toContain('Be a helpful kawaii assistant.')
      expect(content).toContain(FAKE_EMOJI_DICTIONARY)
    })

    it('ends with the persona reminder after the dictionary', () => {
      const content = service.getSystemPrompt().content as string

      expect(content.endsWith(PERSONA_REMINDER.trim())).toBe(true)
      expect(content.indexOf(FAKE_EMOJI_DICTIONARY)).toBeLessThan(
        content.indexOf(PERSONA_REMINDER.trim()),
      )
    })

    it('reflects updated prompt when settings change', () => {
      settings.get.mockReturnValue({
        ...defaultSettings(),
        systemPrompt: 'New custom prompt text.',
      })

      const content = service.getSystemPrompt().content as string

      expect(content).toContain('New custom prompt text.')
      expect(content).not.toContain('Be a helpful kawaii assistant.')
    })
  })

  describe('getStyleNote', () => {
    const content = (note: SystemMessage | null) => note?.content as string

    it('returns null when the dictionary is empty', () => {
      dictionary.names.mockReturnValue([])

      expect(service.getStyleNote([])).toBeNull()
    })

    it('suggests distinct dictionary emojis and one placement hint', () => {
      const note = service.getStyleNote([], () => 0)

      expect(note).toBeInstanceOf(SystemMessage)
      const text = content(note)
      // random() = 0 keeps the original order.
      expect(text).toContain(
        `Consider using some of: :EZ:, :pog:, :HYPERS:, :VIBE: (only if they fit).`,
      )
      expect(text).toContain(
        `Style for this reply: ${EMOJI_PLACEMENT_HINTS[0]}.`,
      )
      expect(text).not.toContain('recently used')
    })

    it('picks a different placement hint for a different random value', () => {
      const text = content(service.getStyleNote([], () => 0.99))

      expect(text).toContain(EMOJI_PLACEMENT_HINTS.at(-1))
    })

    it('never suggests recently used emojis and names them to avoid', () => {
      const history = [new AIMessage('hi :EZ:')]
      dictionary.recentlyUsed.mockReturnValue(['EZ', 'pog'])

      const text = content(service.getStyleNote(history, () => 0))

      expect(dictionary.recentlyUsed).toHaveBeenCalledWith(
        history,
        STYLE_NOTE_RECENT_REPLIES,
      )
      expect(text).toContain('Consider using some of: :HYPERS:, :VIBE:, :Hmmm:')
      expect(text).toContain(
        'You recently used :EZ:, :pog:, so pick different ones this time.',
      )
    })

    it('falls back to the whole dictionary when every emoji was used recently', () => {
      dictionary.names.mockReturnValue(['EZ'])
      dictionary.recentlyUsed.mockReturnValue(['EZ'])

      expect(content(service.getStyleNote([], () => 0))).toContain(
        'Consider using some of: :EZ:',
      )
    })

    it(`suggests at most ${STYLE_NOTE_PICKS} emojis`, () => {
      const text = content(service.getStyleNote([], Math.random))
      const suggested = text.match(/Consider using some of: (.*) \(/)?.[1]

      expect(suggested?.split(', ')).toHaveLength(STYLE_NOTE_PICKS)
    })
  })
})
