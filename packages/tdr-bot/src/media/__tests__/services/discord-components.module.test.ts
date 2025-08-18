import { EventEmitter2 } from '@nestjs/event-emitter'
import { TestingModule } from '@nestjs/testing'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ActionRowBuilderService } from 'src/media/components/action-row.builder'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ComponentFactoryService } from 'src/media/components/component.factory'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import { ComponentStateService } from 'src/media/services/component-state.service'
import { DiscordErrorService } from 'src/media/services/discord-error.service'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

describe('DiscordComponentsModule', () => {
  let module: TestingModule

  beforeEach(async () => {
    // Create a simplified test module with proper mocked dependencies
    module = await createTestingModule([
      // Existing utility services
      ErrorClassificationService,
      RetryService,

      // Component builders
      ActionRowBuilderService,
      ButtonBuilderService,
      SelectMenuBuilderService,
      ModalBuilderService,
      ComponentFactoryService,

      // Component management services
      ComponentStateService,
      DiscordErrorService,
      MediaLoggingService,
    ])
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('Module Configuration', () => {
    it('should be defined and create all services', () => {
      expect(module).toBeDefined()
    })

    it('should provide EventEmitter2', () => {
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2)
      expect(eventEmitter).toBeDefined()
      expect(typeof eventEmitter.emit).toBe('function')
      expect(typeof eventEmitter.on).toBe('function')
    })
  })

  describe('Provider Registration', () => {
    describe('Utility Services', () => {
      it('should provide ErrorClassificationService', () => {
        const service = module.get<ErrorClassificationService>(
          ErrorClassificationService,
        )
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(ErrorClassificationService)
      })

      it('should provide RetryService', () => {
        const service = module.get<RetryService>(RetryService)
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(RetryService)
      })
    })

    describe('Component Builders', () => {
      it('should provide ActionRowBuilderService', () => {
        const service = module.get<ActionRowBuilderService>(
          ActionRowBuilderService,
        )
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(ActionRowBuilderService)
      })

      it('should provide ButtonBuilderService', () => {
        const service = module.get<ButtonBuilderService>(ButtonBuilderService)
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(ButtonBuilderService)
      })

      it('should provide SelectMenuBuilderService', () => {
        const service = module.get<SelectMenuBuilderService>(
          SelectMenuBuilderService,
        )
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(SelectMenuBuilderService)
      })

      it('should provide ModalBuilderService', () => {
        const service = module.get<ModalBuilderService>(ModalBuilderService)
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(ModalBuilderService)
      })

      it('should provide ComponentFactoryService', () => {
        const service = module.get<ComponentFactoryService>(
          ComponentFactoryService,
        )
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(ComponentFactoryService)
      })
    })

    describe('Management Services', () => {
      it('should provide ComponentStateService', () => {
        const service = module.get<ComponentStateService>(ComponentStateService)
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(ComponentStateService)
      })

      it('should provide DiscordErrorService', () => {
        const service = module.get<DiscordErrorService>(DiscordErrorService)
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(DiscordErrorService)
      })

      it('should provide MediaLoggingService', () => {
        const service = module.get<MediaLoggingService>(MediaLoggingService)
        expect(service).toBeDefined()
        expect(service).toBeInstanceOf(MediaLoggingService)
      })
    })
  })

  describe('Service Integration', () => {
    it('should create singleton instances of all services', () => {
      // Get the same service twice and verify they are the same instance
      const factory1 = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      const factory2 = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      expect(factory1).toBe(factory2)

      const state1 = module.get<ComponentStateService>(ComponentStateService)
      const state2 = module.get<ComponentStateService>(ComponentStateService)
      expect(state1).toBe(state2)

      const error1 = module.get<DiscordErrorService>(DiscordErrorService)
      const error2 = module.get<DiscordErrorService>(DiscordErrorService)
      expect(error1).toBe(error2)

      const logging1 = module.get<MediaLoggingService>(MediaLoggingService)
      const logging2 = module.get<MediaLoggingService>(MediaLoggingService)
      expect(logging1).toBe(logging2)
    })

    it('should have all services with expected methods', () => {
      const factory = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      const state = module.get<ComponentStateService>(ComponentStateService)
      const error = module.get<DiscordErrorService>(DiscordErrorService)
      const logging = module.get<MediaLoggingService>(MediaLoggingService)

      // Services should be properly initialized with expected methods
      expect(typeof factory.createButton).toBe('function')
      expect(typeof factory.createSelectMenu).toBe('function')
      expect(typeof factory.createModal).toBe('function')
      expect(typeof factory.createActionRow).toBe('function')

      expect(typeof state.createComponentState).toBe('function')
      expect(typeof state.getComponentState).toBe('function')
      expect(typeof state.getUserSessions).toBe('function')

      expect(typeof error.handleDiscordError).toBe('function')

      expect(typeof logging.logOperation).toBe('function')
      expect(typeof logging.logComponentInteraction).toBe('function')
      expect(typeof logging.logError).toBe('function')
    })

    it('should support error handling integration', () => {
      const errorService = module.get<DiscordErrorService>(DiscordErrorService)
      const errorClassifier = module.get<ErrorClassificationService>(
        ErrorClassificationService,
      )
      const retryService = module.get<RetryService>(RetryService)

      expect(errorService).toBeDefined()
      expect(errorClassifier).toBeDefined()
      expect(retryService).toBeDefined()

      // Error handling chain should be available
      expect(typeof errorService.handleDiscordError).toBe('function')
      expect(typeof errorClassifier.classifyError).toBe('function')
      expect(typeof retryService.executeWithRetry).toBe('function')
    })

    it('should have proper dependency injection between services', () => {
      const factory = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      const state = module.get<ComponentStateService>(ComponentStateService)
      const logging = module.get<MediaLoggingService>(MediaLoggingService)

      // Verify that services can access their dependencies
      expect(factory).toBeDefined()
      expect(state).toBeDefined()
      expect(logging).toBeDefined()

      // Services should have been constructed with proper dependencies
      expect(factory).toBeInstanceOf(ComponentFactoryService)
      expect(state).toBeInstanceOf(ComponentStateService)
      expect(logging).toBeInstanceOf(MediaLoggingService)
    })
  })

  describe('Builder Services Integration', () => {
    it('should coordinate between factory and builder services', () => {
      const factory = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      const actionRowBuilder = module.get<ActionRowBuilderService>(
        ActionRowBuilderService,
      )
      const buttonBuilder =
        module.get<ButtonBuilderService>(ButtonBuilderService)

      expect(factory).toBeDefined()
      expect(actionRowBuilder).toBeDefined()
      expect(buttonBuilder).toBeDefined()

      // Factory should be able to delegate to builder services
      expect(typeof factory.createButton).toBe('function')
      expect(typeof actionRowBuilder.createButtonRow).toBe('function')
      expect(typeof buttonBuilder.createButton).toBe('function')
    })

    it('should provide all component creation capabilities', () => {
      const factory = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      const selectMenuBuilder = module.get<SelectMenuBuilderService>(
        SelectMenuBuilderService,
      )
      const modalBuilder = module.get<ModalBuilderService>(ModalBuilderService)

      expect(factory).toBeDefined()
      expect(selectMenuBuilder).toBeDefined()
      expect(modalBuilder).toBeDefined()

      // All component types should be supported
      expect(typeof factory.createSelectMenu).toBe('function')
      expect(typeof factory.createModal).toBe('function')
      expect(typeof selectMenuBuilder.createSelectMenu).toBe('function')
      expect(typeof modalBuilder.createModal).toBe('function')
    })
  })

  describe('Event System Integration', () => {
    it('should provide EventEmitter2 for inter-service communication', () => {
      const eventEmitter = module.get<EventEmitter2>(EventEmitter2)
      const state = module.get<ComponentStateService>(ComponentStateService)
      const logging = module.get<MediaLoggingService>(MediaLoggingService)

      expect(eventEmitter).toBeDefined()
      expect(state).toBeDefined()
      expect(logging).toBeDefined()

      // Services that use events should have access to EventEmitter2
      expect(typeof eventEmitter.emit).toBe('function')
      expect(typeof eventEmitter.on).toBe('function')
      expect(typeof eventEmitter.once).toBe('function')
      expect(typeof eventEmitter.removeListener).toBe('function')
    })
  })

  describe('Module Lifecycle', () => {
    it('should handle module cleanup properly', async () => {
      // Ensure no errors during module cleanup
      await expect(module.close()).resolves.not.toThrow()
    })

    it('should allow module recreation after cleanup', async () => {
      await module.close()

      const newModule = await createTestingModule([
        // Include all builder services for proper dependency resolution
        ActionRowBuilderService,
        ButtonBuilderService,
        SelectMenuBuilderService,
        ModalBuilderService,
        ComponentFactoryService,
        ComponentStateService,
        MediaLoggingService,
      ])

      const factory = newModule.get<ComponentFactoryService>(
        ComponentFactoryService,
      )
      expect(factory).toBeDefined()
      expect(factory).toBeInstanceOf(ComponentFactoryService)

      await newModule.close()
    })
  })

  describe('Configuration Validation', () => {
    it('should have consistent configuration across services', () => {
      const state = module.get<ComponentStateService>(ComponentStateService)
      const logging = module.get<MediaLoggingService>(MediaLoggingService)
      const error = module.get<DiscordErrorService>(DiscordErrorService)

      expect(state).toBeDefined()
      expect(logging).toBeDefined()
      expect(error).toBeDefined()

      // Services should be properly configured and ready to use
      expect(typeof state.getMetrics).toBe('function')
      expect(typeof logging.createCorrelationContext).toBe('function')
      expect(typeof error.handleDiscordError).toBe('function')
    })

    it('should provide proper method signatures for validation', () => {
      const factory = module.get<ComponentFactoryService>(
        ComponentFactoryService,
      )

      expect(factory).toBeDefined()
      expect(typeof factory.validateConstraints).toBe('function')

      // Verify the factory has all required methods for component creation
      expect(typeof factory.createButton).toBe('function')
      expect(typeof factory.createSelectMenu).toBe('function')
      expect(typeof factory.createModal).toBe('function')
      expect(typeof factory.createActionRow).toBe('function')
      expect(typeof factory.createEmbed).toBe('function')
    })
  })
})
