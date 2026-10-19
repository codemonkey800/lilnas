import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'

import type {
  PlaygroundChatBody,
  PlaygroundChatResponse,
} from 'src/api/api.types'
import { analyzeEmojis } from 'src/emojis/emoji-analysis'
import { EmojiDictionaryService } from 'src/emojis/emoji-dictionary.service'
import { LlmClient } from 'src/llm/client/llm-client'
import { toMessageName } from 'src/llm/conversation/message-name'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { PromptService } from 'src/messages/prompts/prompt.service'

export const DEFAULT_PLAYGROUND_AUTHOR = 'paulbeenis420'
const PLAYGROUND_TIMEOUT_MS = 90_000

/** The requested model is unknown or not allowed for chat. */
export class PlaygroundModelError extends Error {
  constructor(readonly modelId: string) {
    super(`Model '${modelId}' is not available for chat`)
    this.name = 'PlaygroundModelError'
  }
}

/**
 * Stateless chat against the production system prompt (or a draft of it),
 * with the reply scored against the emoji dictionary. Never touches the
 * conversation graph or its checkpointer.
 */
@Injectable()
export class PlaygroundService {
  private readonly logger = new Logger(PlaygroundService.name)

  constructor(
    private readonly llm: LlmClient,
    private readonly registry: ModelRegistry,
    private readonly promptService: PromptService,
    private readonly dictionary: EmojiDictionaryService,
  ) {}

  async chat(body: PlaygroundChatBody): Promise<PlaygroundChatResponse> {
    if (!this.registry.isAllowedFor(body.model, 'chat')) {
      throw new PlaygroundModelError(body.model)
    }

    // An empty or whitespace-only draft means "use the saved prompt".
    const draft = body.systemPromptDraft?.trim()
    const name = toMessageName(body.author ?? DEFAULT_PLAYGROUND_AUTHOR)
    const messages: BaseMessage[] = [
      this.promptService.getSystemPrompt(draft ? { systemPrompt: draft } : {}),
      ...body.messages.map(message =>
        message.role === 'user'
          ? new HumanMessage({ content: message.content, name })
          : new AIMessage(message.content),
      ),
    ]

    const result = await this.llm.call({
      operation: 'playground.chat',
      role: 'chat',
      messages,
      overrides: { model: body.model, timeoutMs: PLAYGROUND_TIMEOUT_MS },
    })

    // Score the raw output; Discord gets the resolved text.
    const raw = result.output
    const emojis = analyzeEmojis(raw, this.dictionary.keys())
    this.logger.log(
      {
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        counts: emojis.counts,
      },
      'playground.chat',
    )

    return {
      raw,
      reply: this.dictionary.resolve(raw).text,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      emojis,
      dictionarySize: this.dictionary.size(),
    }
  }
}
