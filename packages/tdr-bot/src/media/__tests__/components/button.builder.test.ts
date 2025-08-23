import { TestingModule } from '@nestjs/testing'
import { ButtonBuilder, ButtonStyle } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ButtonBuilderService } from 'src/media/components/button.builder'
// Utilities previously from shared-component-test-utils
const DEFAULT_BUTTON_TEST_CASES = [
  {
    mediaType: 'sonarr',
    actionType: 'search',
    expectedLabel: 'Search TV Shows',
    expectedEmoji: '📺',
  },
  {
    mediaType: 'radarr',
    actionType: 'request',
    expectedLabel: 'Request Movie',
    expectedEmoji: '🎬',
  },
]

const DEFAULT_BUTTON_CONFIG_TEST_CASES = [
  {
    configType: 'disabled',
    config: {
      customId: 'test-button',
      label: 'Test Button',
      style: ButtonStyle.Secondary,
      disabled: true,
    },
    expectedMethods: ['setDisabled'],
  },
]

const DEFAULT_BUTTON_STYLE_TEST_CASES = [
  {
    styleName: 'Primary',
    style: ButtonStyle.Primary,
  },
  {
    styleName: 'Secondary',
    style: ButtonStyle.Secondary,
  },
]
import {
  createMockLogger,
  type MockButtonBuilder,
  type MockLogger,
} from 'src/media/__tests__/types/test-mocks.types'
import { ButtonConfig } from 'src/types/discord.types'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
    setSKUId: jest.fn().mockReturnThis(),
    toJSON: jest.fn(() => ({})),
    setId: jest.fn().mockReturnThis(),
    clearId: jest.fn().mockReturnThis(),
    data: {},
  })),
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
}))

describe('ButtonBuilderService', () => {
  let service: ButtonBuilderService
  let mockLogger: MockLogger
  let mockButtonBuilder: MockButtonBuilder

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ButtonBuilderService,
    ])

    service = module.get<ButtonBuilderService>(ButtonBuilderService)
    mockLogger = createMockLogger()
    ;(service as unknown as { logger: MockLogger }).logger = mockLogger

    mockButtonBuilder = {
      setCustomId: jest.fn().mockReturnThis(),
      setLabel: jest.fn().mockReturnThis(),
      setStyle: jest.fn().mockReturnThis(),
      setEmoji: jest.fn().mockReturnThis(),
      setURL: jest.fn().mockReturnThis(),
      setDisabled: jest.fn().mockReturnThis(),
      toJSON: jest.fn(() => ({})),
      data: {},
    } as any as MockButtonBuilder
    ;(ButtonBuilder as unknown as jest.Mock).mockReturnValue(mockButtonBuilder)
  })

  describe('Button Creation', () => {
    describe('Media type handling', () => {
      it.each(DEFAULT_BUTTON_TEST_CASES)(
        'should create search components for $mediaType with action $actionType',
        async ({ mediaType, actionType, expectedLabel, expectedEmoji }) => {
          const config: ButtonConfig = {
            customId: `${mediaType.toLowerCase()}_${actionType.toLowerCase()}`,
            label: expectedLabel,
            style: ButtonStyle.Primary,
            emoji: expectedEmoji,
          }

          const result = service.createButton(config)

          expect(ButtonBuilder).toHaveBeenCalled()
          expect(mockButtonBuilder.setCustomId).toHaveBeenCalledWith(
            `${mediaType.toLowerCase()}_${actionType.toLowerCase()}`,
          )
          expect(mockButtonBuilder.setLabel).toHaveBeenCalledWith(expectedLabel)
          expect(mockButtonBuilder.setEmoji).toHaveBeenCalledWith(expectedEmoji)
          expect(result).toBe(mockButtonBuilder)
        },
      )
    })

    describe('Button configuration patterns', () => {
      it.each(DEFAULT_BUTTON_CONFIG_TEST_CASES)(
        'should create button with $configType configuration',
        ({ configType, config, expectedMethods }) => {
          const result = service.createButton(config)

          expect(ButtonBuilder).toHaveBeenCalled()
          expectedMethods.forEach(method => {
            expect((mockButtonBuilder as any)[method]).toHaveBeenCalled()
          })
          expect(result).toBe(mockButtonBuilder)
        },
      )
    })
  })

  describe('Button Styles and Types', () => {
    it.each(DEFAULT_BUTTON_STYLE_TEST_CASES)(
      'should support $styleName button style',
      ({ style }) => {
        const config: ButtonConfig = {
          customId: `button_${style}`,
          label: `Style ${style}`,
          style,
        }

        service.createButton(config)
        expect(mockButtonBuilder.setStyle).toHaveBeenCalledWith(style)
      },
    )
  })

  describe('Error Handling', () => {
    it('should handle configuration errors gracefully', () => {
      const invalidConfig = {
        customId: '', // Empty customId should be handled gracefully
        label: '', // Empty label should be handled gracefully
        style: 1, // Valid style
      } as ButtonConfig

      expect(() => service.createButton(invalidConfig)).not.toThrow()
      // Note: ButtonBuilderService handles empty strings gracefully without logging warnings
    })
  })
})
