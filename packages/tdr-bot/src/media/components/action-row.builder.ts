import { Injectable, Logger } from '@nestjs/common'
import {
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
} from 'discord.js'

import {
  ComponentConstraints,
  extractButtonData,
  ValidationError,
  ValidationResult,
} from 'src/types/discord.types'

@Injectable()
export class ActionRowBuilderService {
  private readonly logger = new Logger(ActionRowBuilderService.name)

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
   * Create an action row with buttons
   */
  createButtonRow(
    buttons: ButtonBuilder[],
    correlationId?: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const validation = this.validateButtonRow(buttons)
    if (!validation.valid) {
      const error = new Error(
        `Button row validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
      )
      this.logger.error('Button row validation failed', {
        correlationId,
        errors: validation.errors,
        buttonCount: buttons.length,
      })
      throw error
    }

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...buttons,
    )

    this.logger.debug('Created button action row', {
      correlationId,
      buttonCount: buttons.length,
      customIds: buttons.map(b => this.getButtonIdentifier(b)).join(', '),
    })

    return actionRow
  }

  /**
   * Create an action row with a select menu
   */
  createSelectMenuRow(
    selectMenu: StringSelectMenuBuilder,
    correlationId?: string,
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const validation = this.validateSelectMenu(selectMenu)
    if (!validation.valid) {
      const error = new Error(
        `Select menu validation failed: ${validation.errors.map(e => e.message).join(', ')}`,
      )
      this.logger.error('Select menu validation failed', {
        correlationId,
        errors: validation.errors,
        customId: selectMenu.data.custom_id,
      })
      throw error
    }

    const actionRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)

    this.logger.debug('Created select menu action row', {
      correlationId,
      customId: selectMenu.data.custom_id,
      optionCount: selectMenu.data.options?.length || 0,
    })

    return actionRow
  }

  /**
   * Create multiple action rows from mixed components with automatic distribution
   */
  createActionRows<T extends ButtonBuilder | StringSelectMenuBuilder>(
    components: T[],
    correlationId?: string,
  ): ActionRowBuilder<T>[] {
    if (components.length === 0) {
      this.logger.warn('Attempted to create action rows with no components', {
        correlationId,
      })
      return []
    }

    const rows: ActionRowBuilder<T>[] = []
    const buttons: ButtonBuilder[] = []
    const selectMenus: StringSelectMenuBuilder[] = []

    // Separate components by type
    for (const component of components) {
      if (component instanceof ButtonBuilder) {
        buttons.push(component)
      } else if (component instanceof StringSelectMenuBuilder) {
        selectMenus.push(component)
      }
    }

    // Create select menu rows (one per row)
    for (const selectMenu of selectMenus) {
      rows.push(new ActionRowBuilder<T>().addComponents(selectMenu as T))
    }

    // Create button rows (up to 5 buttons per row)
    for (
      let i = 0;
      i < buttons.length;
      i += this.constraints.maxButtonsPerRow
    ) {
      const rowButtons = buttons.slice(i, i + this.constraints.maxButtonsPerRow)
      rows.push(new ActionRowBuilder<T>().addComponents(...(rowButtons as T[])))
    }

    // Validate total row count
    if (rows.length > this.constraints.maxActionRows) {
      const error = new Error(
        `Too many action rows: ${rows.length} (max: ${this.constraints.maxActionRows})`,
      )
      this.logger.error('Too many action rows created', {
        correlationId,
        rowCount: rows.length,
        maxRows: this.constraints.maxActionRows,
        buttonCount: buttons.length,
        selectMenuCount: selectMenus.length,
      })
      throw error
    }

    this.logger.debug('Created action rows', {
      correlationId,
      totalRows: rows.length,
      buttonCount: buttons.length,
      selectMenuCount: selectMenus.length,
    })

    return rows
  }

  /**
   * Validate button row constraints
   */
  private validateButtonRow(buttons: ButtonBuilder[]): ValidationResult {
    const errors: ValidationError[] = []

    if (buttons.length === 0) {
      errors.push({
        field: 'buttons',
        message: 'Button row cannot be empty',
        code: 'EMPTY_ROW',
      })
    }

    if (buttons.length > this.constraints.maxButtonsPerRow) {
      errors.push({
        field: 'buttons',
        message: `Too many buttons in row: ${buttons.length} (max: ${this.constraints.maxButtonsPerRow})`,
        code: 'TOO_MANY_BUTTONS',
      })
    }

    // Validate individual buttons
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i]
      const buttonErrors = this.validateButton(button, i)
      errors.push(...buttonErrors)
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    }
  }

  /**
   * Validate select menu constraints
   */
  private validateSelectMenu(
    selectMenu: StringSelectMenuBuilder,
  ): ValidationResult {
    const errors: ValidationError[] = []

    if (!selectMenu.data.custom_id) {
      errors.push({
        field: 'custom_id',
        message: 'Select menu must have a custom_id',
        code: 'MISSING_CUSTOM_ID',
      })
    }

    if (
      selectMenu.data.custom_id &&
      selectMenu.data.custom_id.length > this.constraints.maxCustomIdLength
    ) {
      errors.push({
        field: 'custom_id',
        message: `Custom ID too long: ${selectMenu.data.custom_id.length} (max: ${this.constraints.maxCustomIdLength})`,
        code: 'CUSTOM_ID_TOO_LONG',
      })
    }

    if (
      selectMenu.data.placeholder &&
      selectMenu.data.placeholder.length > this.constraints.maxPlaceholderLength
    ) {
      errors.push({
        field: 'placeholder',
        message: `Placeholder too long: ${selectMenu.data.placeholder.length} (max: ${this.constraints.maxPlaceholderLength})`,
        code: 'PLACEHOLDER_TOO_LONG',
      })
    }

    if (!selectMenu.data.options || selectMenu.data.options.length === 0) {
      errors.push({
        field: 'options',
        message: 'Select menu must have at least one option',
        code: 'NO_OPTIONS',
      })
    }

    if (
      selectMenu.data.options &&
      selectMenu.data.options.length > this.constraints.maxSelectMenuOptions
    ) {
      errors.push({
        field: 'options',
        message: `Too many options: ${selectMenu.data.options.length} (max: ${this.constraints.maxSelectMenuOptions})`,
        code: 'TOO_MANY_OPTIONS',
      })
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    }
  }

  /**
   * Validate individual button
   */
  private validateButton(
    button: ButtonBuilder,
    index: number,
  ): ValidationError[] {
    const errors: ValidationError[] = []
    const field = `button[${index}]`

    if (!this.hasCustomIdOrUrl(button)) {
      errors.push({
        field,
        message: 'Button must have either custom_id or url',
        code: 'MISSING_ID_OR_URL',
      })
    }

    const customId = this.getButtonCustomId(button)
    if (customId && customId.length > this.constraints.maxCustomIdLength) {
      errors.push({
        field,
        message: `Custom ID too long: ${customId.length} (max: ${this.constraints.maxCustomIdLength})`,
        code: 'CUSTOM_ID_TOO_LONG',
      })
    }

    const label = this.getButtonLabel(button)
    if (label && label.length > this.constraints.maxLabelLength) {
      errors.push({
        field,
        message: `Label too long: ${label.length} (max: ${this.constraints.maxLabelLength})`,
        code: 'LABEL_TOO_LONG',
      })
    }

    if (!this.hasLabelOrEmoji(button)) {
      errors.push({
        field,
        message: 'Button must have either label or emoji',
        code: 'MISSING_LABEL_OR_EMOJI',
      })
    }

    return errors
  }

  /**
   * Get constraint limits for external validation
   */
  getConstraints(): ComponentConstraints {
    return { ...this.constraints }
  }

  /**
   * Truncate text to fit constraints
   */
  truncateText(text: string, maxLength: number, suffix = '...'): string {
    if (text.length <= maxLength) {
      return text
    }
    return text.substring(0, maxLength - suffix.length) + suffix
  }

  /**
   * Get button identifier for logging
   */
  private getButtonIdentifier(button: ButtonBuilder): string {
    const customId = this.getButtonCustomId(button)
    if (customId) return customId

    const url = this.getButtonUrl(button)
    if (url) return 'url-button'

    return 'unknown-button'
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
}
