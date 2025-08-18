import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputStyle,
} from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ComponentFactoryService } from 'src/media/components/component.factory'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import {
  ButtonConfig,
  EmbedConfig,
  ModalConfig,
  SelectMenuConfig,
  extractButtonData,
  extractSelectMenuData,
  extractModalData,
  extractEmbedData,
  extractActionRowData,
  isButtonComponentData,
  isSelectMenuComponentData,
  isModalComponentData,
  isEmbedComponentData,
  isActionRowComponentData,
} from 'src/types/discord.types'

// Mock Discord.js classes - create mock builders with proper structure
const mockButtonBuilder = {
  setCustomId: jest.fn().mockReturnThis(),
  setLabel: jest.fn().mockReturnThis(),
  setStyle: jest.fn().mockReturnThis(),
  setEmoji: jest.fn().mockReturnThis(),
  setURL: jest.fn().mockReturnThis(),
  setDisabled: jest.fn().mockReturnThis(),
  data: {} as any,
  constructor: { name: 'ButtonBuilder' },
}

const mockStringSelectMenuBuilder = {
  setCustomId: jest.fn().mockReturnThis(),
  setPlaceholder: jest.fn().mockReturnThis(),
  addOptions: jest.fn().mockReturnThis(),
  setMinValues: jest.fn().mockReturnThis(),
  setMaxValues: jest.fn().mockReturnThis(),
  setDisabled: jest.fn().mockReturnThis(),
  data: {} as any,
  constructor: { name: 'StringSelectMenuBuilder' },
}

const mockActionRowBuilder = {
  addComponents: jest.fn().mockReturnThis(),
  data: { components: [] as any[] },
  constructor: { name: 'ActionRowBuilder' },
}

const mockModalBuilder = {
  setCustomId: jest.fn().mockReturnThis(),
  setTitle: jest.fn().mockReturnThis(),
  addComponents: jest.fn().mockReturnThis(),
  data: {} as any,
  constructor: { name: 'ModalBuilder' },
}

const mockEmbedBuilder = {
  setTitle: jest.fn().mockReturnThis(),
  setDescription: jest.fn().mockReturnThis(),
  setColor: jest.fn().mockReturnThis(),
  setAuthor: jest.fn().mockReturnThis(),
  setThumbnail: jest.fn().mockReturnThis(),
  setImage: jest.fn().mockReturnThis(),
  setFooter: jest.fn().mockReturnThis(),
  setTimestamp: jest.fn().mockReturnThis(),
  setURL: jest.fn().mockReturnThis(),
  addFields: jest.fn().mockReturnThis(),
  data: {} as any,
  constructor: { name: 'EmbedBuilder' },
}

// Factory functions for creating fresh mock instances
const createMockButtonBuilder = () => ({ ...mockButtonBuilder, data: {} })
const createMockStringSelectMenuBuilder = () => ({
  ...mockStringSelectMenuBuilder,
  data: {},
})
const createMockActionRowBuilder = () => ({
  ...mockActionRowBuilder,
  data: { components: [] },
})
const createMockModalBuilder = () => ({ ...mockModalBuilder, data: {} })
const createMockEmbedBuilder = () => ({ ...mockEmbedBuilder, data: {} })

jest.mock('discord.js', () => {
  function MockButtonBuilder() {
    return Object.assign(Object.create(MockButtonBuilder.prototype), {
      ...mockButtonBuilder,
      data: {},
    })
  }

  function MockStringSelectMenuBuilder() {
    return Object.assign(Object.create(MockStringSelectMenuBuilder.prototype), {
      ...mockStringSelectMenuBuilder,
      data: {},
    })
  }

  function MockActionRowBuilder() {
    return Object.assign(Object.create(MockActionRowBuilder.prototype), {
      ...mockActionRowBuilder,
      data: { components: [] },
    })
  }

  function MockModalBuilder() {
    return Object.assign(Object.create(MockModalBuilder.prototype), {
      ...mockModalBuilder,
      data: {},
    })
  }

  function MockEmbedBuilder() {
    return Object.assign(Object.create(MockEmbedBuilder.prototype), {
      ...mockEmbedBuilder,
      data: {},
    })
  }

  return {
    ButtonBuilder: MockButtonBuilder,
    StringSelectMenuBuilder: MockStringSelectMenuBuilder,
    ActionRowBuilder: MockActionRowBuilder,
    ModalBuilder: MockModalBuilder,
    EmbedBuilder: MockEmbedBuilder,
    ButtonStyle: {
      Primary: 1,
      Secondary: 2,
      Success: 3,
      Danger: 4,
      Link: 5,
    },
    TextInputStyle: {
      Short: 1,
      Paragraph: 2,
    },
  }
})

