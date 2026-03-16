import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { TextBasedChannel } from 'discord.js'

import { MAX_SEND_TYPING_COUNT, TYPING_DELAY_MS } from 'src/constants/chat'
import { ErrorCategory } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

interface ChannelTypingState {
  interval: NodeJS.Timeout | null
  typingCount: number
}

function canSendTyping(ch: TextBasedChannel): ch is TextBasedChannel & {
  sendTyping(): Promise<void>
  send(content: string): Promise<unknown>
} {
  return 'sendTyping' in ch && 'send' in ch
}

@Injectable()
export class TypingIndicatorService implements OnModuleDestroy {
  private readonly logger = new Logger(TypingIndicatorService.name)
  private readonly channels = new Map<string, ChannelTypingState>()

  constructor(private readonly retryService: RetryService) {}

  start(channel: TextBasedChannel): void {
    if (!canSendTyping(channel)) return

    const existing = this.channels.get(channel.id)
    if (existing) {
      if (existing.interval) clearInterval(existing.interval)
      this.channels.delete(channel.id)
    }

    const typableChannel = channel

    const state: ChannelTypingState = {
      interval: null,
      typingCount: 0,
    }

    const sendTyping = async () => {
      if (state.typingCount > MAX_SEND_TYPING_COUNT) {
        this.logger.log(
          { channelId: channel.id },
          'Typing indicator exceeded max count',
        )
        try {
          await this.retryService.executeWithRetry(
            () =>
              typableChannel.send(
                "sorry i'm taking me longer than usual to respond, i'm a little nervous <:Sadge:781403152258826281>",
              ),
            { maxAttempts: 3, baseDelay: 1000, maxDelay: 5000 },
            'Discord-longTypingMessage',
            ErrorCategory.DISCORD_API,
          )
        } catch (error) {
          this.logger.error('Failed to send long typing message', {
            error: error instanceof Error ? error.message : 'Unknown error',
            channelId: channel.id,
          })
        }
        this.stop(channel.id)
        return
      }

      state.typingCount++

      try {
        await this.retryService.executeWithRetry(
          () => typableChannel.sendTyping(),
          { maxAttempts: 2, baseDelay: 500, maxDelay: 2000 },
          'Discord-sendTyping',
          ErrorCategory.DISCORD_API,
        )
      } catch (error) {
        this.logger.warn('Failed to send typing indicator', {
          error: error instanceof Error ? error.message : 'Unknown error',
          channelId: channel.id,
        })
      }
    }

    void sendTyping()
    state.interval = setInterval(sendTyping, TYPING_DELAY_MS)
    this.channels.set(channel.id, state)
  }

  stop(channelId: string): void {
    const state = this.channels.get(channelId)
    if (!state) return

    if (state.interval) clearInterval(state.interval)
    this.channels.delete(channelId)
  }

  onModuleDestroy(): void {
    for (const [, state] of this.channels) {
      if (state.interval) clearInterval(state.interval)
    }
    this.channels.clear()
  }
}
