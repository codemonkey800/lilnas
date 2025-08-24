import { Injectable, Logger } from '@nestjs/common'
import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
} from 'discord.js'

import { ErrorContext, MediaErrorHandler } from 'src/media/errors/error-utils'
import {
  ComponentCreationError,
  ComponentValidationError,
} from 'src/media/errors/media-errors'
import {
  ButtonConfig,
  ComponentConstraints,
  EmbedConfig,
  extractActionRowData,
  extractButtonData,
  extractEmbedData,
  extractModalData,
  extractSelectMenuData,
  ModalConfig,
  SelectMenuConfig,
  ValidationResult,
} from 'src/types/discord.types'

import { ActionRowBuilderService } from './action-row.builder'
import { ButtonBuilderService } from './button.builder'
import { ModalBuilderService } from './modal.builder'
import { SelectMenuBuilderService } from './select-menu.builder'

@Injectable()
export class ComponentFactoryService {
  private readonly logger = new Logger(ComponentFactoryService.name)
  private readonly errorHandler: MediaErrorHandler

  constructor(
    private readonly actionRowBuilder: ActionRowBuilderService,
    private readonly buttonBuilder: ButtonBuilderService,
    private readonly selectMenuBuilder: SelectMenuBuilderService,
    private readonly modalBuilder: ModalBuilderService,
  ) {
    this.errorHandler = new MediaErrorHandler(this.logger)
  }

  /**
   * Create an action row with the provided components
   * @throws {ComponentCreationError} When components are invalid or incompatible
   */
  createActionRow<T extends ButtonBuilder | StringSelectMenuBuilder>(
    components: T[],
    correlationId?: string,
  ): ActionRowBuilder<T> {
    const context: ErrorContext = {
      correlationId,
      operation: 'create_action_row',
    }

    if (components.length === 0) {
      throw new ComponentCreationError(
        'action_row',
        'Cannot create action row with no components',
        correlationId,
        { componentCount: 0 },
      )
    }

    // Check if all components are of the same type
    const firstComponentType = components[0].constructor.name
    const allSameType = components.every(
      c => c.constructor.name === firstComponentType,
    )

    if (!allSameType) {
      throw new ComponentCreationError(
        'action_row',
        'All components in an action row must be of the same type',
        correlationId,
        {
          componentTypes: components.map(c => c.constructor.name),
          firstType: firstComponentType,
        },
      )
    }

    try {
      // Use constructor name checks for better test compatibility
      if (
        firstComponentType === 'ButtonBuilder' ||
        components[0] instanceof ButtonBuilder
      ) {
        return this.actionRowBuilder.createButtonRow(
          components as ButtonBuilder[],
          correlationId,
        ) as ActionRowBuilder<T>
      } else if (
        firstComponentType === 'StringSelectMenuBuilder' ||
        components[0] instanceof StringSelectMenuBuilder
      ) {
        if (components.length > 1) {
          throw new ComponentCreationError(
            'action_row',
            'Only one select menu component allowed per action row',
            correlationId,
            { componentCount: components.length },
          )
        }
        return this.actionRowBuilder.createSelectMenuRow(
          components[0] as StringSelectMenuBuilder,
          correlationId,
        ) as ActionRowBuilder<T>
      } else {
        throw new ComponentCreationError(
          'action_row',
          `Unsupported component type: ${firstComponentType}`,
          correlationId,
          { componentType: firstComponentType },
        )
      }
    } catch (error) {
      if (error instanceof ComponentCreationError) {
        throw error
      }

      const result = this.errorHandler.handleError(error, context)
      throw new ComponentCreationError(
        'action_row',
        result.error.message,
        correlationId,
        context,
      )
    }
  }

  /**
   * Create a button from configuration
   * @throws {ComponentCreationError} When button creation fails
   */
  createButton(config: ButtonConfig, correlationId?: string): ButtonBuilder {
    try {
      return this.buttonBuilder.createButton(config)
    } catch (error) {
      const result = this.errorHandler.handleError(error, {
        correlationId,
        operation: 'create_button',
      })
      throw new ComponentCreationError(
        'button',
        result.error.message,
        correlationId,
        { config },
      )
    }
  }