describe('ComponentFactoryService', () => {
  let service: ComponentFactoryService
  let actionRowBuilderService: jest.Mocked<ActionRowBuilderService>
  let buttonBuilderService: jest.Mocked<ButtonBuilderService>
  let selectMenuBuilderService: jest.Mocked<SelectMenuBuilderService>
  let modalBuilderService: jest.Mocked<ModalBuilderService>
  let loggerSpy: jest.SpyInstance

  beforeEach(async () => {
    // Create mock services
    actionRowBuilderService = {
      createButtonRow: jest.fn(),
      createSelectMenuRow: jest.fn(),
    } as any

    buttonBuilderService = {
      createButton: jest.fn(),
    } as any

    selectMenuBuilderService = {
      createSelectMenu: jest.fn(),
    } as any

    modalBuilderService = {
      createModal: jest.fn(),
    } as any

    const module: TestingModule = await createTestingModule([
      ComponentFactoryService,
      { provide: ActionRowBuilderService, useValue: actionRowBuilderService },
      { provide: ButtonBuilderService, useValue: buttonBuilderService },
      {
        provide: SelectMenuBuilderService,
        useValue: selectMenuBuilderService,
      },
      { provide: ModalBuilderService, useValue: modalBuilderService },
    ])

    service = module.get<ComponentFactoryService>(ComponentFactoryService)

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

  describe('createActionRow', () => {
    beforeEach(() => {
      actionRowBuilderService.createButtonRow.mockReturnValue(
        createMockActionRowBuilder() as any,
      )
      actionRowBuilderService.createSelectMenuRow.mockReturnValue(
        createMockActionRowBuilder() as any,
      )
    })

    it('should create action row with button components', () => {
      const mockButtons = [
        new ButtonBuilder(),
        new ButtonBuilder(),
      ] as ButtonBuilder[]

      const result = service.createActionRow(mockButtons, 'test-correlation')

      expect(result).toBeDefined()
      expect(actionRowBuilderService.createButtonRow).toHaveBeenCalledWith(
        mockButtons,
        'test-correlation',
      )
      expect(actionRowBuilderService.createSelectMenuRow).not.toHaveBeenCalled()
    })

    it('should create action row with single select menu component', () => {
      const mockSelectMenu = [
        new StringSelectMenuBuilder(),
      ] as StringSelectMenuBuilder[]

      const result = service.createActionRow(mockSelectMenu, 'test-correlation')

      expect(result).toBeDefined()
      expect(actionRowBuilderService.createSelectMenuRow).toHaveBeenCalledWith(
        mockSelectMenu[0],
        'test-correlation',
      )
      expect(actionRowBuilderService.createButtonRow).not.toHaveBeenCalled()
    })

    it('should throw error for empty components array', () => {
      expect(() => service.createActionRow([])).toThrow(
        'Cannot create action row with no components',
      )
    })

    it('should throw error for mixed component types', () => {
      const mixedComponents = [
        new ButtonBuilder(),
        new StringSelectMenuBuilder(),
      ] as any[]

      expect(() => service.createActionRow(mixedComponents)).toThrow(
        'All components in an action row must be of the same type',
      )
    })

    it('should throw error for multiple select menu components', () => {
      const multipleSelectMenus = [
        new StringSelectMenuBuilder(),
        new StringSelectMenuBuilder(),
      ] as StringSelectMenuBuilder[]

      expect(() => service.createActionRow(multipleSelectMenus)).toThrow(
        'Only one select menu component allowed per action row',
      )
    })

    it('should throw error for unsupported component type', () => {
      const unsupportedComponent = [
        { constructor: { name: 'TextInput' } },
      ] as any

      expect(() => service.createActionRow(unsupportedComponent)).toThrow(
        'Unsupported component type for action row',
      )
    })

    it('should handle missing correlation ID', () => {
      const mockButtons = [new ButtonBuilder()] as ButtonBuilder[]

      const result = service.createActionRow(mockButtons)

      expect(result).toBeDefined()
      expect(actionRowBuilderService.createButtonRow).toHaveBeenCalledWith(
        mockButtons,
        undefined,
      )
    })
  })

  describe('createButton', () => {
    beforeEach(() => {
      buttonBuilderService.createButton.mockReturnValue(
        createMockButtonBuilder() as any,
      )
    })

    it('should delegate to ButtonBuilderService', () => {
      const config: ButtonConfig = {
        customId: 'test-button',
        label: 'Test Button',
        style: ButtonStyle.Primary,
      }

      const result = service.createButton(config)

      expect(result).toBeDefined()
      expect(buttonBuilderService.createButton).toHaveBeenCalledWith(config)
    })
  })

  describe('createSelectMenu', () => {
    beforeEach(() => {
      selectMenuBuilderService.createSelectMenu.mockReturnValue(
        createMockStringSelectMenuBuilder() as any,
      )
    })

    it('should delegate to SelectMenuBuilderService', () => {
      const config: SelectMenuConfig = {
        customId: 'test-select',
        placeholder: 'Select an option',
        options: [
          { label: 'Option 1', value: 'option1' },
          { label: 'Option 2', value: 'option2' },
        ],
      }

      const result = service.createSelectMenu(config)

      expect(result).toBeDefined()
      expect(selectMenuBuilderService.createSelectMenu).toHaveBeenCalledWith(
        config,
      )
    })
  })

  describe('createModal', () => {
    beforeEach(() => {
      modalBuilderService.createModal.mockReturnValue(
        createMockModalBuilder() as any,
      )
    })

    it('should delegate to ModalBuilderService', () => {
      const config: ModalConfig = {
        customId: 'test-modal',
        title: 'Test Modal',
        components: [
          {
            customId: 'test-input',
            label: 'Test Input',
            style: TextInputStyle.Short,
          },
        ],
      }

      const result = service.createModal(config)

      expect(result).toBeDefined()
      expect(modalBuilderService.createModal).toHaveBeenCalledWith(config)
    })
  })

  describe('createEmbed', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should create basic embed with title and description', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        description: 'Test Description',
      }

      const result = service.createEmbed(config)

      expect(result).toBeDefined()
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('Test Title')
      expect(mockEmbedBuilder.setDescription).toHaveBeenCalledWith(
        'Test Description',
      )
    })

    it('should create embed with color', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        color: 0x00ff00,
      }

      service.createEmbed(config)

      expect(mockEmbedBuilder.setColor).toHaveBeenCalledWith(0x00ff00)
    })

    it('should create embed with author', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        author: {
          name: 'Author Name',
          iconURL: 'https://example.com/icon.png',
          url: 'https://example.com',
        },
      }

      service.createEmbed(config)

      expect(mockEmbedBuilder.setAuthor).toHaveBeenCalledWith({
        name: 'Author Name',
        iconURL: 'https://example.com/icon.png',
        url: 'https://example.com',
      })
    })

    it('should create embed with thumbnail and image', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        thumbnail: { url: 'https://example.com/thumb.png' },
        image: { url: 'https://example.com/image.png' },
      }

      service.createEmbed(config)

      expect(mockEmbedBuilder.setThumbnail).toHaveBeenCalledWith(
        'https://example.com/thumb.png',
      )
      expect(mockEmbedBuilder.setImage).toHaveBeenCalledWith(
        'https://example.com/image.png',
      )
    })

    it('should create embed with footer and timestamp', () => {
      const timestamp = new Date()
      const config: EmbedConfig = {
        title: 'Test Title',
        footer: {
          text: 'Footer Text',
          iconURL: 'https://example.com/footer.png',
        },
        timestamp,
      }

      service.createEmbed(config)

      expect(mockEmbedBuilder.setFooter).toHaveBeenCalledWith({
        text: 'Footer Text',
        iconURL: 'https://example.com/footer.png',
      })
      expect(mockEmbedBuilder.setTimestamp).toHaveBeenCalledWith(timestamp)
    })

    it('should create embed with URL', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        url: 'https://example.com',
      }

      service.createEmbed(config)

      expect(mockEmbedBuilder.setURL).toHaveBeenCalledWith(
        'https://example.com',
      )
    })

    it('should create embed with fields', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        fields: [
          { name: 'Field 1', value: 'Value 1', inline: true },
          { name: 'Field 2', value: 'Value 2', inline: false },
        ],
      }

      service.createEmbed(config)

      expect(mockEmbedBuilder.addFields).toHaveBeenCalledWith([
        { name: 'Field 1', value: 'Value 1', inline: true },
        { name: 'Field 2', value: 'Value 2', inline: false },
      ])
    })

    it('should limit fields to maximum of 25', () => {
      const fields = Array.from({ length: 30 }, (_, i) => ({
        name: `Field ${i + 1}`,
        value: `Value ${i + 1}`,
      }))

      const config: EmbedConfig = {
        title: 'Test Title',
        fields,
      }

      service.createEmbed(config)

      const addFieldsCall = mockEmbedBuilder.addFields.mock.calls[0][0]
      expect(addFieldsCall).toHaveLength(25)
    })

    it('should truncate long text in various fields', () => {
      const longTitle = 'a'.repeat(300)
      const longDescription = 'b'.repeat(5000)
      const longAuthorName = 'c'.repeat(300)
      const longFooterText = 'd'.repeat(3000)
      const longFieldName = 'e'.repeat(300)
      const longFieldValue = 'f'.repeat(2000)

      const config: EmbedConfig = {
        title: longTitle,
        description: longDescription,
        author: { name: longAuthorName },
        footer: { text: longFooterText },
        fields: [{ name: longFieldName, value: longFieldValue }],
      }

      service.createEmbed(config)

      // Verify truncation occurred (checking length and ellipsis)
      const titleCall = mockEmbedBuilder.setTitle.mock.calls[0][0]
      expect(titleCall).toHaveLength(256)
      expect(titleCall.endsWith('...')).toBe(true)

      const descriptionCall = mockEmbedBuilder.setDescription.mock.calls[0][0]
      expect(descriptionCall).toHaveLength(4096)
      expect(descriptionCall.endsWith('...')).toBe(true)

      const authorCall = mockEmbedBuilder.setAuthor.mock.calls[0][0]
      expect(authorCall.name).toHaveLength(256)
      expect(authorCall.name.endsWith('...')).toBe(true)

      const footerCall = mockEmbedBuilder.setFooter.mock.calls[0][0]
      expect(footerCall.text).toHaveLength(2048)
      expect(footerCall.text.endsWith('...')).toBe(true)

      const fieldsCall = mockEmbedBuilder.addFields.mock.calls[0][0]
      expect(fieldsCall[0].name).toHaveLength(256)
      expect(fieldsCall[0].name.endsWith('...')).toBe(true)
      expect(fieldsCall[0].value).toHaveLength(1024)
      expect(fieldsCall[0].value.endsWith('...')).toBe(true)
    })

    it('should handle embed with no optional fields', () => {
      const config: EmbedConfig = {
        title: 'Basic Title',
      }

      const result = service.createEmbed(config)

      expect(result).toBeDefined()
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('Basic Title')
      expect(mockEmbedBuilder.setDescription).not.toHaveBeenCalled()
      expect(mockEmbedBuilder.setColor).not.toHaveBeenCalled()
    })

    it('should log embed creation details', () => {
      const config: EmbedConfig = {
        title: 'Test Title',
        fields: [{ name: 'Field 1', value: 'Value 1' }],
        author: { name: 'Author' },
        footer: { text: 'Footer' },
        image: { url: 'https://example.com/image.png' },
        thumbnail: { url: 'https://example.com/thumb.png' },
      }

      service.createEmbed(config)

      expect(loggerSpy).toHaveBeenCalledWith('Created embed from config', {
        title: 'Test Title',
        fieldCount: 1,
        hasAuthor: true,
        hasFooter: true,
        hasImage: true,
        hasThumbnail: true,
      })
    })
  })

  // Helper functions to create mock components with data
  const createMockButtonWithData = (data: any) => {
    const mockButton = new (ButtonBuilder as any)()
    mockButton.data = { ...mockButton.data, ...data }
    return mockButton
  }

  const createMockSelectMenuWithData = (data: any) => {
    const mockSelectMenu = new (StringSelectMenuBuilder as any)()
    mockSelectMenu.data = { ...mockSelectMenu.data, ...data }
    return mockSelectMenu
  }

  const createMockModalWithData = (data: any) => {
    const mockModal = new (ModalBuilder as any)()
    mockModal.data = { ...mockModal.data, ...data }
    return mockModal
  }

  const createMockEmbedWithData = (data: any) => {
    const mockEmbed = new (EmbedBuilder as any)()
    mockEmbed.data = { ...mockEmbed.data, ...data }
    return mockEmbed
  }

  const createMockActionRowWithData = (data: any) => {
    const mockActionRow = new (ActionRowBuilder as any)()
    mockActionRow.data = { ...mockActionRow.data, ...data }
    return mockActionRow
  }

  describe('validateConstraints', () => {
    describe('ButtonBuilder validation', () => {
      it('should validate button with custom ID and label', () => {
        const button = createMockButtonWithData({
          custom_id: 'test-button',
          label: 'Test Button',
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should validate button with URL and label', () => {
        const button = createMockButtonWithData({
          url: 'https://example.com',
          label: 'Visit Site',
          style: ButtonStyle.Link,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should validate button with emoji and no label', () => {
        const button = createMockButtonWithData({
          custom_id: 'emoji-button',
          emoji: { name: '👍' },
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail validation for button without custom ID or URL', () => {
        const button = createMockButtonWithData({
          label: 'Test Button',
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'button',
          message: 'Button must have either custom_id or url',
          code: 'MISSING_ID_OR_URL',
        })
      })

      it('should fail validation for button without label or emoji', () => {
        const button = createMockButtonWithData({
          custom_id: 'test-button',
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'button',
          message: 'Button must have either label or emoji',
          code: 'MISSING_LABEL_OR_EMOJI',
        })
      })

      it('should fail validation for button with custom ID too long', () => {
        const button = createMockButtonWithData({
          custom_id: 'a'.repeat(150),
          label: 'Test Button',
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Custom ID too long: 150 (max: 100)',
          code: 'CUSTOM_ID_TOO_LONG',
        })
      })

      it('should fail validation for button with label too long', () => {
        const button = createMockButtonWithData({
          custom_id: 'test-button',
          label: 'a'.repeat(50),
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'label',
          message: 'Label too long: 50 (max: 45)',
          code: 'LABEL_TOO_LONG',
        })
      })
    })

    describe('StringSelectMenuBuilder validation', () => {
      it('should validate select menu with proper configuration', () => {
        const selectMenu = createMockSelectMenuWithData({
          custom_id: 'test-select',
          options: [
            { label: 'Option 1', value: 'option1' },
            { label: 'Option 2', value: 'option2' },
          ],
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail validation for select menu without custom ID', () => {
        const selectMenu = createMockSelectMenuWithData({
          options: [{ label: 'Option 1', value: 'option1' }],
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Select menu must have a custom_id',
          code: 'MISSING_CUSTOM_ID',
        })
      })

      it('should fail validation for select menu with custom ID too long', () => {
        const selectMenu = createMockSelectMenuWithData({
          custom_id: 'a'.repeat(150),
          options: [{ label: 'Option 1', value: 'option1' }],
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Custom ID too long: 150 (max: 100)',
          code: 'CUSTOM_ID_TOO_LONG',
        })
      })

      it('should fail validation for select menu without options', () => {
        const selectMenu = createMockSelectMenuWithData({
          custom_id: 'test-select',
          options: [],
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'options',
          message: 'Select menu must have at least one option',
          code: 'NO_OPTIONS',
        })
      })

      it('should fail validation for select menu with too many options', () => {
        const options = Array.from({ length: 30 }, (_, i) => ({
          label: `Option ${i + 1}`,
          value: `option${i + 1}`,
        }))

        const selectMenu = createMockSelectMenuWithData({
          custom_id: 'test-select',
          options,
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'options',
          message: 'Too many options: 30 (max: 25)',
          code: 'TOO_MANY_OPTIONS',
        })
      })

      it('should fail validation for select menu with missing options array', () => {
        const selectMenu = createMockSelectMenuWithData({
          custom_id: 'test-select',
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'options',
          message: 'Select menu must have at least one option',
          code: 'NO_OPTIONS',
        })
      })
    })

    describe('ModalBuilder validation', () => {
      it('should validate modal with proper configuration', () => {
        const modal = createMockModalWithData({
          custom_id: 'test-modal',
          title: 'Test Modal',
          components: [
            { type: 1, components: [{ type: 4, custom_id: 'input1' }] },
          ],
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail validation for modal without custom ID', () => {
        const modal = createMockModalWithData({
          title: 'Test Modal',
          components: [
            { type: 1, components: [{ type: 4, custom_id: 'input1' }] },
          ],
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Modal must have a custom_id',
          code: 'MISSING_CUSTOM_ID',
        })
      })

      it('should fail validation for modal without title', () => {
        const modal = createMockModalWithData({
          custom_id: 'test-modal',
          components: [
            { type: 1, components: [{ type: 4, custom_id: 'input1' }] },
          ],
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'title',
          message: 'Modal must have a title',
          code: 'MISSING_TITLE',
        })
      })

      it('should fail validation for modal without components', () => {
        const modal = createMockModalWithData({
          custom_id: 'test-modal',
          title: 'Test Modal',
          components: [],
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Modal must have at least one component',
          code: 'NO_COMPONENTS',
        })
      })

      it('should fail validation for modal with too many components', () => {
        const components = Array.from({ length: 10 }, (_, i) => ({
          type: 1,
          components: [{ type: 4, custom_id: `input${i + 1}` }],
        }))

        const modal = createMockModalWithData({
          custom_id: 'test-modal',
          title: 'Test Modal',
          components,
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Too many components: 10 (max: 5)',
          code: 'TOO_MANY_COMPONENTS',
        })
      })

      it('should fail validation for modal with missing components array', () => {
        const modal = createMockModalWithData({
          custom_id: 'test-modal',
          title: 'Test Modal',
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Modal must have at least one component',
          code: 'NO_COMPONENTS',
        })
      })
    })

    describe('EmbedBuilder validation', () => {
      it('should validate embed with proper content', () => {
        const embed = createMockEmbedWithData({
          title: 'Test Title',
          description: 'Test Description',
          fields: [{ name: 'Field 1', value: 'Value 1' }],
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail validation for embed with title too long', () => {
        const embed = createMockEmbedWithData({
          title: 'a'.repeat(300),
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'title',
          message: 'Embed title too long: 300 (max: 256)',
          code: 'TITLE_TOO_LONG',
        })
      })

      it('should fail validation for embed with description too long', () => {
        const embed = createMockEmbedWithData({
          description: 'a'.repeat(5000),
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'description',
          message: 'Embed description too long: 5000 (max: 4096)',
          code: 'DESCRIPTION_TOO_LONG',
        })
      })

      it('should fail validation for embed with too many fields', () => {
        const fields = Array.from({ length: 30 }, (_, i) => ({
          name: `Field ${i + 1}`,
          value: `Value ${i + 1}`,
        }))

        const embed = createMockEmbedWithData({
          fields,
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'fields',
          message: 'Too many embed fields: 30 (max: 25)',
          code: 'TOO_MANY_FIELDS',
        })
      })

      it('should fail validation for embed with total content too long', () => {
        const embed = createMockEmbedWithData({
          title: 'a'.repeat(256),
          description: 'b'.repeat(4096),
          author: { name: 'c'.repeat(256) },
          footer: { text: 'd'.repeat(2048) },
          fields: [
            { name: 'e'.repeat(256), value: 'f'.repeat(1024) },
            { name: 'g'.repeat(256), value: 'h'.repeat(1024) },
          ],
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(false)
        const embedTooLongError = result.errors.find(
          error => error.code === 'EMBED_TOO_LONG',
        )
        expect(embedTooLongError).toBeDefined()
        expect(embedTooLongError?.message).toContain(
          'Total embed content too long:',
        )
      })

      it('should validate embed with minimal content', () => {
        const embed = createMockEmbedWithData({
          title: 'Short Title',
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should calculate total length correctly with missing fields', () => {
        const embed = createMockEmbedWithData({
          title: 'Test',
          author: { name: 'Author' },
          footer: { text: 'Footer' },
          fields: [{ name: 'Field', value: 'Value' }],
        })

        const result = service.validateConstraints(embed)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })
    })

    describe('ActionRowBuilder validation', () => {
      it('should validate action row with components', () => {
        const actionRow = createMockActionRowWithData({
          components: [
            { type: 2, custom_id: 'button1' },
            { type: 2, custom_id: 'button2' },
          ],
        })

        const result = service.validateConstraints(actionRow)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail validation for empty action row', () => {
        const actionRow = createMockActionRowWithData({
          components: [],
        })

        const result = service.validateConstraints(actionRow)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Action row must have at least one component',
          code: 'EMPTY_ACTION_ROW',
        })
      })

      it('should fail validation for action row with too many components', () => {
        const components = Array.from({ length: 10 }, (_, i) => ({
          type: 2,
          custom_id: `button${i + 1}`,
        }))

        const actionRow = createMockActionRowWithData({
          components,
        })

        const result = service.validateConstraints(actionRow)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Too many components in action row: 10 (max: 5)',
          code: 'TOO_MANY_COMPONENTS',
        })
      })

      it('should fail validation for action row with missing components array', () => {
        const actionRow = createMockActionRowWithData({})

        const result = service.validateConstraints(actionRow)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Action row must have at least one component',
          code: 'EMPTY_ACTION_ROW',
        })
      })
    })

    describe('Unknown component type validation', () => {
      it('should fail validation for unknown component type', () => {
        const unknownComponent = { someProperty: 'value' }

        const result = service.validateConstraints(unknownComponent)

        expect(result.valid).toBe(false)
        expect(result.errors).toContainEqual({
          field: 'component',
          message: 'Unknown component type',
          code: 'UNKNOWN_TYPE',
        })
      })
    })

    describe('Multiple validation errors', () => {
      it('should return multiple errors for button with multiple issues', () => {
        const button = createMockButtonWithData({
          // Missing custom_id/url, missing label/emoji
          custom_id: 'a'.repeat(150), // Too long
          style: ButtonStyle.Primary,
        })

        const result = service.validateConstraints(button)

        expect(result.valid).toBe(false)
        expect(result.errors).toHaveLength(2)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Custom ID too long: 150 (max: 100)',
          code: 'CUSTOM_ID_TOO_LONG',
        })
        expect(result.errors).toContainEqual({
          field: 'button',
          message: 'Button must have either label or emoji',
          code: 'MISSING_LABEL_OR_EMOJI',
        })
      })

      it('should return multiple errors for select menu with multiple issues', () => {
        const selectMenu = createMockSelectMenuWithData({
          custom_id: 'a'.repeat(150), // Too long
          options: [], // Empty
        })

        const result = service.validateConstraints(selectMenu)

        expect(result.valid).toBe(false)
        expect(result.errors).toHaveLength(2)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Custom ID too long: 150 (max: 100)',
          code: 'CUSTOM_ID_TOO_LONG',
        })
        expect(result.errors).toContainEqual({
          field: 'options',
          message: 'Select menu must have at least one option',
          code: 'NO_OPTIONS',
        })
      })

      it('should return multiple errors for modal with multiple issues', () => {
        const modal = createMockModalWithData({
          // Missing custom_id, missing title, empty components
          components: [],
        })

        const result = service.validateConstraints(modal)

        expect(result.valid).toBe(false)
        expect(result.errors).toHaveLength(3)
        expect(result.errors).toContainEqual({
          field: 'custom_id',
          message: 'Modal must have a custom_id',
          code: 'MISSING_CUSTOM_ID',
        })
        expect(result.errors).toContainEqual({
          field: 'title',
          message: 'Modal must have a title',
          code: 'MISSING_TITLE',
        })
        expect(result.errors).toContainEqual({
          field: 'components',
          message: 'Modal must have at least one component',
          code: 'NO_COMPONENTS',
        })
      })
    })
  })

  describe('private utility methods', () => {
    describe('truncateText', () => {
      it('should not truncate text shorter than max length', () => {
        const text = 'Short text'
        const result = (service as any).truncateText(text, 20)

        expect(result).toBe(text)
      })

      it('should truncate long text with default suffix', () => {
        const text = 'a'.repeat(50)
        const result = (service as any).truncateText(text, 20)

        expect(result).toHaveLength(20)
        expect(result.endsWith('...')).toBe(true)
        expect(result.startsWith('a')).toBe(true)
      })

      it('should truncate text with custom suffix', () => {
        const text = 'b'.repeat(50)
        const result = (service as any).truncateText(text, 15, '[cut]')

        expect(result).toHaveLength(15)
        expect(result.endsWith('[cut]')).toBe(true)
      })

      it('should handle edge case where text equals max length', () => {
        const text = 'exact'
        const result = (service as any).truncateText(text, 5)

        expect(result).toBe(text)
      })

      it('should handle edge case with very short max length', () => {
        const text = 'test'
        const result = (service as any).truncateText(text, 2)

        expect(result).toBe('...')
      })
    })

    describe('button data access methods (with type guards)', () => {
      it('should get button custom ID safely using type guard', () => {
        const button = createMockButtonWithData({ custom_id: 'test-id' })

        const customId = (service as any).getButtonCustomId(button)

        expect(customId).toBe('test-id')
      })

      it('should return undefined for missing custom ID using type guard', () => {
        const button = createMockButtonWithData({})

        const customId = (service as any).getButtonCustomId(button)

        expect(customId).toBeUndefined()
      })

      it('should handle malformed button data gracefully', () => {
        const malformedButton = { data: null }

        const customId = (service as any).getButtonCustomId(malformedButton)
        const url = (service as any).getButtonUrl(malformedButton)
        const label = (service as any).getButtonLabel(malformedButton)
        const emoji = (service as any).getButtonEmoji(malformedButton)

        expect(customId).toBeUndefined()
        expect(url).toBeUndefined()
        expect(label).toBeUndefined()
        expect(emoji).toBeUndefined()
      })

      it('should get button URL safely', () => {
        const button = createMockButtonWithData({ url: 'https://example.com' })

        const url = (service as any).getButtonUrl(button)

        expect(url).toBe('https://example.com')
      })

      it('should get button label safely', () => {
        const button = createMockButtonWithData({ label: 'Test Label' })

        const label = (service as any).getButtonLabel(button)

        expect(label).toBe('Test Label')
      })

      it('should get button emoji safely', () => {
        const button = createMockButtonWithData({ emoji: { name: '👍' } })

        const emoji = (service as any).getButtonEmoji(button)

        expect(emoji).toEqual({ name: '👍' })
      })

      it('should check if button has custom ID or URL', () => {
        const buttonWithCustomId = createMockButtonWithData({
          custom_id: 'test-id',
        })
        const buttonWithUrl = createMockButtonWithData({
          url: 'https://example.com',
        })
        const buttonWithNeither = createMockButtonWithData({})

        expect((service as any).hasCustomIdOrUrl(buttonWithCustomId)).toBe(true)
        expect((service as any).hasCustomIdOrUrl(buttonWithUrl)).toBe(true)
        expect((service as any).hasCustomIdOrUrl(buttonWithNeither)).toBe(false)
      })

      it('should check if button has label or emoji', () => {
        const buttonWithLabel = createMockButtonWithData({
          label: 'Test Label',
        })
        const buttonWithEmoji = createMockButtonWithData({
          emoji: { name: '👍' },
        })
        const buttonWithNeither = createMockButtonWithData({})

        expect((service as any).hasLabelOrEmoji(buttonWithLabel)).toBe(true)
        expect((service as any).hasLabelOrEmoji(buttonWithEmoji)).toBe(true)
        expect((service as any).hasLabelOrEmoji(buttonWithNeither)).toBe(false)
      })
    })

    describe('getConstraints', () => {
      it('should return component constraints', () => {
        const constraints = (service as any).getConstraints()

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
      })
    })
  })

  describe('Edge cases and integration scenarios', () => {
    it('should handle validation of complex embed with all properties', () => {
      const embed = createMockEmbedWithData({
        title: 'Complete Embed',
        description: 'A description',
        author: { name: 'Author Name' },
        footer: { text: 'Footer Text' },
        fields: [
          { name: 'Field 1', value: 'Value 1' },
          { name: 'Field 2', value: 'Value 2' },
        ],
      })

      const result = service.validateConstraints(embed)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.warnings).toHaveLength(0)
    })

    it('should handle action row creation with maximum number of buttons', () => {
      // Mock the return value for this specific test
      const mockActionRow = createMockActionRowWithData({ components: [] })
      actionRowBuilderService.createButtonRow.mockReturnValueOnce(
        mockActionRow as any,
      )

      const buttons = Array.from({ length: 5 }, () => new ButtonBuilder())

      const result = service.createActionRow(buttons, 'test-correlation')

      expect(result).toBeDefined()
      expect(actionRowBuilderService.createButtonRow).toHaveBeenCalledWith(
        buttons,
        'test-correlation',
      )
    })

    it('should validate action row with maximum allowed components', () => {
      const actionRow = createMockActionRowWithData({
        components: Array.from({ length: 5 }, (_, i) => ({
          type: 2,
          custom_id: `button${i + 1}`,
        })),
      })

      const result = service.validateConstraints(actionRow)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle embed creation with all optional properties', () => {
      const config: EmbedConfig = {
        title: 'Full Embed',
        description: 'Complete description',
        color: 0x00ff00,
        author: {
          name: 'Author Name',
          iconURL: 'https://example.com/author.png',
          url: 'https://example.com/author',
        },
        thumbnail: { url: 'https://example.com/thumb.png' },
        image: { url: 'https://example.com/image.png' },
        footer: {
          text: 'Footer Text',
          iconURL: 'https://example.com/footer.png',
        },
        timestamp: new Date(),
        url: 'https://example.com',
        fields: [
          { name: 'Inline Field', value: 'Inline Value', inline: true },
          { name: 'Regular Field', value: 'Regular Value', inline: false },
        ],
      }

      const result = service.createEmbed(config)

      expect(result).toBeDefined()
      expect(mockEmbedBuilder.setTitle).toHaveBeenCalledWith('Full Embed')
      expect(mockEmbedBuilder.setDescription).toHaveBeenCalledWith(
        'Complete description',
      )
      expect(mockEmbedBuilder.setColor).toHaveBeenCalledWith(0x00ff00)
      expect(mockEmbedBuilder.setAuthor).toHaveBeenCalled()
      expect(mockEmbedBuilder.setThumbnail).toHaveBeenCalled()
      expect(mockEmbedBuilder.setImage).toHaveBeenCalled()
      expect(mockEmbedBuilder.setFooter).toHaveBeenCalled()
      expect(mockEmbedBuilder.setTimestamp).toHaveBeenCalled()
      expect(mockEmbedBuilder.setURL).toHaveBeenCalledWith(
        'https://example.com',
      )
      expect(mockEmbedBuilder.addFields).toHaveBeenCalled()
    })

    it('should return proper validation result structure', () => {
      const validButton = createMockButtonWithData({
        custom_id: 'valid-button',
        label: 'Valid Button',
        style: ButtonStyle.Primary,
      })

      const result = service.validateConstraints(validButton)

      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('warnings')
      expect(Array.isArray(result.errors)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('should handle service dependencies correctly', () => {
      // Test that all injected services are available
      expect(actionRowBuilderService).toBeDefined()
      expect(buttonBuilderService).toBeDefined()
      expect(selectMenuBuilderService).toBeDefined()
      expect(modalBuilderService).toBeDefined()
    })

    describe('Type Guard Integration', () => {
      describe('Button data extraction', () => {
        it('should safely extract button data with custom ID', () => {
          const button = createMockButtonWithData({
            custom_id: 'test-button',
            label: 'Test Label',
            style: 1,
          })

          const extracted = extractButtonData(button)

          expect(extracted.customId).toBe('test-button')
          expect(extracted.label).toBe('Test Label')
          expect(extracted.url).toBeUndefined()
          expect(extracted.emoji).toBeUndefined()
        })

        it('should safely extract button data with URL', () => {
          const button = createMockButtonWithData({
            url: 'https://example.com',
            label: 'Visit Site',
          })

          const extracted = extractButtonData(button)

          expect(extracted.url).toBe('https://example.com')
          expect(extracted.label).toBe('Visit Site')
          expect(extracted.customId).toBeUndefined()
        })

        it('should return undefined values for invalid button data', () => {
          const invalidButton = { data: 'not-an-object' }

          const extracted = extractButtonData(invalidButton)

          expect(extracted.customId).toBeUndefined()
          expect(extracted.url).toBeUndefined()
          expect(extracted.label).toBeUndefined()
          expect(extracted.emoji).toBeUndefined()
        })

        it('should handle button with emoji', () => {
          const button = createMockButtonWithData({
            custom_id: 'emoji-button',
            emoji: { name: '👍' },
          })

          const extracted = extractButtonData(button)

          expect(extracted.customId).toBe('emoji-button')
          expect(extracted.emoji).toEqual({ name: '👍' })
          expect(extracted.label).toBeUndefined()
        })
      })

      describe('Type guard functions', () => {
        it('should validate button component data', () => {
          expect(isButtonComponentData({ custom_id: 'test', label: 'Test' })).toBe(true)
          expect(isButtonComponentData({ url: 'https://test.com', label: 'Test' })).toBe(true)
          expect(isButtonComponentData({ custom_id: 'test', emoji: { name: '👍' } })).toBe(true)
          expect(isButtonComponentData(null)).toBe(false)
          expect(isButtonComponentData('string')).toBe(false)
          expect(isButtonComponentData({})).toBe(true) // Empty object is valid
        })

        it('should validate select menu component data', () => {
          expect(isSelectMenuComponentData({ custom_id: 'test', options: [] })).toBe(true)
          expect(isSelectMenuComponentData({ placeholder: 'Test' })).toBe(true)
          expect(isSelectMenuComponentData(null)).toBe(false)
          expect(isSelectMenuComponentData('string')).toBe(false)
        })

        it('should validate modal component data', () => {
          expect(isModalComponentData({ custom_id: 'test', title: 'Test' })).toBe(true)
          expect(isModalComponentData({ components: [] })).toBe(true)
          expect(isModalComponentData(null)).toBe(false)
          expect(isModalComponentData(123)).toBe(false)
        })

        it('should validate embed component data', () => {
          expect(isEmbedComponentData({ title: 'Test' })).toBe(true)
          expect(isEmbedComponentData({ description: 'Test', color: 0xff0000 })).toBe(true)
          expect(isEmbedComponentData({})).toBe(true) // Empty object is valid
          expect(isEmbedComponentData(null)).toBe(false)
          expect(isEmbedComponentData([])).toBe(false)
        })

        it('should validate action row component data', () => {
          expect(isActionRowComponentData({ type: 1, components: [] })).toBe(true)
          expect(isActionRowComponentData({ components: [] })).toBe(true)
          expect(isActionRowComponentData({})).toBe(true) // Empty object is valid
          expect(isActionRowComponentData(null)).toBe(false)
          expect(isActionRowComponentData('invalid')).toBe(false)
        })
      })

      describe('Type guard integration with validation', () => {
        it('should use type guards in validation safely', () => {
          // Test with malformed data that would break type assertions
          const malformedButton = createMockButtonWithData({
            custom_id: null, // Invalid type
            label: 123, // Invalid type
            style: 'invalid', // Invalid type
          })

          // This should not throw an error and should handle the invalid data gracefully
          const result = service.validateConstraints(malformedButton)

          // Should identify validation issues but not crash
          expect(result.valid).toBe(false)
          expect(result.errors.length).toBeGreaterThan(0)
        })

        it('should prevent runtime errors from type assertion failures', () => {
          // Create various malformed components that would cause type assertion failures
          const malformedComponents = [
            { data: null },
            { data: undefined },
            { data: 'string' },
            { data: 123 },
            { data: [] },
          ]

          malformedComponents.forEach((component, index) => {
            // None of these should throw runtime errors
            expect(() => {
              const result = service.validateConstraints(component)
              expect(result).toHaveProperty('valid')
              expect(result).toHaveProperty('errors')
              expect(result).toHaveProperty('warnings')
            }).not.toThrow(`Malformed component ${index} should not throw`)
          })
        })
      })
    })
  })
})
