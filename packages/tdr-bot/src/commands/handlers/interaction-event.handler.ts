import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'

import { parseCustomId } from 'src/commands/media-search.types'
import { MessageComponentInteraction } from 'src/types/discord.types'
import { EventType } from 'src/types/enums'

import { MediaSearchInteractionHandler } from './media-search-interaction.handler'

interface UserInteractionEventWithInteraction {
  stateId: string
  correlationId: string
  userId: string
  componentType: number
  customId: string
  timestamp: Date
  interaction: MessageComponentInteraction
}

@Injectable()
export class InteractionEventHandler {
  private readonly logger = new Logger(InteractionEventHandler.name)

  constructor(
    private readonly mediaSearchHandler: MediaSearchInteractionHandler,
  ) {}

  @OnEvent(EventType.USER_INTERACTION)
  async handleUserInteraction(
    event: UserInteractionEventWithInteraction,
  ): Promise<void> {
    this.logger.debug('Handling user interaction event', {
      stateId: event.stateId,
      correlationId: event.correlationId,
      userId: event.userId,
      customId: event.customId,
      componentType: event.componentType,
    })

    try {
      // Check if this is a /media search interaction based on custom ID
      const parsedId = parseCustomId(event.customId)
      if (!parsedId) {
        this.logger.debug('Could not parse custom ID', {
          customId: event.customId,
          correlationId: event.correlationId,
        })
        return
      }

      // Check if this is a /media search related interaction
      if (this.isMediaSearchCustomId(event.customId)) {
        this.logger.debug('Routing to /media search handler', {
          customId: event.customId,
          correlationId: event.correlationId,
          stateId: event.stateId,
          action: parsedId.action,
          userId: event.userId,
          deferred: event.interaction.deferred,
          replied: event.interaction.replied,
        })

        try {
          // Call the /media search handler directly with the real interaction and correct stateId
          await this.mediaSearchHandler.handleInteraction(
            event.interaction,
            event.correlationId,
            event.stateId,
          )

          this.logger.debug('/media search handler completed successfully', {
            customId: event.customId,
            correlationId: event.correlationId,
            stateId: event.stateId,
            action: parsedId.action,
          })
        } catch (handlerError) {
          this.logger.error('/media search handler failed', {
            customId: event.customId,
            correlationId: event.correlationId,
            stateId: event.stateId,
            action: parsedId.action,
            error:
              handlerError instanceof Error
                ? handlerError.message
                : String(handlerError),
          })
          throw handlerError
        }
      } else {
        this.logger.debug('Interaction is not for /media search, ignoring', {
          customId: event.customId,
          correlationId: event.correlationId,
        })
      }
    } catch (error) {
      this.logger.error('Failed to handle user interaction', {
        correlationId: event.correlationId,
        userId: event.userId,
        customId: event.customId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    }
  }

  /**
   * Check if custom ID belongs to /media search interactions
   */
  private isMediaSearchCustomId(customId: string): boolean {
    const mediaSearchActions = [
      'search_results',
      'pagination',
      'media_action',
      'request_action',
      'view_details',
      'play_media',
      'new_search',
      'cancel',
      'back_to_search',
      'pagination_first',
      'pagination_previous',
      'pagination_next',
      'pagination_last',
    ]

    return mediaSearchActions.some(action => customId.startsWith(action))
  }
}