  /**
   * Create a select menu from configuration
   * @throws {ComponentCreationError} When select menu creation fails
   */
  createSelectMenu(
    config: SelectMenuConfig,
    correlationId?: string,
  ): StringSelectMenuBuilder {
    try {
      return this.selectMenuBuilder.createSelectMenu(config)
    } catch (error) {
      const result = this.errorHandler.handleError(error, {
        correlationId,
        operation: 'create_select_menu',
      })
      throw new ComponentCreationError(
        'select_menu',
        result.error.message,
        correlationId,
        { config },
      )
    }
  }

  /**
   * Create a modal from configuration
   * @throws {ComponentCreationError} When modal creation fails
   */
  createModal(config: ModalConfig, correlationId?: string): ModalBuilder {
    try {
      return this.modalBuilder.createModal(config)
    } catch (error) {
      const result = this.errorHandler.handleError(error, {
        correlationId,
        operation: 'create_modal',
      })
      throw new ComponentCreationError(
        'modal',
        result.error.message,
        correlationId,
        { config },
      )
    }
  }

  /**
   * Create an embed from configuration
   * @throws {ComponentCreationError} When embed creation fails
   */
  createEmbed(config: EmbedConfig, correlationId?: string): EmbedBuilder {
    const context: ErrorContext = {
      correlationId,
      operation: 'create_embed',
    }

    try {
      const embed = new EmbedBuilder()

      if (config.title) {
        embed.setTitle(this.truncateText(config.title, 256))
      }

      if (config.description) {
        embed.setDescription(this.truncateText(config.description, 4096))
      }

      if (config.color !== undefined) {
        embed.setColor(config.color)
      }

      if (config.author) {
        embed.setAuthor({
          name: this.truncateText(config.author.name, 256),
          iconURL: config.author.iconURL,
          url: config.author.url,
        })
      }

      if (config.thumbnail) {
        embed.setThumbnail(config.thumbnail.url)
      }

      if (config.image) {
        embed.setImage(config.image.url)
      }

      if (config.footer) {
        embed.setFooter({
          text: this.truncateText(config.footer.text, 2048),
          iconURL: config.footer.iconURL,
        })
      }

      if (config.timestamp) {
        embed.setTimestamp(config.timestamp)
      }

      if (config.url) {
        embed.setURL(config.url)
      }

      if (config.fields) {
        const validFields = config.fields
          .slice(0, 25) // Max 25 fields
          .map(field => ({
            name: this.truncateText(field.name, 256),
            value: this.truncateText(field.value, 1024),
            inline: field.inline,
          }))

        embed.addFields(validFields)
      }

      this.logger.debug('Created embed from config', {
        correlationId,
        title: config.title,
        fieldCount: config.fields?.length || 0,
        hasAuthor: !!config.author,
        hasFooter: !!config.footer,
        hasImage: !!config.image,
        hasThumbnail: !!config.thumbnail,
      })

      return embed
    } catch (error) {
      const result = this.errorHandler.handleError(error, context)
      throw new ComponentCreationError(
        'embed',
        result.error.message,
        correlationId,
        { config },
      )
    }
  }

  /**
   * Validate component constraints
   * @throws {ComponentValidationError} When component validation fails
   */
  validateConstraints(component: unknown, correlationId?: string): void {
    const componentType = this.getComponentType(component)

    switch (componentType) {
      case 'ButtonBuilder':
        this.validateButton(component as ButtonBuilder, correlationId)
        break
      case 'StringSelectMenuBuilder':
        this.validateSelectMenu(
          component as StringSelectMenuBuilder,
          correlationId,
        )
        break
      case 'ModalBuilder':
        this.validateModal(component as ModalBuilder, correlationId)
        break
      case 'EmbedBuilder':
        this.validateEmbed(component as EmbedBuilder, correlationId)
        break
      case 'ActionRowBuilder':
        this.validateActionRow(component as ActionRowBuilder, correlationId)
        break
      default:
        throw new ComponentValidationError(
          'Unknown component type',
          'component',
          'UNKNOWN_TYPE',
          correlationId,
          { componentType: typeof component, detectedType: componentType },
        )
    }
  }

