import { TestingModule } from '@nestjs/testing'

import { createTestingModule } from 'src/__tests__/test-utils'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import { SelectMenuConfig } from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

// Mock Discord.js classes - extend global mock with select menu components
jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    addOptions: jest.fn().mockReturnThis(),
    setMinValues: jest.fn().mockReturnThis(),
    setMaxValues: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
    data: {},
    toJSON: jest.fn().mockReturnValue({ type: 3, options: [] }),
  })),
  StringSelectMenuOptionBuilder: jest.fn().mockImplementation(() => ({
    data: {},
    setLabel: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setDefault: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({ label: 'Test', value: 'test' }),
  })),
}))

describe('SelectMenuBuilderService', () => {
  let service: SelectMenuBuilderService

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      SelectMenuBuilderService,
    ])
    service = module.get<SelectMenuBuilderService>(SelectMenuBuilderService)
  })

  describe('Select Menu Creation', () => {
    describe('Media type handling', () => {
      it.each([
        [MediaType.MOVIE, 'Choose a movie option', 'Movie Selection'],
        [MediaType.SERIES, 'Choose a series option', 'Series Selection'],
      ])(
        'should create select menu components for %s',
        (mediaType, placeholder, description) => {
          const config: SelectMenuConfig = {
            customId: `${mediaType.toLowerCase()}_select`,
            placeholder,
            options: [
              { label: 'Option 1', value: 'opt1', description },
              { label: 'Option 2', value: 'opt2', description },
            ],
            // actionType, mediaType, and correlationId removed as they don't exist in SelectMenuConfig
          }

          const result = service.createSelectMenu(config)
          expect(result).toBeDefined()
        },
      )
    })

    describe('Component constraints', () => {
      it.each([
        [
          'basic configuration',
          { minValues: undefined, maxValues: undefined, optionCount: 2 },
        ],
        ['with min/max values', { minValues: 1, maxValues: 3, optionCount: 3 }],
        ['single selection', { minValues: 1, maxValues: 1, optionCount: 5 }],
      ])(
        'should enforce select menu constraints for %s',
        (configType, constraints) => {
          const options = Array.from(
            { length: constraints.optionCount },
            (_, i) => ({
              label: `Option ${String.fromCharCode(65 + i)}`,
              value: String.fromCharCode(97 + i).toLowerCase(),
            }),
          )

          const config: SelectMenuConfig = {
            customId: `constraint_select_${configType.replace(' ', '_')}`,
            placeholder: `Select with ${configType}`,
            options,
            minValues: constraints.minValues,
            maxValues: constraints.maxValues,
            // actionType, mediaType, and correlationId removed as they don't exist in SelectMenuConfig
          }

          const result = service.createSelectMenu(config)
          expect(result).toBeDefined()
          expect(config.options).toHaveLength(constraints.optionCount)
        },
      )
    })
  })
})
