import { SystemMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'
import dedent from 'dedent'

import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { SettingsService } from 'src/llm/settings/settings.service'
import {
  INPUT_FORMAT,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

@Injectable()
export class PromptService {
  constructor(
    private readonly settings: SettingsService,
    private readonly emojiDictionary: EmojiDictionaryService,
  ) {}

  getSystemPrompt(): SystemMessage {
    const { systemPrompt } = this.settings.get()

    return new SystemMessage({
      id: TDR_SYSTEM_PROMPT_ID,
      content: dedent`
        ${PROMPT_INTRO}

        ${INPUT_FORMAT}

        ${systemPrompt}

        ${this.emojiDictionary.promptText()}
      `,
    })
  }
}
