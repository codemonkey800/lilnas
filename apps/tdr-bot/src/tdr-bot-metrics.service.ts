import { Injectable } from '@nestjs/common'
import { Counter, Histogram, register } from 'prom-client'

type MessageHandler = 'chat' | 'keywords'
type HandledStatus = 'success' | 'error'
type LlmStatus = 'success' | 'error'
type LlmResponseType = 'default' | 'image' | 'math' | 'media'
type TokenType = 'prompt_tokens' | 'completion_tokens' | 'total_tokens'
type ImageGenerationStatus = 'success' | 'error'
type ResponseSentStatus =
  | 'success'
  | 'shortened'
  | 'truncated'
  | 'error'
  | 'fallback'

const messagesReceivedTotal = new Counter({
  name: 'tdr_bot_messages_received_total',
  help: 'Total number of Discord messages that matched a handler',
  labelNames: ['handler'],
  registers: [register],
})

const messagesHandledTotal = new Counter({
  name: 'tdr_bot_messages_handled_total',
  help: 'Total number of Discord messages handled, by handler and outcome',
  labelNames: ['handler', 'status'],
  registers: [register],
})

const llmRequestsTotal = new Counter({
  name: 'tdr_bot_llm_requests_total',
  help: 'Total number of LLM graph invocations by response type and outcome',
  labelNames: ['response_type', 'status'],
  registers: [register],
})

const llmRequestDurationSeconds = new Histogram({
  name: 'tdr_bot_llm_request_duration_seconds',
  help: 'End-to-end duration of LLM graph invocations by response type',
  labelNames: ['response_type'],
  buckets: [0.5, 1, 2.5, 5, 10, 15, 20, 30, 45, 60],
  registers: [register],
})

const llmTokensTotal = new Counter({
  name: 'tdr_bot_llm_tokens_total',
  help: 'Total number of tokens consumed by LLM calls',
  labelNames: ['type'],
  registers: [register],
})

const intentDetectionsTotal = new Counter({
  name: 'tdr_bot_intent_detections_total',
  help: 'Total number of intent detections by classified response type',
  labelNames: ['response_type'],
  registers: [register],
})

const imageGenerationsTotal = new Counter({
  name: 'tdr_bot_image_generations_total',
  help: 'Total number of DALL-E image generation attempts by status',
  labelNames: ['status'],
  registers: [register],
})

const responsesSentTotal = new Counter({
  name: 'tdr_bot_responses_sent_total',
  help: 'Total number of Discord replies sent, by outcome status',
  labelNames: ['status'],
  registers: [register],
})

const commandsExecutedTotal = new Counter({
  name: 'tdr_bot_commands_executed_total',
  help: 'Total number of slash commands executed by command name',
  labelNames: ['command'],
  registers: [register],
})

@Injectable()
export class TdrBotMetricsService {
  messageReceived(handler: MessageHandler): void {
    messagesReceivedTotal.inc({ handler })
  }

  messageHandled(handler: MessageHandler, status: HandledStatus): void {
    messagesHandledTotal.inc({ handler, status })
  }

  llmRequest(responseType: LlmResponseType, status: LlmStatus): void {
    llmRequestsTotal.inc({ response_type: responseType, status })
  }

  observeLlmDuration(responseType: LlmResponseType, durationMs: number): void {
    llmRequestDurationSeconds.observe(
      { response_type: responseType },
      durationMs / 1000,
    )
  }

  llmTokens(type: TokenType, count: number): void {
    llmTokensTotal.inc({ type }, count)
  }

  intentDetected(responseType: LlmResponseType): void {
    intentDetectionsTotal.inc({ response_type: responseType })
  }

  imageGeneration(status: ImageGenerationStatus): void {
    imageGenerationsTotal.inc({ status })
  }

  responseSent(status: ResponseSentStatus): void {
    responsesSentTotal.inc({ status })
  }

  commandExecuted(command: string): void {
    commandsExecutedTotal.inc({ command })
  }
}
