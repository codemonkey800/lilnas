import { AIMessage } from '@langchain/core/messages'

import {
  ImageCall,
  ImageResult,
  LlmCall,
  LlmResult,
} from 'src/llm/client/llm-call.types'
import { LlmClient } from 'src/llm/client/llm-client'

export type FakeResponse = string | object | AIMessage | Error
export type FakeResponder = (
  call: LlmCall<unknown>,
) => FakeResponse | Promise<FakeResponse>

/** Scriptable in-memory LlmClient for tests; no network, no metrics. */
export class FakeLlmClient extends LlmClient {
  readonly calls: LlmCall<unknown>[] = []
  readonly imageCalls: ImageCall[] = []
  private readonly responders = new Map<string, FakeResponder>()
  private imageUrl?: string

  script(operation: string, responder: FakeResponder | FakeResponse): this {
    this.responders.set(
      operation,
      typeof responder === 'function'
        ? (responder as FakeResponder)
        : () => responder,
    )
    return this
  }

  scriptImage(url: string): this {
    this.imageUrl = url
    return this
  }

  async call<T = string>(call: LlmCall<T>): Promise<LlmResult<T>> {
    this.calls.push(call as LlmCall<unknown>)
    const responder = this.responders.get(call.operation)
    if (!responder) {
      throw new Error(
        `FakeLlmClient: no script for operation '${call.operation}'`,
      )
    }
    const response = await responder(call as LlmCall<unknown>)
    if (response instanceof Error) throw response

    const message =
      response instanceof AIMessage
        ? response
        : new AIMessage(
            typeof response === 'string' ? response : JSON.stringify(response),
          )
    const output = call.schema
      ? call.schema.parse(
          response instanceof AIMessage
            ? JSON.parse(String(response.content))
            : response,
        )
      : typeof response === 'string'
        ? response
        : response instanceof AIMessage
          ? String(response.content)
          : JSON.stringify(response)

    return {
      output: output as T,
      message,
      model: call.overrides?.model ?? 'fake-model',
      usage: { input: 0, output: 0, cached: 0, costUsd: 0 },
      durationMs: 0,
      retries: 0,
    }
  }

  async generateImage(call: ImageCall): Promise<ImageResult> {
    this.imageCalls.push(call)
    if (!this.imageUrl) {
      throw new Error('FakeLlmClient: no image scripted (use scriptImage)')
    }
    return {
      url: this.imageUrl,
      model: call.overrides?.model ?? 'fake-image-model',
      durationMs: 0,
    }
  }
}
