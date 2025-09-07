import { BaseMessage, SystemMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import dedent from 'dedent'
import _ from 'lodash'
import { ChatModel } from 'openai/resources/index'

import { OutputStateAnnotation } from 'src/schemas/graph'
import { MovieDeleteContext, MovieSelectionContext } from 'src/schemas/movie'
import {
  TvShowDeleteContext,
  TvShowSelectionContext,
} from 'src/schemas/tv-show'
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
  userMovieContexts: Map<string, MovieSelectionContext>
  userMovieDeleteContexts: Map<string, MovieDeleteContext>
  userTvShowContexts: Map<string, TvShowSelectionContext>
  userTvShowDeleteContexts: Map<string, TvShowDeleteContext>
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
    userMovieContexts: new Map(),
    userMovieDeleteContexts: new Map(),
    userTvShowContexts: new Map(),
    userTvShowDeleteContexts: new Map(),
  }

  setState(
    state: Partial<AppState> | ((state: AppState) => Partial<AppState>),
  ) {
    const prevState = this.state
    const newState = typeof state === 'function' ? state(prevState) : state
    const nextState = _.merge({}, prevState, newState)
    this.state = nextState

    this.eventEmitter.emit(
      'state.change',
      new StateChangeEvent(prevState, nextState),
    )
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

  // Movie context management methods
  setUserMovieContext(userId: string, context: MovieSelectionContext) {
    this.logger.log(
      { userId, query: context.query },
      'Setting movie context for user',
    )
    this.setState(prev => ({
      userMovieContexts: new Map(prev.userMovieContexts).set(userId, context),
    }))
  }

  clearUserMovieContext(userId: string) {
    this.logger.log({ userId }, 'Clearing movie context for user')
    this.setState(prev => {
      const newMap = new Map(prev.userMovieContexts)
      newMap.delete(userId)
      return { userMovieContexts: newMap }
    })
  }

  getUserMovieContext(userId: string): MovieSelectionContext | undefined {
    return this.state.userMovieContexts.get(userId)
  }

  isMovieContextExpired(context: MovieSelectionContext): boolean {
    const CONTEXT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
    const now = Date.now()
    return now - context.timestamp > CONTEXT_TIMEOUT_MS
  }

  cleanupExpiredMovieContexts() {
    const cleanedContexts = new Map()

    for (const [userId, context] of this.state.userMovieContexts) {
      if (!this.isMovieContextExpired(context)) {
        cleanedContexts.set(userId, context)
      } else {
        this.logger.log({ userId }, 'Cleaned up expired movie context')
      }
    }

    if (cleanedContexts.size !== this.state.userMovieContexts.size) {
      this.setState({ userMovieContexts: cleanedContexts })
    }
  }

  // TV show context management methods
  setUserTvShowContext(userId: string, context: TvShowSelectionContext) {
    this.logger.log(
      { userId, query: context.query },
      'Setting TV show context for user',
    )
    this.setState(prev => ({
      userTvShowContexts: new Map(prev.userTvShowContexts).set(userId, context),
    }))
  }

  clearUserTvShowContext(userId: string) {
    this.logger.log({ userId }, 'Clearing TV show context for user')
    this.setState(prev => {
      const newMap = new Map(prev.userTvShowContexts)
      newMap.delete(userId)
      return { userTvShowContexts: newMap }
    })
  }

  getUserTvShowContext(userId: string): TvShowSelectionContext | undefined {
    return this.state.userTvShowContexts.get(userId)
  }

  isTvShowContextExpired(context: TvShowSelectionContext): boolean {
    const CONTEXT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
    const now = Date.now()
    return now - context.timestamp > CONTEXT_TIMEOUT_MS
  }

  cleanupExpiredTvShowContexts() {
    const cleanedContexts = new Map()

    for (const [userId, context] of this.state.userTvShowContexts) {
      if (!this.isTvShowContextExpired(context)) {
        cleanedContexts.set(userId, context)
      } else {
        this.logger.log({ userId }, 'Cleaned up expired TV show context')
      }
    }

    if (cleanedContexts.size !== this.state.userTvShowContexts.size) {
      this.setState({ userTvShowContexts: cleanedContexts })
    }
  }

  // Movie delete context management methods
  setUserMovieDeleteContext(userId: string, context: MovieDeleteContext) {
    this.logger.log(
      { userId, query: context.query },
      'Setting movie delete context for user',
    )
    this.setState(prev => ({
      userMovieDeleteContexts: new Map(prev.userMovieDeleteContexts).set(
        userId,
        context,
      ),
    }))
  }

  clearUserMovieDeleteContext(userId: string) {
    this.logger.log({ userId }, 'Clearing movie delete context for user')
    this.setState(prev => {
      const newMap = new Map(prev.userMovieDeleteContexts)
      newMap.delete(userId)
      return { userMovieDeleteContexts: newMap }
    })
  }

  getUserMovieDeleteContext(userId: string): MovieDeleteContext | undefined {
    return this.state.userMovieDeleteContexts.get(userId)
  }

  isMovieDeleteContextExpired(context: MovieDeleteContext): boolean {
    const CONTEXT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
    const now = Date.now()
    return now - context.timestamp > CONTEXT_TIMEOUT_MS
  }

  cleanupExpiredMovieDeleteContexts() {
    const cleanedContexts = new Map()

    for (const [userId, context] of this.state.userMovieDeleteContexts) {
      if (!this.isMovieDeleteContextExpired(context)) {
        cleanedContexts.set(userId, context)
      } else {
        this.logger.log({ userId }, 'Cleaned up expired movie delete context')
      }
    }

    if (cleanedContexts.size !== this.state.userMovieDeleteContexts.size) {
      this.setState({ userMovieDeleteContexts: cleanedContexts })
    }
  }

  setUserTvShowDeleteContext(userId: string, context: TvShowDeleteContext) {
    this.logger.log(
      { userId, query: context.query },
      'Setting TV show delete context for user',
    )
    this.setState(prev => ({
      userTvShowDeleteContexts: new Map(prev.userTvShowDeleteContexts).set(
        userId,
        context,
      ),
    }))
  }

  clearUserTvShowDeleteContext(userId: string) {
    this.logger.log({ userId }, 'Clearing TV show delete context for user')
    this.setState(prev => {
      const newMap = new Map(prev.userTvShowDeleteContexts)
      newMap.delete(userId)
      return { userTvShowDeleteContexts: newMap }
    })
  }

  getUserTvShowDeleteContext(userId: string): TvShowDeleteContext | undefined {
    return this.state.userTvShowDeleteContexts.get(userId)
  }

  isTvShowDeleteContextExpired(context: TvShowDeleteContext): boolean {
    const CONTEXT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
    const now = Date.now()
    return now - context.timestamp > CONTEXT_TIMEOUT_MS
  }

  cleanupExpiredTvShowDeleteContexts() {
    const cleanedContexts = new Map()

    for (const [userId, context] of this.state.userTvShowDeleteContexts) {
      if (!this.isTvShowDeleteContextExpired(context)) {
        cleanedContexts.set(userId, context)
      } else {
        this.logger.log({ userId }, 'Cleaned up expired TV show delete context')
      }
    }

    if (cleanedContexts.size !== this.state.userTvShowDeleteContexts.size) {
      this.setState({ userTvShowDeleteContexts: cleanedContexts })
    }
  }
}
