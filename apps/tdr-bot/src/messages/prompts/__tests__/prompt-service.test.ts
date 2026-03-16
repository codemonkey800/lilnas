import { SystemMessage } from '@langchain/core/messages'

import {
  createMockStateService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { StateService } from 'src/state/state.service'
import {
  EMOJI_DICTIONARY,
  INPUT_FORMAT,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

describe('PromptService', () => {
  let service: PromptService
  let stateService: jest.Mocked<StateService>

  beforeEach(async () => {
    stateService = createMockStateService()
    stateService.getState.mockReturnValue({
      chatModel: 'gpt-4-turbo',
      reasoningModel: 'gpt-4o-mini',
      temperature: 0,
      maxTokens: 1000,
      prompt: 'Be a helpful kawaii assistant.',
      graphHistory: [],
    })

    const module = await createTestingModule([
      PromptService,
      { provide: StateService, useValue: stateService },
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

    it('includes the state prompt in the content', () => {
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

    it('reflects updated prompt when state changes', () => {
      stateService.getState.mockReturnValue({
        chatModel: 'gpt-4-turbo',
        reasoningModel: 'gpt-4o-mini',
        temperature: 0,
        maxTokens: 1000,
        prompt: 'New custom prompt text.',
        graphHistory: [],
      })

      const content = service.getSystemPrompt().content as string

      expect(content).toContain('New custom prompt text.')
      expect(content).not.toContain('Be a helpful kawaii assistant.')
    })
  })
})
