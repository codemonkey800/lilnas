import { Injectable, Logger } from '@nestjs/common'
import { ButtonBuilder, ButtonStyle } from 'discord.js'

import {
  ButtonConfig,
  ComponentConstraints,
  MediaActionButtons,
  PaginationButtons,
} from 'src/types/discord.types'
import { ActionType, MediaType } from 'src/types/enums'

@Injectable()
export class ButtonBuilderService {
  private readonly logger = new Logger(ButtonBuilderService.name)

  private readonly constraints: ComponentConstraints = {
    maxActionRows: 5,
    maxComponentsPerRow: 5,
    maxSelectMenuOptions: 25,
    maxSelectMenuValues: 25,
    maxButtonsPerRow: 5,
    maxTextInputsPerModal: 5,
    maxTextInputLength: 4000,
    maxLabelLength: 45,
    maxPlaceholderLength: 100,
    maxCustomIdLength: 100,
  }

  /**
   * Create request action button
   */
  createRequestButton(
    mediaId: string,
    mediaType: MediaType,
    title: string,
    correlationId?: string,
  ): ButtonBuilder {
    const customId = `request_action:${correlationId || 'unknown'}:${mediaType}:${mediaId}`
    const label = 'Request'

    return new ButtonBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setLabel(this.truncateLabel(label))
      .setStyle(ButtonStyle.Success)
      .setEmoji('➕')
  }

  /**
   * Create add to library button
   */
  createAddToLibraryButton(
    mediaId: string,
    mediaType: MediaType,
    correlationId?: string,
  ): ButtonBuilder {
    const customId = `add_library:${correlationId || 'unknown'}:${mediaType}:${mediaId}`
    const label = 'Add to Library'

    return new ButtonBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setLabel(this.truncateLabel(label))
      .setStyle(ButtonStyle.Success)
      .setEmoji('📚')
  }

  /**
   * Create cancel button
   */
  createCancelButton(correlationId?: string): ButtonBuilder {
    const customId = `cancel:${correlationId || 'unknown'}`
    const label = 'Cancel'

    return new ButtonBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setLabel(this.truncateLabel(label))
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  }

  /**
   * Create confirm button
   */
  createConfirmButton(action: string, correlationId?: string): ButtonBuilder {
    const customId = `confirm:${correlationId || 'unknown'}:${action}`
    const label = 'Confirm'

    return new ButtonBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setLabel(this.truncateLabel(label))
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅')
  }

  /**
   * Create pagination buttons
   */
  createPaginationButtons(
    currentPage: number,
    totalPages: number,
    context: string,
    correlationId?: string,
  ): PaginationButtons {
    const baseId = `pagination:${correlationId || 'unknown'}:${context}`

    return {
      first: new ButtonBuilder()
        .setCustomId(this.truncateCustomId(`${baseId}:first`))
        .setLabel('First')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏮️')
        .setDisabled(currentPage === 0),

      previous: new ButtonBuilder()
        .setCustomId(this.truncateCustomId(`${baseId}:prev:${currentPage - 1}`))
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⬅️')
        .setDisabled(currentPage === 0),

      next: new ButtonBuilder()
        .setCustomId(this.truncateCustomId(`${baseId}:next:${currentPage + 1}`))
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('➡️')
        .setDisabled(currentPage >= totalPages - 1),

      last: new ButtonBuilder()
        .setCustomId(this.truncateCustomId(`${baseId}:last`))
        .setLabel('Last')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⏭️')
        .setDisabled(currentPage >= totalPages - 1),
    }
  }

  /**
   * Create media action buttons
   */
  createMediaActionButtons(
    mediaId: string,
    mediaType: MediaType,
    availableActions: ActionType[],
    correlationId?: string,
  ): MediaActionButtons {
    const baseId = `media_action:${correlationId || 'unknown'}:${mediaType}:${mediaId}`

    return {
      play: this.createActionButton(ActionType.PLAY, baseId, availableActions),
      download: this.createActionButton(
        ActionType.DOWNLOAD,
        baseId,
        availableActions,
      ),
      delete: this.createActionButton(
        ActionType.DELETE,
        baseId,
        availableActions,
      ),
      monitor: this.createActionButton(
        ActionType.MONITOR,
        baseId,
        availableActions,
      ),
      unmonitor: this.createActionButton(
        ActionType.UNMONITOR,
        baseId,
        availableActions,
      ),
    }
  }

