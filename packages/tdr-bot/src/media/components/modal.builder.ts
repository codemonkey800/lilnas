import { Injectable, Logger } from '@nestjs/common'
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'

import {
  ComponentConstraints,
  ModalComponentConfig,
  ModalConfig,
  ModalTextInputs,
} from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

@Injectable()
export class ModalBuilderService {
  private readonly logger = new Logger(ModalBuilderService.name)

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
   * Create search modal for media queries
   */
  createSearchModal(
    mediaType: MediaType,
    correlationId?: string,
  ): ModalBuilder {
    const customId = `search_modal:${correlationId || 'unknown'}:${mediaType}`
    const title = `Search ${mediaType === MediaType.MOVIE ? 'Movies' : 'TV Series'}`

    const searchInput = new TextInputBuilder()
      .setCustomId('search_term')
      .setLabel('Search Query')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(`Enter ${mediaType} title, year, or IMDB/TMDB ID...`)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(100)

    const yearInput = new TextInputBuilder()
      .setCustomId('year')
      .setLabel('Year (Optional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g., 2023')
      .setRequired(false)
      .setMinLength(4)
      .setMaxLength(4)

    const modal = new ModalBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setTitle(this.truncateText(title, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(searchInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(yearInput),
      )

    this.logger.debug('Created search modal', {
      correlationId,
      mediaType,
      customId,
      title,
    })

    return modal
  }

  /**
   * Create request modal for adding media to library
   */
  createRequestModal(
    mediaId: string,
    mediaType: MediaType,
    title: string,
    correlationId?: string,
  ): ModalBuilder {
    const customId = `request_modal:${correlationId || 'unknown'}:${mediaType}:${mediaId}`
    const modalTitle = `Request ${mediaType === MediaType.MOVIE ? 'Movie' : 'Series'}`

    const components: ActionRowBuilder<TextInputBuilder>[] = []

    // Quality profile selection (text input as fallback for select menu)
    const qualityInput = new TextInputBuilder()
      .setCustomId('quality_profile_id')
      .setLabel('Quality Profile ID')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Leave empty for default quality profile')
      .setRequired(false)
      .setMinLength(1)
      .setMaxLength(10)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(qualityInput),
    )

    // Root folder selection (text input as fallback)
    const rootFolderInput = new TextInputBuilder()
      .setCustomId('root_folder_path')
      .setLabel('Storage Location')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Leave empty for default folder')
      .setRequired(false)
      .setMaxLength(200)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(rootFolderInput),
    )

    // Episode specification for series
    if (mediaType === MediaType.SERIES) {
      const episodeInput = new TextInputBuilder()
        .setCustomId('episode_spec')
        .setLabel('Episodes to Monitor')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g., S1, S1E1-5, S1-3, or leave empty for all')
        .setRequired(false)
        .setMaxLength(50)

      components.push(
        new ActionRowBuilder<TextInputBuilder>().addComponents(episodeInput),
      )
    }

    // Tags input
    const tagsInput = new TextInputBuilder()
      .setCustomId('tags')
      .setLabel('Tags (Optional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Comma-separated tags, e.g., family, action')
      .setRequired(false)
      .setMaxLength(100)

    components.push(
      new ActionRowBuilder<TextInputBuilder>().addComponents(tagsInput),
    )

    const modal = new ModalBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setTitle(this.truncateText(modalTitle, 45))
      .addComponents(
        ...components.slice(0, this.constraints.maxTextInputsPerModal),
      )

    this.logger.debug('Created request modal', {
      correlationId,
      mediaType,
      mediaId,
      title: title,
      customId,
      componentCount: components.length,
    })

    return modal
  }

