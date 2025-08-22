import { TestingModule } from '@nestjs/testing'
import { ButtonBuilder, ButtonStyle } from 'discord.js'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ComponentFactoryService } from 'src/media/components/component.factory'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import {
  ButtonConfig,
  ModalConfig,
  SelectMenuConfig,
} from 'src/types/discord.types'

describe('ComponentFactoryService', () => {
  let service: ComponentFactoryService

  beforeEach(async () => {
    const module: TestingModule = await createTestingModule([
      ComponentFactoryService,
      ActionRowBuilderService,
      ButtonBuilderService,
      SelectMenuBuilderService,
      ModalBuilderService,
    ])

    service = module.get<ComponentFactoryService>(ComponentFactoryService)
  })

  describe('Component Creation', () => {
    it('should create buttons via button builder service', () => {
      const config: ButtonConfig = {
        customId: 'test_button',
        label: 'Test Button',
        style: ButtonStyle.Primary,
      }

      const result = service.createButton(config)
      expect(result).toBeDefined()
    })

    it('should create select menus via select menu builder service', () => {
      const config: SelectMenuConfig = {
        customId: 'test_select',
        placeholder: 'Select an option',
        options: [
          { label: 'Option 1', value: 'opt1', description: 'First option' },
          { label: 'Option 2', value: 'opt2', description: 'Second option' },
        ],
        // actionType and mediaType removed as they don't exist in SelectMenuConfig
      }

      const result = service.createSelectMenu(config)
      expect(result).toBeDefined()
    })

    it('should create modals via modal builder service', () => {
      const config: ModalConfig = {
        customId: 'test_modal',
        title: 'Test Modal',
        components: [],
        // actionType, mediaType, and correlationId removed as they don't exist in ModalConfig
      }

      const result = service.createModal(config)
      expect(result).toBeDefined()
    })

    it('should create action rows via action row builder service', () => {
      // Create actual ButtonBuilder instances (using mocked constructors)
      const button1 = new ButtonBuilder()
        .setCustomId('button1')
        .setLabel('Button 1')
        .setStyle(ButtonStyle.Primary)

      const button2 = new ButtonBuilder()
        .setCustomId('button2')
        .setLabel('Button 2')
        .setStyle(ButtonStyle.Secondary)

      const mockComponents = [button1, button2]

      const result = service.createActionRow(mockComponents)
      expect(result).toBeDefined()
    })
  })

  describe('Embed Creation', () => {
    it('should create embeds with media content', () => {
      const embedConfig = {
        title: 'Test Movie',
        description: 'A test movie description',
        color: 0x00ff00,
        correlationId: 'test_embed',
      }

      const result = service.createEmbed(embedConfig)
      expect(result).toBeDefined()
    })
  })
})
