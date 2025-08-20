/**
 * @fileoverview Media Module
 *
 * This module provides a centralized NestJS module for media service integration.
 * It registers all media clients (Sonarr, Radarr, Emby) and their supporting
 * services with proper dependency injection.
 *
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

import { Module } from '@nestjs/common'

import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

import { EmbyClient } from './clients/emby.client'
import { RadarrClient } from './clients/radarr.client'
import { SonarrClient } from './clients/sonarr.client'
import { MediaConfigValidationService } from './config/media-config.validation'
import { MediaLoggingService } from './services/media-logging.service'

/**
 * Media integration module that provides all media API clients and services
 *
 * This module registers:
 * - Media API clients: SonarrClient, RadarrClient, EmbyClient
 * - Supporting services: MediaConfigValidationService, MediaLoggingService
 * - Utility services: RetryService, ErrorClassificationService
 *
 * All clients are registered as providers and exported for use in other modules.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [MediaModule],
 * })
 * export class SomeOtherModule {}
 * ```
 *
 * @since 1.0.0
 */
@Module({
  providers: [
    // Core configuration and validation
    MediaConfigValidationService,

    // Logging and error handling services
    MediaLoggingService,
    ErrorClassificationService,
    RetryService,

    // Media API clients
    SonarrClient,
    RadarrClient,
    EmbyClient,
  ],
  exports: [
    // Export clients for use in other modules
    SonarrClient,
    RadarrClient,
    EmbyClient,

    // Export supporting services that might be useful elsewhere
    MediaConfigValidationService,
    MediaLoggingService,
  ],
})
export class MediaModule {}