  /**
   * Legacy validation method that returns results instead of throwing
   * @deprecated Use validateConstraints() which throws errors consistently
   */
  validateConstraintsLegacy(
    component: unknown,
    correlationId?: string,
  ): ValidationResult {
    try {
      this.validateConstraints(component, correlationId)
      return {
        valid: true,
        errors: [],
        warnings: [],
      }
    } catch (error) {
      if (error instanceof ComponentValidationError) {
        return {
          valid: false,
          errors: [
            {
              field: error.field,
              message: error.message,
              code: error.validationCode,
            },
          ],
          warnings: [],
        }
      }

      return {
        valid: false,
        errors: [
          {
            field: 'component',
            message: error instanceof Error ? error.message : String(error),
            code: 'VALIDATION_ERROR',
          },
        ],
        warnings: [],
      }
    }
  }

  /**
   * Validate button constraints
   * @throws {ComponentValidationError} When button validation fails
   */
  private validateButton(button: ButtonBuilder, correlationId?: string): void {
    const constraints = this.getConstraints()

    if (!this.hasCustomIdOrUrl(button)) {
      throw new ComponentValidationError(
        'Button must have either custom_id or url',
        'button',
        'MISSING_ID_OR_URL',
        correlationId,
      )
    }

    const customId = this.getButtonCustomId(button)
    if (customId && customId.length > constraints.maxCustomIdLength) {
      throw new ComponentValidationError(
        `Custom ID too long: ${customId.length} (max: ${constraints.maxCustomIdLength})`,
        'custom_id',
        'CUSTOM_ID_TOO_LONG',
        correlationId,
        {
          customIdLength: customId.length,
          maxLength: constraints.maxCustomIdLength,
        },
      )
    }

    const label = this.getButtonLabel(button)
    if (label && label.length > constraints.maxLabelLength) {
      throw new ComponentValidationError(
        `Label too long: ${label.length} (max: ${constraints.maxLabelLength})`,
        'label',
        'LABEL_TOO_LONG',
        correlationId,
        { labelLength: label.length, maxLength: constraints.maxLabelLength },
      )
    }

    if (!this.hasLabelOrEmoji(button)) {
      throw new ComponentValidationError(
        'Button must have either label or emoji',
        'button',
        'MISSING_LABEL_OR_EMOJI',
        correlationId,
      )
    }
  }

  /**
   * Validate select menu constraints
   * @throws {ComponentValidationError} When select menu validation fails
   */
  private validateSelectMenu(
    selectMenu: StringSelectMenuBuilder,
    correlationId?: string,
  ): void {
    const constraints = this.getConstraints()
    const { customId, options } = extractSelectMenuData(selectMenu)

    if (!customId) {
      throw new ComponentValidationError(
        'Select menu must have a custom_id',
        'custom_id',
        'MISSING_CUSTOM_ID',
        correlationId,
      )
    }

    if (customId && customId.length > constraints.maxCustomIdLength) {
      throw new ComponentValidationError(
        `Custom ID too long: ${customId.length} (max: ${constraints.maxCustomIdLength})`,
        'custom_id',
        'CUSTOM_ID_TOO_LONG',
        correlationId,
        {
          customIdLength: customId.length,
          maxLength: constraints.maxCustomIdLength,
        },
      )
    }

    if (!options || options.length === 0) {
      throw new ComponentValidationError(
        'Select menu must have at least one option',
        'options',
        'NO_OPTIONS',
        correlationId,
      )
    }

    if (options && options.length > constraints.maxSelectMenuOptions) {
      throw new ComponentValidationError(
        `Too many options: ${options.length} (max: ${constraints.maxSelectMenuOptions})`,
        'options',
        'TOO_MANY_OPTIONS',
        correlationId,
        {
          optionCount: options.length,
          maxOptions: constraints.maxSelectMenuOptions,
        },
      )
    }
  }

