import { SystemMessage } from '@langchain/core/messages'

import { createTestingModule } from 'src/__tests__/test-utils'
import {
  defaultSettings,
  SettingsService,
} from 'src/llm/settings/settings.service'
import { PromptService } from 'src/messages/prompts/prompt.service'
import {
  EMOJI_DICTIONARY,
  INPUT_FORMAT,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

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

    it('includes EMOJI_DICTIONARY in the content', () => {
      const content = service.getSystemPrompt().content as string

      expect(content).toContain(EMOJI_DICTIONARY.trim())
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
