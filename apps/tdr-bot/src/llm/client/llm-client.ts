import { ImageCall, ImageResult, LlmCall, LlmResult } from './llm-call.types'

/** The only way application code talks to an LLM. */
export abstract class LlmClient {
  abstract call<T = string>(call: LlmCall<T>): Promise<LlmResult<T>>
  abstract generateImage(call: ImageCall): Promise<ImageResult>
}