  /**
   * Create individual action button
   */
  private createActionButton(
    action: ActionType,
    baseId: string,
    availableActions: ActionType[],
  ): ButtonBuilder {
    const isAvailable = availableActions.includes(action)
    const customId = `${baseId}:${action}`

    const buttonConfig: Record<
      ActionType,
      { label: string; emoji: string; style: ButtonStyle }
    > = {
      [ActionType.PLAY]: {
        label: 'Play',
        emoji: '▶️',
        style: ButtonStyle.Primary,
      },
      [ActionType.DOWNLOAD]: {
        label: 'Download',
        emoji: '⬇️',
        style: ButtonStyle.Success,
      },
      [ActionType.DELETE]: {
        label: 'Delete',
        emoji: '🗑️',
        style: ButtonStyle.Danger,
      },
      [ActionType.MONITOR]: {
        label: 'Monitor',
        emoji: '👁️',
        style: ButtonStyle.Secondary,
      },
      [ActionType.UNMONITOR]: {
        label: 'Stop Monitoring',
        emoji: '🚫',
        style: ButtonStyle.Secondary,
      },
      [ActionType.ADD]: {
        label: 'Add',
        emoji: '➕',
        style: ButtonStyle.Success,
      },
      [ActionType.REQUEST]: {
        label: 'Request',
        emoji: '📝',
        style: ButtonStyle.Primary,
      },
      [ActionType.CANCEL]: {
        label: 'Cancel',
        emoji: '❌',
        style: ButtonStyle.Danger,
      },
      [ActionType.CONFIRM]: {
        label: 'Confirm',
        emoji: '✅',
        style: ButtonStyle.Success,
      },
      [ActionType.VIEW]: {
        label: 'View',
        emoji: 'ℹ️',
        style: ButtonStyle.Secondary,
      },
    }

    const config = buttonConfig[action] || {
      label: action,
      emoji: '⚙️',
      style: ButtonStyle.Secondary,
    }

    return new ButtonBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setLabel(this.truncateLabel(config.label))
      .setStyle(config.style)
      .setEmoji(config.emoji)
      .setDisabled(!isAvailable)
  }

  /**
   * Create URL button (for external links)
   */
  createUrlButton(label: string, url: string, emoji?: string): ButtonBuilder {
    const button = new ButtonBuilder()
      .setLabel(this.truncateLabel(label))
      .setStyle(ButtonStyle.Link)
      .setURL(url)

    if (emoji) {
      button.setEmoji(emoji)
    }

    return button
  }

  /**
   * Create Emby playback button
   */
  createEmbyPlaybackButton(
    mediaId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mediaType: MediaType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _title: string,
  ): ButtonBuilder {
    const embyUrl = `${process.env.EMBY_BASE_URL}/web/index.html#!/item?id=${mediaId}`
    const label = `Play in Emby`

    return this.createUrlButton(label, embyUrl, '📺')
  }

  /**
   * Create button from config
   */
  createButton(config: ButtonConfig): ButtonBuilder {
    const button = new ButtonBuilder()
      .setCustomId(this.truncateCustomId(config.customId))
      .setLabel(this.truncateLabel(config.label))
      .setStyle(config.style)

    if (config.emoji) {
      button.setEmoji(config.emoji)
    }

    if (config.disabled) {
      button.setDisabled(true)
    }

    if (config.url) {
      button.setURL(config.url)
      button.setStyle(ButtonStyle.Link)
    }

    return button
  }

  /**
   * Create context-aware action buttons based on media state
   */
  createContextButtons(
    mediaId: string,
    mediaType: MediaType,
    inLibrary: boolean,
    isMonitored: boolean,
    hasFiles: boolean,
    correlationId?: string,
  ): ButtonBuilder[] {
    const buttons: ButtonBuilder[] = []

    if (!inLibrary) {
      // Not in library - show request/add button
      buttons.push(
        this.createRequestButton(mediaId, mediaType, '', correlationId),
      )
    } else {
      // In library - show various management buttons
      if (hasFiles) {
        buttons.push(this.createEmbyPlaybackButton(mediaId, mediaType, ''))
      }

      if (isMonitored) {
        buttons.push(
          this.createActionButton(
            ActionType.UNMONITOR,
            `media_action:${correlationId}:${mediaType}:${mediaId}`,
            [ActionType.UNMONITOR],
          ),
        )
      } else {
        buttons.push(
          this.createActionButton(
            ActionType.MONITOR,
            `media_action:${correlationId}:${mediaType}:${mediaId}`,
            [ActionType.MONITOR],
          ),
        )
      }
    }

    return buttons
  }

  /**
   * Truncate label to fit constraints
   */
  private truncateLabel(label: string): string {
    return this.truncateText(label, this.constraints.maxLabelLength)
  }

  /**
   * Truncate custom ID to fit constraints
   */
  private truncateCustomId(customId: string): string {
    return this.truncateText(customId, this.constraints.maxCustomIdLength, '')
  }

  /**
   * Truncate text to fit constraints
   */
  private truncateText(
    text: string,
    maxLength: number,
    suffix = '...',
  ): string {
    if (text.length <= maxLength) {
      return text
    }
    return text.substring(0, maxLength - suffix.length) + suffix
  }

  /**
   * Get constraint limits
   */
  getConstraints(): ComponentConstraints {
    return { ...this.constraints }
  }
}
