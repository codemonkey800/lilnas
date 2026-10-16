import { SystemMessage } from '@langchain/core/messages'

import { createTestingModule } from 'src/__tests__/test-utils'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { PromptService } from 'src/messages/prompts/prompt.service'
import {
  INPUT_FORMAT,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

const FAKE_EMOJI_DICTIONARY = 'FAKE EMOJI DICTIONARY {"<:EZ:1>":"smug"}'

describe('PromptService', () => {
  let service: PromptService
  let settings: { get: jest.Mock }

  beforeEach(async () => {
    settings = {
      get: jest.fn().mockReturnValue({
        ...defaultSettings(),
        systemPrompt: 'Be a helpful kawaii assistant.',
      }),
    }

    const module = await createTestingModule([
      PromptService,
      { provide: SettingsService, useValue: settings },
      {
        provide: EmojiDictionaryService,
        useValue: { promptText: () => FAKE_EMOJI_DICTIONARY },
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
})
