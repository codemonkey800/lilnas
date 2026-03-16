import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'
import dedent from 'dedent'

import { StateService } from 'src/state/state.service'
import {
  EMOJI_DICTIONARY,
  INPUT_FORMAT,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

@Injectable()
export class PromptService {
  constructor(private readonly state: StateService) {}

  getSystemPrompt(): BaseMessage {
    const { prompt } = this.state.getState()

    return new SystemMessage({
      id: TDR_SYSTEM_PROMPT_ID,
      content: dedent`
        ${PROMPT_INTRO}

        ${INPUT_FORMAT}

        ${prompt}

        ${EMOJI_DICTIONARY}
      `,
    })
  }
}
