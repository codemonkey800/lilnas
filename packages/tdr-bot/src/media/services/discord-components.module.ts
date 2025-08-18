import { Module } from '@nestjs/common'
import { EventEmitterModule } from '@nestjs/event-emitter'

import { ActionRowBuilderService } from 'src/media/components/action-row.builder'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ComponentFactoryService } from 'src/media/components/component.factory'
import { ModalBuilderService } from 'src/media/components/modal.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { ComponentStateService } from './component-state.service'
import { DiscordErrorService } from './discord-error.service'
import { MediaLoggingService } from './media-logging.service'

/**
 * Discord Components Module for Media Management
 *
 * This module provides comprehensive Discord.js v14 component management
 * including builders, state management, error handling, and logging
 * for the TDR Media Management feature.
 *
 * Key Features:
 * - Discord.js v14 component builders (buttons, select menus, modals, action rows)
 * - Component state management with timeout handling and cleanup
 * - Discord-specific error handling with fallback mechanisms
 * - Rate limiting and circuit breaker patterns
 * - Structured logging with correlation IDs
 * - Integration with existing error classification and retry services
 */
@Module({
  imports: [
    EventEmitterModule, // Required for component lifecycle events
  ],
  providers: [
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
  ],
  exports: [
    // Export all component builders for use in commands
    ActionRowBuilderService,
    ButtonBuilderService,
    SelectMenuBuilderService,
    ModalBuilderService,
    ComponentFactoryService,

    // Export management services
    ComponentStateService,
    DiscordErrorService,
    MediaLoggingService,
  ],
})
export class DiscordComponentsModule {}
