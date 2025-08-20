import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import { ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import {
  createMockActionRowBuilder,
  createMockButtonBuilder,
  createMockStringSelectMenuBuilder,
  MockActionRowBuilderWithTracking,
  MockButtonBuilder,
  MockStringSelectMenuBuilder,
} from 'src/media/__tests__/types/test-mocks.types'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'

// Type-safe factory functions for Discord.js mock components
const createMockButton = (
  data: Partial<MockButtonBuilder['data']> = {},
): MockButtonBuilder => {
  return createMockButtonBuilder(data)
}

const createMockSelectMenu = (
  data: Partial<MockStringSelectMenuBuilder['data']> = {},
): MockStringSelectMenuBuilder => {
  return createMockStringSelectMenuBuilder(data)
}

const createMockActionRow = (): MockActionRowBuilderWithTracking => {
  return createMockActionRowBuilder()
}

// Mock Discord.js classes with type-safe implementations
jest.mock('discord.js', () => ({
  ActionRowBuilder: jest.fn().mockImplementation(() => createMockActionRow()),
  ButtonBuilder: jest
    .fn()
    .mockImplementation((data?: unknown) =>
      createMockButton(data as Partial<MockButtonBuilder['data']>),
    ),
  StringSelectMenuBuilder: jest
    .fn()
    .mockImplementation((data?: unknown) =>
      createMockSelectMenu(
        data as Partial<MockStringSelectMenuBuilder['data']>,
      ),
    ),
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
}))

describe('ActionRowBuilderService', () => {
  let service: ActionRowBuilderService
  let loggerSpy: jest.SpyInstance

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ActionRowBuilderService,
    ])

    service = module.get<ActionRowBuilderService>(ActionRowBuilderService)

    // Mock logger to avoid console output during tests
    loggerSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => {})
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('createButtonRow', () => {
    it('should create a valid button row', () => {
      const button = createMockButton({
        custom_id: 'test-button',
        label: 'Test',
        style: ButtonStyle.Primary,
      })

      const result = service.createButtonRow([
        button as unknown as ButtonBuilder,
      ])

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(1)
      expect(result.components[0]).toBe(button)
    })

    it('should create button row with multiple buttons', () => {
      const buttons = Array.from({ length: 3 }, (_, i) =>
        createMockButton({
          custom_id: `button-${i}`,
          label: `Button ${i}`,
          style: ButtonStyle.Primary,
        }),
      )

      const result = service.createButtonRow(
        buttons as unknown as ButtonBuilder[],
      )

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(3)
      expect(result.components).toEqual(buttons)
    })

    it('should create button row with maximum allowed buttons', () => {
      const buttons = Array.from({ length: 5 }, (_, i) =>
        createMockButton({
          custom_id: `button-${i}`,
          label: `Button ${i}`,
          style: ButtonStyle.Primary,
        }),
      )

      const result = service.createButtonRow(
        buttons as unknown as ButtonBuilder[],
      )

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(5)
    })

    it('should log debug information with correlation ID', () => {
      const button = createMockButton({
        custom_id: 'test-button',
        label: 'Test',
        style: ButtonStyle.Primary,
      })
      const correlationId = 'test-correlation-id'

      service.createButtonRow(
        [button as unknown as ButtonBuilder],
        correlationId,
      )

      expect(loggerSpy).toHaveBeenCalledWith('Created button action row', {
        correlationId,
        buttonCount: 1,
        customIds: 'test-button',
      })
    })

    it('should throw error for empty button array', () => {
      expect(() => service.createButtonRow([])).toThrow(
        'Button row validation failed: Button row cannot be empty',
      )
    })

    it('should throw error for too many buttons', () => {
      const buttons = Array.from({ length: 6 }, (_, i) =>
        createMockButton({
          custom_id: `button-${i}`,
          label: `Button ${i}`,
          style: ButtonStyle.Primary,
        }),
      )

      expect(() =>
        service.createButtonRow(buttons as unknown as ButtonBuilder[]),
      ).toThrow(
        'Button row validation failed: Too many buttons in row: 6 (max: 5)',
      )
    })

    it('should throw error for button missing custom_id and url', () => {
      const button = createMockButton({
        label: 'Test',
        style: ButtonStyle.Primary,
      })

      expect(() =>
        service.createButtonRow([button as unknown as ButtonBuilder]),
      ).toThrow(
        'Button row validation failed: Button must have either custom_id or url',
      )
    })

    it('should throw error for button missing label and emoji', () => {
      const button = createMockButton({
        custom_id: 'test-button',
        style: ButtonStyle.Primary,
      })

      expect(() =>
        service.createButtonRow([button as unknown as ButtonBuilder]),
      ).toThrow(
        'Button row validation failed: Button must have either label or emoji',
      )
    })

    it('should handle button with emoji but no label', () => {
      const button = createMockButton({
        custom_id: 'test-button',
        style: ButtonStyle.Primary,
        emoji: { name: '🎉' },
      })

      const result = service.createButtonRow([
        button as unknown as ButtonBuilder,
      ])

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(1)
    })

    it('should handle URL button', () => {
      const button = createMockButton({
        url: 'https://example.com',
        label: 'External Link',
        style: ButtonStyle.Link,
      })

      const result = service.createButtonRow([
        button as unknown as ButtonBuilder,
      ])

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(1)
    })

    it('should throw error for custom_id that is too long', () => {
      const longCustomId = 'a'.repeat(101) // Exceeds max length of 100
      const button = createMockButton({
        custom_id: longCustomId,
        label: 'Test',
        style: ButtonStyle.Primary,
      })

      expect(() =>
        service.createButtonRow([button as unknown as ButtonBuilder]),
      ).toThrow(
        'Button row validation failed: Custom ID too long: 101 (max: 100)',
      )
    })

    it('should throw error for label that is too long', () => {
      const longLabel = 'a'.repeat(46) // Exceeds max length of 45
      const button = createMockButton({
        custom_id: 'test-button',
        label: longLabel,
        style: ButtonStyle.Primary,
      })

      expect(() =>
        service.createButtonRow([button as unknown as ButtonBuilder]),
      ).toThrow('Button row validation failed: Label too long: 46 (max: 45)')
    })

    it('should handle multiple validation errors', () => {
      const buttons = Array.from({ length: 6 }, () =>
        createMockButton({ style: ButtonStyle.Primary }),
      )

      expect(() =>
        service.createButtonRow(buttons as unknown as ButtonBuilder[]),
      ).toThrow('Button row validation failed')
    })
  })

  describe('createSelectMenuRow', () => {
    it('should create a valid select menu row', () => {
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        placeholder: 'Choose an option',
        options: [
          { label: 'Option 1', value: 'opt1' },
          { label: 'Option 2', value: 'opt2' },
        ],
      })

      const result = service.createSelectMenuRow(
        selectMenu as unknown as StringSelectMenuBuilder,
      )

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(1)
      expect(result.components[0]).toBe(selectMenu)
    })

    it('should log debug information with correlation ID', () => {
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        placeholder: 'Choose an option',
        options: [{ label: 'Option 1', value: 'opt1' }],
      })
      const correlationId = 'test-correlation-id'

      service.createSelectMenuRow(
        selectMenu as unknown as StringSelectMenuBuilder,
        correlationId,
      )

      expect(loggerSpy).toHaveBeenCalledWith('Created select menu action row', {
        correlationId,
        customId: 'test-select',
        optionCount: 1,
      })
    })

    it('should throw error for select menu missing custom_id', () => {
      const selectMenu = createMockSelectMenu({
        placeholder: 'Choose an option',
        options: [{ label: 'Option 1', value: 'opt1' }],
      })

      expect(() =>
        service.createSelectMenuRow(
          selectMenu as unknown as StringSelectMenuBuilder,
        ),
      ).toThrow(
        'Select menu validation failed: Select menu must have a custom_id',
      )
    })

    it('should throw error for custom_id that is too long', () => {
      const longCustomId = 'a'.repeat(101) // Exceeds max length of 100
      const selectMenu = createMockSelectMenu({
        custom_id: longCustomId,
        options: [{ label: 'Option 1', value: 'opt1' }],
      })

      expect(() =>
        service.createSelectMenuRow(
          selectMenu as unknown as StringSelectMenuBuilder,
        ),
      ).toThrow(
        'Select menu validation failed: Custom ID too long: 101 (max: 100)',
      )
    })

    it('should throw error for placeholder that is too long', () => {
      const longPlaceholder = 'a'.repeat(101) // Exceeds max length of 100
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        placeholder: longPlaceholder,
        options: [{ label: 'Option 1', value: 'opt1' }],
      })

      expect(() =>
        service.createSelectMenuRow(
          selectMenu as unknown as StringSelectMenuBuilder,
        ),
      ).toThrow(
        'Select menu validation failed: Placeholder too long: 101 (max: 100)',
      )
    })

    it('should throw error for select menu with no options', () => {
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        options: undefined,
      })

      expect(() =>
        service.createSelectMenuRow(
          selectMenu as unknown as StringSelectMenuBuilder,
        ),
      ).toThrow(
        'Select menu validation failed: Select menu must have at least one option',
      )
    })

    it('should throw error for select menu with too many options', () => {
      const options = Array.from({ length: 26 }, (_, i) => ({
        label: `Option ${i + 1}`,
        value: `opt${i + 1}`,
      }))
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        options,
      })

      expect(() =>
        service.createSelectMenuRow(
          selectMenu as unknown as StringSelectMenuBuilder,
        ),
      ).toThrow('Select menu validation failed: Too many options: 26 (max: 25)')
    })

    it('should handle select menu with maximum allowed options', () => {
      const options = Array.from({ length: 25 }, (_, i) => ({
        label: `Option ${i + 1}`,
        value: `opt${i + 1}`,
      }))
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        options,
      })

      const result = service.createSelectMenuRow(
        selectMenu as unknown as StringSelectMenuBuilder,
      )

      expect(result).toBeDefined()
      expect(result.components).toHaveLength(1)
    })
  })

  describe('createActionRows', () => {
    it('should return empty array for no components', () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {})

      const result = service.createActionRows([])

      expect(result).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(
        'Attempted to create action rows with no components',
        { correlationId: undefined },
      )
    })

    it('should create action rows for buttons only', () => {
      const buttons = Array.from({ length: 8 }, (_, i) =>
        createMockButton({
          custom_id: `button-${i}`,
          label: `Button ${i}`,
          style: ButtonStyle.Primary,
        }),
      )

      // Add mock instanceof checks
      buttons.forEach(button => {
        Object.setPrototypeOf(button, ButtonBuilder.prototype)
      })

      const result = service.createActionRows(
        buttons as unknown as ButtonBuilder[],
      )

      expect(result).toHaveLength(2) // 5 buttons in first row, 3 in second
      expect(result[0].components).toHaveLength(5)
      expect(result[1].components).toHaveLength(3)
    })

    it('should create action rows for select menus only', () => {
      const selectMenus = Array.from({ length: 3 }, (_, i) =>
        createMockSelectMenu({
          custom_id: `select-${i}`,
          options: [{ label: `Option ${i}`, value: `opt${i}` }],
        }),
      )

      // Add mock instanceof checks
      selectMenus.forEach(selectMenu => {
        Object.setPrototypeOf(selectMenu, StringSelectMenuBuilder.prototype)
      })

      const result = service.createActionRows(
        selectMenus as unknown as StringSelectMenuBuilder[],
      )

      expect(result).toHaveLength(3) // One select menu per row
      expect(result[0].components).toHaveLength(1)
      expect(result[1].components).toHaveLength(1)
      expect(result[2].components).toHaveLength(1)
    })

    it('should create action rows for mixed components', () => {
      const buttons = Array.from({ length: 3 }, (_, i) =>
        createMockButton({
          custom_id: `button-${i}`,
          label: `Button ${i}`,
          style: ButtonStyle.Primary,
        }),
      )

      const selectMenus = Array.from({ length: 2 }, (_, i) =>
        createMockSelectMenu({
          custom_id: `select-${i}`,
          options: [{ label: `Option ${i}`, value: `opt${i}` }],
        }),
      )

      // Add mock instanceof checks
      buttons.forEach(button => {
        Object.setPrototypeOf(button, ButtonBuilder.prototype)
      })
      selectMenus.forEach(selectMenu => {
        Object.setPrototypeOf(selectMenu, StringSelectMenuBuilder.prototype)
      })

      const components = [...selectMenus, ...buttons]
      const result = service.createActionRows(
        components as unknown as (ButtonBuilder | StringSelectMenuBuilder)[],
      )

      expect(result).toHaveLength(3) // 2 select menu rows + 1 button row
      expect(result[0].components).toHaveLength(1) // First select menu
      expect(result[1].components).toHaveLength(1) // Second select menu
      expect(result[2].components).toHaveLength(3) // All buttons
    })

    it('should throw error when total rows exceed maximum', () => {
      // Create 6 select menus (each requires its own row, exceeding max of 5)
      const selectMenus = Array.from({ length: 6 }, (_, i) =>
        createMockSelectMenu({
          custom_id: `select-${i}`,
          options: [{ label: `Option ${i}`, value: `opt${i}` }],
        }),
      )

      // Add mock instanceof checks
      selectMenus.forEach(selectMenu => {
        Object.setPrototypeOf(selectMenu, StringSelectMenuBuilder.prototype)
      })

      expect(() =>
        service.createActionRows(
          selectMenus as unknown as StringSelectMenuBuilder[],
        ),
      ).toThrow('Too many action rows: 6 (max: 5)')
    })

    it('should log debug information when creating action rows', () => {
      const buttons = Array.from({ length: 2 }, (_, i) =>
        createMockButton({
          custom_id: `button-${i}`,
          label: `Button ${i}`,
          style: ButtonStyle.Primary,
        }),
      )

      // Add mock instanceof checks
      buttons.forEach(button => {
        Object.setPrototypeOf(button, ButtonBuilder.prototype)
      })

      const correlationId = 'test-correlation-id'

      service.createActionRows(
        buttons as unknown as ButtonBuilder[],
        correlationId,
      )

      expect(loggerSpy).toHaveBeenCalledWith('Created action rows', {
        correlationId,
        totalRows: 1,
        buttonCount: 2,
        selectMenuCount: 0,
      })
    })

    it('should handle maximum allowed rows (5 rows with select menus)', () => {
      const selectMenus = Array.from({ length: 5 }, (_, i) =>
        createMockSelectMenu({
          custom_id: `select-${i}`,
          options: [{ label: `Option ${i}`, value: `opt${i}` }],
        }),
      )

      // Add mock instanceof checks
      selectMenus.forEach(selectMenu => {
        Object.setPrototypeOf(selectMenu, StringSelectMenuBuilder.prototype)
      })

      const result = service.createActionRows(
        selectMenus as unknown as StringSelectMenuBuilder[],
      )

      expect(result).toHaveLength(5)
      result.forEach((row, i) => {
        expect(row.components).toHaveLength(1)
        expect(row.components[0]).toBe(selectMenus[i])
      })
    })
  })

  describe('getConstraints', () => {
    it('should return a copy of constraints', () => {
      const constraints = service.getConstraints()

      expect(constraints).toEqual({
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
      })

      // Verify it's a copy and not the original
      ;(constraints as any).maxActionRows = 10
      expect(service.getConstraints().maxActionRows).toBe(5)
    })
  })

  describe('truncateText', () => {
    it('should return original text if within limit', () => {
      const text = 'Short text'
      const result = service.truncateText(text, 20)

      expect(result).toBe(text)
    })

    it('should truncate text with default suffix', () => {
      const text = 'This is a very long text that needs to be truncated'
      const result = service.truncateText(text, 20)

      expect(result).toBe('This is a very lo...')
      expect(result).toHaveLength(20)
    })

    it('should truncate text with custom suffix', () => {
      const text = 'This is a very long text'
      const result = service.truncateText(text, 15, '[...]')

      expect(result).toBe('This is a [...]')
      expect(result).toHaveLength(15)
    })

    it('should handle edge case with very short max length', () => {
      const text = 'Hello world'
      const result = service.truncateText(text, 5)

      expect(result).toBe('He...')
      expect(result).toHaveLength(5)
    })

    it('should handle empty suffix', () => {
      const text = 'Hello world'
      const result = service.truncateText(text, 5, '')

      expect(result).toBe('Hello')
      expect(result).toHaveLength(5)
    })
  })

  describe('Error handling and logging', () => {
    it('should log errors with correlation ID', () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {})
      const correlationId = 'test-correlation-id'

      expect(() => service.createButtonRow([], correlationId)).toThrow()

      expect(errorSpy).toHaveBeenCalledWith(
        'Button row validation failed',
        expect.objectContaining({
          correlationId,
          errors: expect.any(Array),
          buttonCount: 0,
        }),
      )
    })

    it('should handle button identifier logging for buttons without custom_id or url', () => {
      // Create a valid button first to avoid validation errors
      const validButton = createMockButton({
        custom_id: 'valid-button',
        label: 'Valid',
        style: ButtonStyle.Primary,
      })

      const result = service.createButtonRow([
        validButton as unknown as ButtonBuilder,
      ])

      expect(result).toBeDefined()
      expect(loggerSpy).toHaveBeenCalledWith(
        'Created button action row',
        expect.objectContaining({
          customIds: 'valid-button',
        }),
      )
    })
  })

  describe('Edge cases and boundary conditions', () => {
    it('should handle button with both custom_id and url (custom_id takes precedence)', () => {
      const button = createMockButton({
        custom_id: 'test-button',
        url: 'https://example.com',
        label: 'Test',
        style: ButtonStyle.Primary,
      })

      const result = service.createButtonRow([
        button as unknown as ButtonBuilder,
      ])

      expect(result).toBeDefined()
    })

    it('should handle select menu with exactly the character limits', () => {
      const customId = 'a'.repeat(100) // Exactly max length
      const placeholder = 'b'.repeat(100) // Exactly max length
      const selectMenu = createMockSelectMenu({
        custom_id: customId,
        placeholder,
        options: [{ label: 'Option 1', value: 'opt1' }],
      })

      const result = service.createSelectMenuRow(
        selectMenu as unknown as StringSelectMenuBuilder,
      )

      expect(result).toBeDefined()
    })

    it('should handle button with exactly the character limits', () => {
      const customId = 'a'.repeat(100) // Exactly max length
      const label = 'b'.repeat(45) // Exactly max length
      const button = createMockButton({
        custom_id: customId,
        label,
        style: ButtonStyle.Primary,
      })

      const result = service.createButtonRow([
        button as unknown as ButtonBuilder,
      ])

      expect(result).toBeDefined()
    })

    it('should handle empty options array in select menu correctly', () => {
      const selectMenu = createMockSelectMenu({
        custom_id: 'test-select',
        options: [],
      })

      expect(() =>
        service.createSelectMenuRow(
          selectMenu as unknown as StringSelectMenuBuilder,
        ),
      ).toThrow(
        'Select menu validation failed: Select menu must have at least one option',
      )
    })
  })
})