  /**
   * Create episode specification modal for series
   */
  createEpisodeModal(
    seriesId: string,
    seriesTitle: string,
    correlationId?: string,
  ): ModalBuilder {
    const customId = `episode_modal:${correlationId || 'unknown'}:${seriesId}`
    const title = 'Episode Selection'

    const episodeSpecInput = new TextInputBuilder()
      .setCustomId('episode_specification')
      .setLabel('Episode Specification')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(
        'Examples:\nS1 - Entire season 1\nS1E5 - Season 1, Episode 5\nS1E1-10 - Season 1, Episodes 1-10\nS1-3 - Seasons 1 through 3',
      )
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(200)

    const monitoringInput = new TextInputBuilder()
      .setCustomId('monitoring_options')
      .setLabel('Monitoring Options')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('future, missing, existing, all (default: future)')
      .setRequired(false)
      .setMaxLength(50)

    const modal = new ModalBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setTitle(this.truncateText(title, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          episodeSpecInput,
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(monitoringInput),
      )

    this.logger.debug('Created episode modal', {
      correlationId,
      seriesId,
      seriesTitle,
      customId,
    })

    return modal
  }

  /**
   * Create settings modal for media management
   */
  createSettingsModal(context: string, correlationId?: string): ModalBuilder {
    const customId = `settings_modal:${correlationId || 'unknown'}:${context}`
    const title = 'Media Settings'

    const defaultQualityInput = new TextInputBuilder()
      .setCustomId('default_quality_profile')
      .setLabel('Default Quality Profile')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Quality profile name or ID')
      .setRequired(false)
      .setMaxLength(50)

    const defaultRootFolderInput = new TextInputBuilder()
      .setCustomId('default_root_folder')
      .setLabel('Default Root Folder')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Default storage path')
      .setRequired(false)
      .setMaxLength(200)

    const autoSearchInput = new TextInputBuilder()
      .setCustomId('auto_search_settings')
      .setLabel('Auto Search Settings')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(
        'Enable auto search on add: true/false\nSearch delay (minutes): 5',
      )
      .setRequired(false)
      .setMaxLength(300)

    const modal = new ModalBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setTitle(this.truncateText(title, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          defaultQualityInput,
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          defaultRootFolderInput,
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(autoSearchInput),
      )

    this.logger.debug('Created settings modal', {
      correlationId,
      context,
      customId,
    })

    return modal
  }

  /**
   * Create generic modal from configuration
   */
  createModal(config: ModalConfig): ModalBuilder {
    const components: ActionRowBuilder<TextInputBuilder>[] = []

    for (const inputConfig of config.components.slice(
      0,
      this.constraints.maxTextInputsPerModal,
    )) {
      const textInput = this.createTextInput(inputConfig)
      components.push(
        new ActionRowBuilder<TextInputBuilder>().addComponents(textInput),
      )
    }

    const modal = new ModalBuilder()
      .setCustomId(this.truncateCustomId(config.customId))
      .setTitle(this.truncateText(config.title, 45))
      .addComponents(...components)

    this.logger.debug('Created modal from config', {
      customId: config.customId,
      title: config.title,
      componentCount: components.length,
    })

    return modal
  }

  /**
   * Create text input components collection
   */
  createTextInputs(): ModalTextInputs {
    return {
      searchTerm: new TextInputBuilder()
        .setCustomId('search_term')
        .setLabel('Search Term')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter search query...')
        .setRequired(true)
        .setMaxLength(100),

      episodeSpec: new TextInputBuilder()
        .setCustomId('episode_spec')
        .setLabel('Episode Specification')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('e.g., S1E1-10, S1-3, or leave empty for all')
        .setRequired(false)
        .setMaxLength(200),

      customPath: new TextInputBuilder()
        .setCustomId('custom_path')
        .setLabel('Custom Path')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('/path/to/media/folder')
        .setRequired(false)
        .setMaxLength(300),

      tags: new TextInputBuilder()
        .setCustomId('tags')
        .setLabel('Tags')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('tag1, tag2, tag3')
        .setRequired(false)
        .setMaxLength(100),

      notes: new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Additional notes or comments...')
        .setRequired(false)
        .setMaxLength(500),
    }
  }

  /**
   * Create text input from configuration
   */
  private createTextInput(config: ModalComponentConfig): TextInputBuilder {
    const textInput = new TextInputBuilder()
      .setCustomId(this.truncateCustomId(config.customId))
      .setLabel(
        this.truncateText(config.label, this.constraints.maxLabelLength),
      )
      .setStyle(config.style)

    if (config.placeholder) {
      textInput.setPlaceholder(
        this.truncateText(
          config.placeholder,
          this.constraints.maxPlaceholderLength,
        ),
      )
    }

    if (config.required !== undefined) {
      textInput.setRequired(config.required)
    }

    if (config.minLength !== undefined) {
      textInput.setMinLength(Math.max(0, config.minLength))
    }

    if (config.maxLength !== undefined) {
      textInput.setMaxLength(
        Math.min(config.maxLength, this.constraints.maxTextInputLength),
      )
    }

    if (config.value) {
      textInput.setValue(config.value)
    }

    return textInput
  }

  /**
   * Validate modal constraints
   */
  validateModal(modal: ModalBuilder): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!modal.data.custom_id) {
      errors.push('Modal must have a custom_id')
    }

    if (!modal.data.title) {
      errors.push('Modal must have a title')
    }

    if (!modal.data.components || modal.data.components.length === 0) {
      errors.push('Modal must have at least one component')
    }

    if (
      modal.data.components &&
      modal.data.components.length > this.constraints.maxTextInputsPerModal
    ) {
      errors.push(
        `Modal has too many components: ${modal.data.components.length} (max: ${this.constraints.maxTextInputsPerModal})`,
      )
    }

    return {
      valid: errors.length === 0,
      errors,
    }
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
   * Truncate custom ID to fit constraints
   */
  private truncateCustomId(customId: string): string {
    return this.truncateText(customId, this.constraints.maxCustomIdLength, '')
  }

  /**
   * Get constraint limits
   */
  getConstraints(): ComponentConstraints {
    return { ...this.constraints }
  }
}
