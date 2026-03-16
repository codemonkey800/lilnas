import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { ChatModel } from 'openai/resources/index'
import { BehaviorSubject, distinctUntilChanged, map, Observable } from 'rxjs'

import { DEFAULT_CHAT_TEMPERATURE, DEFAULT_MAX_TOKENS } from 'src/constants/llm'
import { OutputStateAnnotation } from 'src/schemas/graph'
import { KAWAII_PROMPT } from 'src/utils/prompts'

export interface AppState {
  chatModel: ChatModel
  graphHistory: Array<typeof OutputStateAnnotation.State>
  maxTokens: number
  prompt: string
  reasoningModel: ChatModel
  temperature: number
}

const DEFAULT_STATE: AppState = {
  graphHistory: [],
  maxTokens: DEFAULT_MAX_TOKENS,
  chatModel: 'gpt-4-turbo',
  reasoningModel: 'gpt-4o-mini',
  prompt: KAWAII_PROMPT,
  temperature: DEFAULT_CHAT_TEMPERATURE,
}

@Injectable()
export class StateService implements OnModuleDestroy {
  private readonly state$ = new BehaviorSubject<AppState>(DEFAULT_STATE)

  getState(): AppState {
    return this.state$.getValue()
  }

  setState(
    update: Partial<AppState> | ((prev: AppState) => Partial<AppState>),
  ): void {
    const prev = this.state$.getValue()
    const partial = typeof update === 'function' ? update(prev) : update
    this.state$.next({ ...prev, ...partial })
  }

  select<T>(
    selector: (state: AppState) => T,
    comparator?: (prev: T, curr: T) => boolean,
  ): Observable<T> {
    return this.state$.pipe(map(selector), distinctUntilChanged(comparator))
  }

  get changes$(): Observable<AppState> {
    return this.state$.asObservable()
  }

  onModuleDestroy() {
    this.state$.complete()
  }
}