  /**
   * Validate modal constraints
   * @throws {ComponentValidationError} When modal validation fails
   */
  private validateModal(modal: ModalBuilder, correlationId?: string): void {
    const constraints = this.getConstraints()
    const { customId, title, components } = extractModalData(modal)

    if (!customId) {
      throw new ComponentValidationError(
        'Modal must have a custom_id',
        'custom_id',
        'MISSING_CUSTOM_ID',
        correlationId,
      )
    }

    if (!title) {
      throw new ComponentValidationError(
        'Modal must have a title',
        'title',
        'MISSING_TITLE',
        correlationId,
      )
    }

    if (!components || components.length === 0) {
      throw new ComponentValidationError(
        'Modal must have at least one component',
        'components',
        'NO_COMPONENTS',
        correlationId,
      )
    }

    if (components && components.length > constraints.maxTextInputsPerModal) {
      throw new ComponentValidationError(
        `Too many components: ${components.length} (max: ${constraints.maxTextInputsPerModal})`,
        'components',
        'TOO_MANY_COMPONENTS',
        correlationId,
        {
          componentCount: components.length,
          maxComponents: constraints.maxTextInputsPerModal,
        },
      )
    }
  }

  /**
   * Validate embed constraints
   * @throws {ComponentValidationError} When embed validation fails
   */
  private validateEmbed(embed: EmbedBuilder, correlationId?: string): void {
    const { title, description, fields, author, footer } =
      extractEmbedData(embed)

    if (title && title.length > 256) {
      throw new ComponentValidationError(
        `Embed title too long: ${title.length} (max: 256)`,
        'title',
        'TITLE_TOO_LONG',
        correlationId,
        { titleLength: title.length, maxLength: 256 },
      )
    }

    if (description && description.length > 4096) {
      throw new ComponentValidationError(
        `Embed description too long: ${description.length} (max: 4096)`,
        'description',
        'DESCRIPTION_TOO_LONG',
        correlationId,
        { descriptionLength: description.length, maxLength: 4096 },
      )
    }

    if (fields && fields.length > 25) {
      throw new ComponentValidationError(
        `Too many embed fields: ${fields.length} (max: 25)`,
        'fields',
        'TOO_MANY_FIELDS',
        correlationId,
        { fieldCount: fields.length, maxFields: 25 },
      )
    }

    // Check total embed character limit (approx 6000)
    const totalLength = [
      title?.length || 0,
      description?.length || 0,
      author?.name?.length || 0,
      footer?.text?.length || 0,
      ...(fields?.map(f => (f.name?.length || 0) + (f.value?.length || 0)) ||
        []),
    ].reduce((sum, len) => sum + len, 0)

    if (totalLength > 6000) {
      throw new ComponentValidationError(
        `Total embed content too long: ${totalLength} (max: ~6000)`,
        'embed',
        'EMBED_TOO_LONG',
        correlationId,
        { totalLength, maxLength: 6000 },
      )
    }
  }

  /**
   * Validate action row constraints
   * @throws {ComponentValidationError} When action row validation fails
   */
  private validateActionRow(
    actionRow: ActionRowBuilder,
    correlationId?: string,
  ): void {
    const constraints = this.getConstraints()
    const { components } = extractActionRowData(actionRow)

    if (!components || components.length === 0) {
      throw new ComponentValidationError(
        'Action row must have at least one component',
        'components',
        'EMPTY_ACTION_ROW',
        correlationId,
      )
    }

    if (components && components.length > constraints.maxComponentsPerRow) {
      throw new ComponentValidationError(
        `Too many components in action row: ${components.length} (max: ${constraints.maxComponentsPerRow})`,
        'components',
        'TOO_MANY_COMPONENTS',
        correlationId,
        {
          componentCount: components.length,
          maxComponents: constraints.maxComponentsPerRow,
        },
      )
    }
  }

