import { TestingModule } from '@nestjs/testing'
import { ActionRowBuilder } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
// Inline previous shared utilities
import { type MockActionRowBuilderWithTracking } from 'src/media/__tests__/types/test-mocks.types'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    setComponents: jest.fn().mockReturnThis(),
    toJSON: jest.fn(() => ({ type: 1, components: [] })),
    setId: jest.fn().mockReturnThis(),
    clearId: jest.fn().mockReturnThis(),
    components: [],
    data: { components: [] },
  })),
}))

describe('ActionRowBuilderService', () => {
  let service: ActionRowBuilderService
  let mockActionRowBuilder: MockActionRowBuilderWithTracking

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ActionRowBuilderService,
    ])
    service = module.get<ActionRowBuilderService>(ActionRowBuilderService)

    mockActionRowBuilder = {
      components: [],
      data: { components: [] },
      addComponents: jest.fn().mockReturnThis(),
      setComponents: jest.fn().mockReturnThis(),
      toJSON: jest.fn(() => ({ type: 1, components: [] })),
      setId: jest.fn().mockReturnThis(),
      clearId: jest.fn().mockReturnThis(),
    } as MockActionRowBuilderWithTracking
    ;(ActionRowBuilder as unknown as jest.Mock).mockReturnValue(
      mockActionRowBuilder,
    )
  })

  describe('Action Row Creation', () => {
    it('should create action row with components', () => {
      const mockComponents = [
        {
          data: { custom_id: 'button1', label: 'Button 1', style: 1 },
          setCustomId: jest.fn().mockReturnThis(),
          setLabel: jest.fn().mockReturnThis(),
          setStyle: jest.fn().mockReturnThis(),
          setEmoji: jest.fn().mockReturnThis(),
          setURL: jest.fn().mockReturnThis(),
          setDisabled: jest.fn().mockReturnThis(),
          setSKUId: jest.fn().mockReturnThis(),
          toJSON: jest.fn(),
          setId: jest.fn().mockReturnThis(),
          clearId: jest.fn().mockReturnThis(),
        },
        {
          data: { custom_id: 'button2', label: 'Button 2', style: 1 },
          setCustomId: jest.fn().mockReturnThis(),
          setLabel: jest.fn().mockReturnThis(),
          setStyle: jest.fn().mockReturnThis(),
          setEmoji: jest.fn().mockReturnThis(),
          setURL: jest.fn().mockReturnThis(),
          setDisabled: jest.fn().mockReturnThis(),
          setSKUId: jest.fn().mockReturnThis(),
          toJSON: jest.fn(),
          setId: jest.fn().mockReturnThis(),
          clearId: jest.fn().mockReturnThis(),
        },
      ]

      const result = service.createButtonRow(mockComponents)

      expect(ActionRowBuilder).toHaveBeenCalled()
      expect(mockActionRowBuilder.addComponents).toHaveBeenCalledWith(
        ...mockComponents,
      )
      expect(result).toBe(mockActionRowBuilder)
    })

    it('should handle empty components array by throwing validation error', () => {
      expect(() => service.createButtonRow([])).toThrow(
        'Button row validation failed: Button row cannot be empty',
      )
    })
  })
})
