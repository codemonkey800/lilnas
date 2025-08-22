import { Logger } from '@nestjs/common'
import { TestingModule } from '@nestjs/testing'
import { ButtonBuilder, ButtonStyle } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ButtonConfig } from 'src/types/discord.types'
import { ActionType, MediaType } from 'src/types/enums'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis(),
    setDisabled: jest.fn().mockReturnThis(),
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
  let mockLogger: jest.Mocked<Logger>
  let mockButtonBuilder: jest.Mocked<ButtonBuilder>

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ButtonBuilderService,
    ])

    service = module.get<ButtonBuilderService>(ButtonBuilderService)
    mockLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any
    ;(service as any).logger = mockLogger

    mockButtonBuilder = {
      setCustomId: jest.fn().mockReturnThis(),
      setLabel: jest.fn().mockReturnThis(),
      setStyle: jest.fn().mockReturnThis(),
      setEmoji: jest.fn().mockReturnThis(),
      setURL: jest.fn().mockReturnThis(),
      setDisabled: jest.fn().mockReturnThis(),
      data: {},
    } as any
    ;(ButtonBuilder as unknown as jest.Mock).mockReturnValue(mockButtonBuilder)
  })

  describe('Button Creation', () => {
    describe('Media type handling', () => {
      it.each([
        [MediaType.MOVIE, ActionType.SEARCH, 'Movie Search', '🎬'],
        [MediaType.SERIES, ActionType.ADD, 'Add Series', '📺'],
      ])(
        'should create search components for %s with action %s',
        async (mediaType, actionType, expectedLabel, expectedEmoji) => {
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
      it.each([
        [
          'basic',
          {
            customId: 'test_button',
            label: 'Test Button',
            style: ButtonStyle.Primary,
          },
          ['setCustomId', 'setLabel', 'setStyle'],
        ],
        [
          'with emoji and URL',
          {
            customId: 'emoji_button',
            label: 'With Emoji',
            style: ButtonStyle.Link,
            emoji: '🎬',
            url: 'https://example.com',
          },
          ['setCustomId', 'setLabel', 'setStyle', 'setEmoji', 'setURL'],
        ],
        [
          'disabled',
          {
            customId: 'disabled_button',
            label: 'Disabled Button',
            style: ButtonStyle.Secondary,
            disabled: true,
          },
          ['setCustomId', 'setLabel', 'setStyle', 'setDisabled'],
        ],
      ])(
        'should create button with %s configuration',
        (configType, baseConfig, expectedMethods) => {
          const config: ButtonConfig = {
            ...baseConfig,
          } as ButtonConfig

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
    it.each([
      [ButtonStyle.Primary, 'Primary'],
      [ButtonStyle.Secondary, 'Secondary'],
      [ButtonStyle.Success, 'Success'],
      [ButtonStyle.Danger, 'Danger'],
      [ButtonStyle.Link, 'Link'],
    ])('should support %s button style', (style, styleName) => {
      const config: ButtonConfig = {
        customId: `button_${style}`,
        label: `Style ${styleName}`,
        style,
      }

      service.createButton(config)
      expect(mockButtonBuilder.setStyle).toHaveBeenCalledWith(style)
    })
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
