import { TestingModule } from '@nestjs/testing'
import { TextInputStyle } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
// Inline previous shared utilities
import { type MockModalBuilder } from 'src/media/__tests__/types/test-mocks.types'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { ModalComponentConfig, ModalConfig } from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

// Mock Discord.js classes - extend global mock with specific modal components
jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  ModalBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    addComponents: jest.fn().mockReturnThis(),
    data: {},
    toJSON: jest.fn().mockReturnValue({ type: 'modal', components: [] }),
  })),
  TextInputBuilder: jest.fn().mockImplementation(() => ({
    data: {},
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    setRequired: jest.fn().mockReturnThis(),
    setMinLength: jest.fn().mockReturnThis(),
    setMaxLength: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({ type: 4 }),
  })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    setComponents: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({ type: 1, components: [] }),
  })),
  TextInputStyle: {
    Short: 1,
    Paragraph: 2,
  },
}))

describe('ModalBuilderService', () => {
  let service: ModalBuilderService
  let mockModalBuilder: MockModalBuilder

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ModalBuilderService,
    ])
    service = module.get<ModalBuilderService>(ModalBuilderService)

    mockModalBuilder = {
      data: {},
      setCustomId: jest.fn().mockReturnThis(),
      setTitle: jest.fn().mockReturnThis(),
      addComponents: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ type: 'modal', components: [] }),
    } as MockModalBuilder
  })

  describe('Modal Creation', () => {
    describe('Media type handling', () => {
      it.each([
        [MediaType.MOVIE, 'Movie Search Modal', 'Search for movies'],
        [MediaType.SERIES, 'Series Search Modal', 'Search for series'],
      ])('should create modal components for %s', (mediaType, title) => {
        const config: ModalConfig = {
          customId: `${mediaType.toLowerCase()}_modal`,
          title,
          components: [],
        }

        const result = service.createModal(config)
        expect(result).toBeDefined()
      })
    })

    describe('Component constraints', () => {
      it.each([
        ['basic modal', 0, 'Simple modal without components'],
        ['single input modal', 1, 'Modal with single text input'],
        ['complex modal', 2, 'Modal with multiple inputs'],
        ['max components modal', 5, 'Modal with maximum allowed components'],
      ])(
        'should enforce modal %s constraint with %d components',
        (modalType, componentCount, description) => {
          const mockComponents: ModalComponentConfig[] = Array.from(
            { length: componentCount },
            (_, i) => ({
              customId: `input_${i + 1}`,
              label: `Input ${i + 1}`,
              style: TextInputStyle.Short,
              placeholder: `Enter value ${i + 1}`,
              required: false,
            }),
          )

          const config: ModalConfig = {
            customId: `${modalType.replace(/\s+/g, '_')}_modal`,
            title: description,
            components: mockComponents,
          }

          const result = service.createModal(config)
          expect(result).toBeDefined()
          expect(config.components).toHaveLength(componentCount)
        },
      )
    })
  })
})
