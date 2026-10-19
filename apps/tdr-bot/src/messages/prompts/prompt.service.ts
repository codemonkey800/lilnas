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

  /**
   * `options.systemPrompt` replaces only the saved `settings.systemPrompt`;
   * the intro, input format and emoji dictionary are always included.
   */
  getSystemPrompt(options: { systemPrompt?: string } = {}): SystemMessage {
    const systemPrompt =
      options.systemPrompt ?? this.settings.get().systemPrompt

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
