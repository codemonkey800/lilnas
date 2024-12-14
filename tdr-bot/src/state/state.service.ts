import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import dedent from 'dedent'
import { ChatModel } from 'openai/resources/index'

import {
  EMOJI_DICTIONARY,
  INPUT_FORMAT,
  KAWAII_PROMPT,
  OUTPUT_FORMAT,
  PROMPT_INTRO,
} from 'src/utils/prompts'

export interface AppState {
  maxTokens: number
  model: ChatModel
  prompt: string
  temperature: number
  messages: BaseMessage[]
}

export class StateChangeEvent {
  constructor(
    public readonly prevState: AppState,
    public readonly nextState: Partial<AppState>,
  ) {}
}

@Injectable()
export class StateService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  private state: AppState = {
    maxTokens: 100_000,
    model: 'gpt-4o-mini',
    prompt: KAWAII_PROMPT,
    temperature: 0,
    messages: [],
  }

  setState(
    state: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ) {
    const newState = typeof state === 'function' ? state(this.state) : state

    this.eventEmitter.emit(
      'state.change',
      new StateChangeEvent(this.state, newState),
    )

    this.state = { ...this.state, ...newState }
  }

  getState() {
    return this.state
  }

  getPrompt(): BaseMessage[] {
    return [
      new SystemMessage(dedent`
        # Prompt Intro
        ${PROMPT_INTRO}

        # Input Format
        ${INPUT_FORMAT}

        # Output Format
        ${OUTPUT_FORMAT}

        # Prompt
        ${this.state.prompt}

        # Emoji Dictionary
        ${EMOJI_DICTIONARY}
      `),
    ]
  }
}
