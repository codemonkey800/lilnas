/**
 * Command handlers index
 *
 * This file exports all command interaction handlers for centralized management
 * and easy importing in the commands module.
 */

export { MediaSearchInteractionHandler } from './media-search-interaction.handler'

// Export types for external usage
export type {
  MediaSearchInteraction,
  MediaSearchInteractionContext,
  MediaSearchResponse,
  MediaSearchResult,
  MediaSearchState,
} from '../media-search.types'

// Re-export useful utilities
export {
  COMPONENT_TIMEOUTS,
  createCustomId,
  DEFAULT_DISPLAY_OPTIONS,
  getMediaTypeEmoji,
  getStatusEmoji,
  isMediaSearchInteraction,
  parseCustomId,
  STATUS_ICONS,
} from '../media-search.types'
