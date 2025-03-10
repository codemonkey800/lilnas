import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import dedent from 'dedent'
import { ChatModel } from 'openai/resources/index'

import { OutputStateAnnotation } from 'src/schemas/graph'
import {
  EMOJI_DICTIONARY,
  INPUT_FORMAT,
  KAWAII_PROMPT,
  PROMPT_INTRO,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

export interface AppState {
  chatModel: ChatModel
  graphHistory: Array<typeof OutputStateAnnotation.State>
  maxTokens: number
  prompt: string
  reasoningModel: ChatModel
  temperature: number
}

export class StateChangeEvent {
  constructor(
    public readonly prevState: AppState,
    public readonly nextState: Partial<AppState>,
  ) {}
}

@Injectable()
export class StateService {
  private logger = new Logger(StateService.name)

  constructor(private readonly eventEmitter: EventEmitter2) {}

  private state: AppState = {
    graphHistory: [],
    maxTokens: 50_000,
    chatModel: 'gpt-4-turbo',
    reasoningModel: 'gpt-4o-mini',
    prompt: KAWAII_PROMPT,
    temperature: 0,
  }

  setState(
    state: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ) {
    const newState = typeof state === 'function' ? state(this.state) : state

    this.eventEmitter.emit(
      'state.change',
      new StateChangeEvent(this.state, newState),
    )

    this.logger.log({ newState }, 'State updated')

    this.state = { ...this.state, ...newState }
  }

  getState() {
    return this.state
  }

  getPrompt(): BaseMessage {
    return new SystemMessage({
      id: TDR_SYSTEM_PROMPT_ID,
      content: dedent`
        ${PROMPT_INTRO}

        ${INPUT_FORMAT}

        ${this.state.prompt}

        ${EMOJI_DICTIONARY}
      `,
    })
  }
}
