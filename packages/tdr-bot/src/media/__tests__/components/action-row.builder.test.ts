import { TestingModule } from '@nestjs/testing'
import { ActionRowBuilder } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'

// Mock Discord.js classes
jest.mock('discord.js', () => ({
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    setComponents: jest.fn().mockReturnThis(),
    data: { components: [] },
  })),
}))

describe('ActionRowBuilderService', () => {
  let service: ActionRowBuilderService
  let mockActionRowBuilder: jest.Mocked<ActionRowBuilder>

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ActionRowBuilderService,
    ])
    service = module.get<ActionRowBuilderService>(ActionRowBuilderService)

    mockActionRowBuilder = {
      addComponents: jest.fn().mockReturnThis(),
      setComponents: jest.fn().mockReturnThis(),
      data: { components: [] },
    } as any
    ;(ActionRowBuilder as unknown as jest.Mock).mockReturnValue(
      mockActionRowBuilder,
    )
  })

  describe('Action Row Creation', () => {
    it('should create action row with components', () => {
      const mockComponents = [
        { data: { custom_id: 'button1', label: 'Button 1', style: 1 } },
        { data: { custom_id: 'button2', label: 'Button 2', style: 1 } },
      ] as any

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