  /**
   * Get constraint limits
   */
  private getConstraints(): ComponentConstraints {
    return {
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
   * Get button custom ID safely using type guard
   */
  private getButtonCustomId(button: ButtonBuilder): string | undefined {
    const { customId } = extractButtonData(button)
    return customId
  }

  /**
   * Get button URL safely using type guard
   */
  private getButtonUrl(button: ButtonBuilder): string | undefined {
    const { url } = extractButtonData(button)
    return url
  }

  /**
   * Get button label safely using type guard
   */
  private getButtonLabel(button: ButtonBuilder): string | undefined {
    const { label } = extractButtonData(button)
    return label
  }

  /**
   * Get button emoji safely using type guard
   */
  private getButtonEmoji(button: ButtonBuilder): unknown | undefined {
    const { emoji } = extractButtonData(button)
    return emoji
  }

  /**
   * Check if button has custom_id or url
   */
  private hasCustomIdOrUrl(button: ButtonBuilder): boolean {
    const customId = this.getButtonCustomId(button)
    const url = this.getButtonUrl(button)
    return Boolean(customId || url)
  }

  /**
   * Check if button has label or emoji
   */
  private hasLabelOrEmoji(button: ButtonBuilder): boolean {
    const label = this.getButtonLabel(button)
    const emoji = this.getButtonEmoji(button)
    return Boolean(label || emoji)
  }

  /**
   * Determine component type for both real and mock Discord.js components
   */
  private getComponentType(component: unknown): string | null {
    if (!component || typeof component !== 'object') {
      return null
    }

    // First try instanceof checks for real Discord.js components
    if (component instanceof ButtonBuilder) {
      return 'ButtonBuilder'
    }
    if (component instanceof StringSelectMenuBuilder) {
      return 'StringSelectMenuBuilder'
    }
    if (component instanceof ModalBuilder) {
      return 'ModalBuilder'
    }
    if (component instanceof EmbedBuilder) {
      return 'EmbedBuilder'
    }
    if (component instanceof ActionRowBuilder) {
      return 'ActionRowBuilder'
    }

    // For mock components, check constructor name
    const obj = component as unknown as { constructor?: { name?: string } }
    if (obj.constructor && obj.constructor.name) {
      const constructorName = obj.constructor.name
      if (
        [
          'ButtonBuilder',
          'StringSelectMenuBuilder',
          'ModalBuilder',
          'EmbedBuilder',
          'ActionRowBuilder',
        ].includes(constructorName)
      ) {
        return constructorName
      }

      // Handle mock constructor functions that might have different names
      if (constructorName === 'MockButtonBuilder') {
        return 'ButtonBuilder'
      }
      if (constructorName === 'MockStringSelectMenuBuilder') {
        return 'StringSelectMenuBuilder'
      }
      if (constructorName === 'MockModalBuilder') {
        return 'ModalBuilder'
      }
      if (constructorName === 'MockEmbedBuilder') {
        return 'EmbedBuilder'
      }
      if (constructorName === 'MockActionRowBuilder') {
        return 'ActionRowBuilder'
      }
    }

    // Additional fallback: check for distinctive properties
    if (typeof obj === 'object' && obj !== null && 'data' in obj) {
      const component = obj as Record<string, unknown>
      // Check for button-like properties
      if (
        'setCustomId' in component &&
        'setLabel' in component &&
        'setStyle' in component
      ) {
        return 'ButtonBuilder'
      }
      // Check for select menu-like properties
      if (
        'setCustomId' in component &&
        'setPlaceholder' in component &&
        'addOptions' in component
      ) {
        return 'StringSelectMenuBuilder'
      }
      // Check for modal-like properties
      if (
        'setCustomId' in component &&
        'setTitle' in component &&
        'addComponents' in component
      ) {
        return 'ModalBuilder'
      }
      // Check for embed-like properties
      if (
        'setTitle' in component &&
        'setDescription' in component &&
        'setColor' in component &&
        'addFields' in component
      ) {
        return 'EmbedBuilder'
      }
      // Check for action row-like properties
      if (
        'addComponents' in component &&
        'setComponents' in component &&
        'components' in component
      ) {
        return 'ActionRowBuilder'
      }
    }

    return null
  }
}
