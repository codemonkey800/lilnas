import { Injectable } from '@nestjs/common'
import { Counter, Gauge, Histogram, register } from 'prom-client'

type MessageHandler = 'chat' | 'keywords'
type HandledStatus = 'success' | 'error'
type LlmStatus = 'success' | 'error'
type LlmResponseType = 'default' | 'image' | 'math' | 'media' | 'reminder'
type TokenType = 'prompt_tokens' | 'completion_tokens' | 'total_tokens'
type ImageGenerationStatus = 'success' | 'error'
type ResponseSentStatus =
  | 'success'
  | 'shortened'
  | 'truncated'
  | 'error'
  | 'fallback'
type ReminderType = 'recurring' | 'one_time'

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

const remindersCreatedTotal = new Counter({
  name: 'tdr_reminders_created_total',
  help: 'Total number of reminders created',
  labelNames: ['type'],
  registers: [register],
})

const remindersDeliveredTotal = new Counter({
  name: 'tdr_reminders_delivered_total',
  help: 'Total number of reminders successfully delivered',
  registers: [register],
})

const remindersCancelledTotal = new Counter({
  name: 'tdr_reminders_cancelled_total',
  help: 'Total number of reminders cancelled',
  registers: [register],
})

const remindersFailedTotal = new Counter({
  name: 'tdr_reminders_failed_total',
  help: 'Total number of reminder delivery failures',
  labelNames: ['reason'],
  registers: [register],
})

const remindersActive = new Gauge({
  name: 'tdr_reminders_active',
  help: 'Number of currently active reminders',
  labelNames: ['type'],
  registers: [register],
})

/**
 * Thin wrapper around Prometheus counters, gauges, and histograms
 * that exposes domain-specific recording methods for the TDR Bot.
 *
 * All metrics are registered with the default `prom-client` registry
 * and scraped at `/metrics` by Prometheus.
 */
@Injectable()
export class TdrBotMetricsService {
  /** Increments the total messages-received counter for the given handler. */
  messageReceived(handler: MessageHandler): void {
    messagesReceivedTotal.inc({ handler })
  }

  /** Increments the messages-handled counter with the handler and outcome status. */
  messageHandled(handler: MessageHandler, status: HandledStatus): void {
    messagesHandledTotal.inc({ handler, status })
  }

  /** Records an LLM graph invocation keyed by response type and success/error. */
  llmRequest(responseType: LlmResponseType, status: LlmStatus): void {
    llmRequestsTotal.inc({ response_type: responseType, status })
  }

  /** Observes the end-to-end duration of an LLM graph invocation (converted to seconds). */
  observeLlmDuration(responseType: LlmResponseType, durationMs: number): void {
    llmRequestDurationSeconds.observe(
      { response_type: responseType },
      durationMs / 1000,
    )
  }

  /** Increments the token usage counter by the given amount. */
  llmTokens(type: TokenType, count: number): void {
    llmTokensTotal.inc({ type }, count)
  }

  /** Tracks which response type was classified by intent detection. */
  intentDetected(responseType: LlmResponseType): void {
    intentDetectionsTotal.inc({ response_type: responseType })
  }

  /** Records a DALL-E image generation attempt (success or error). */
  imageGeneration(status: ImageGenerationStatus): void {
    imageGenerationsTotal.inc({ status })
  }

  /** Records the outcome of sending a Discord reply. */
  responseSent(status: ResponseSentStatus): void {
    responsesSentTotal.inc({ status })
  }

  /** Increments the slash-command execution counter. */
  commandExecuted(command: string): void {
    commandsExecutedTotal.inc({ command })
  }

  /** Tracks a newly created reminder and increments the active gauge. */
  reminderCreated(type: ReminderType): void {
    remindersCreatedTotal.inc({ type })
    remindersActive.inc({ type })
  }

  /** Increments the successful-delivery counter. */
  reminderDelivered(): void {
    remindersDeliveredTotal.inc()
  }

  /** Records a cancellation and decrements the active gauge. */
  reminderCancelled(type: ReminderType): void {
    remindersCancelledTotal.inc()
    remindersActive.dec({ type })
  }

  /** Records a reminder delivery failure with a descriptive reason label. */
  reminderFailed(reason: string): void {
    remindersFailedTotal.inc({ reason })
  }

  /** Decrements the active-reminders gauge (e.g. after a one-time reminder fires). */
  reminderActiveDecrement(type: ReminderType): void {
    remindersActive.dec({ type })
  }
}
