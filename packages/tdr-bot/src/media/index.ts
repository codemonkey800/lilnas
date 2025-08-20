/**
 * @fileoverview Media Module Exports
 *
 * Central export file for the media integration module.
 * Exports the MediaModule and all media clients for use in other parts of the application.
 *
 * @since 1.0.0
 * @author TDR Bot Development Team
 */

export {
  BaseMediaApiClient,
  EmbyClient,
  RadarrClient,
  SonarrClient,
} from './clients'
export { MediaConfigValidationService } from './config/media-config.validation'
export { MediaModule } from './media.module'
export { MediaLoggingService } from './services/media-logging.service'
