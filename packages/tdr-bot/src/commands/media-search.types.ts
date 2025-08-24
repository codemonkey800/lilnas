import {
  ButtonInteraction,
  ComponentType,
  StringSelectMenuInteraction,
} from 'discord.js'

import { MediaType } from 'src/types/enums'

/**
 * Component state data specific to media search interactions
 */
export interface MediaSearchState {
  searchTerm: string
  searchType: 'movies' | 'series' | 'both'
  currentPage: number
  totalPages: number
  pageSize: number
  results: MediaSearchResult[]
  lastSearchTime: Date
}

/**
 * Media search result data structure
 */
export interface MediaSearchResult {
  id: string
  title: string
  year?: number
  overview?: string
  posterUrl?: string
  tmdbId?: number
  imdbId?: string
  tvdbId?: number
  mediaType: MediaType
  inLibrary: boolean
  monitored?: boolean
  hasFile?: boolean
  status?: 'wanted' | 'downloaded' | 'available'
  runtime?: number
  genres?: string[]
}

/**
 * Component interaction types for media search
 */
export type MediaSearchInteraction =
  | MediaSearchSelectMenuInteraction
  | MediaSearchButtonInteraction

/**
 * Select menu interaction for search results
 */
export interface MediaSearchSelectMenuInteraction
  extends StringSelectMenuInteraction {
  customId: string // Format: search_results:{correlationId}:{page}
  values: string[] // Format: ['movie:123', 'series:456']
}

/**
 * Button interaction for pagination and actions
 */
export interface MediaSearchButtonInteraction extends ButtonInteraction {
  customId: string // Various formats for different actions
}

/**
 * Custom ID parsing results
 */
export interface ParsedCustomId {
  action: string
  correlationId: string
  additionalData?: Record<string, string>
}

/**
 * Media action types available for search results
 */
export enum MediaSearchAction {
  // Select menu actions
  SELECT_RESULT = 'search_results',

  // Button actions - pagination
  PAGINATION_FIRST = 'pagination_first',
  PAGINATION_PREVIOUS = 'pagination_previous',
  PAGINATION_NEXT = 'pagination_next',
  PAGINATION_LAST = 'pagination_last',

  // Button actions - media management
  REQUEST_MEDIA = 'request_media',
  VIEW_DETAILS = 'view_details',
  PLAY_MEDIA = 'play_media',
  ADD_TO_LIBRARY = 'add_to_library',
  MONITOR_MEDIA = 'monitor_media',
  UNMONITOR_MEDIA = 'unmonitor_media',
  SEARCH_MANUAL = 'search_manual',
  REFRESH_DATA = 'refresh_data',

  // Utility actions
  CANCEL = 'cancel',
  NEW_SEARCH = 'new_search',
}

/**
 * Component interaction context
 */
export interface MediaSearchInteractionContext {
  interaction: MediaSearchInteraction
  correlationId: string
  userId: string
  action: MediaSearchAction
  mediaId?: string
  mediaType?: MediaType
  page?: number
  additionalParams?: Record<string, string>
}

/**
 * Response data for component interactions
 */
export interface MediaSearchResponse {
  success: boolean
  message?: string
  updatedState?: Partial<MediaSearchState>
  shouldUpdateMessage?: boolean
  shouldCreateNewMessage?: boolean
  components?: boolean // Whether to include components in response
  embed?: boolean // Whether to include embed in response
}

/**
 * Pagination metadata
 */
export interface PaginationMetadata {
  currentPage: number
  totalPages: number
  pageSize: number
  totalResults: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

/**
 * Search result display options
 */
export interface MediaSearchDisplayOptions {
  showStatusIcons: boolean
  showYear: boolean
  showOverview: boolean
  truncateOverview: boolean
  overviewMaxLength: number
  showPagination: boolean
  showActionButtons: boolean
  maxResultsPerPage: number
}

/**
 * Error types specific to media search
 */
export enum MediaSearchErrorType {
  INVALID_SEARCH_TERM = 'invalid_search_term',
  NO_RESULTS_FOUND = 'no_results_found',
  API_ERROR = 'api_error',
  INVALID_PAGINATION = 'invalid_pagination',
  INVALID_MEDIA_ID = 'invalid_media_id',
  COMPONENT_EXPIRED = 'component_expired',
  INSUFFICIENT_PERMISSIONS = 'insufficient_permissions',
  RATE_LIMITED = 'rate_limited',
}

/**
 * Default display options
 */
export const DEFAULT_DISPLAY_OPTIONS: MediaSearchDisplayOptions = {
  showStatusIcons: true,
  showYear: true,
  showOverview: true,
  truncateOverview: true,
  overviewMaxLength: 100,
  showPagination: true,
  showActionButtons: true,
  maxResultsPerPage: 10,
}

/**
 * Component timeout configurations
 */
export const COMPONENT_TIMEOUTS = {
  SEARCH_RESULTS: 15 * 60 * 1000, // 15 minutes
  INTERACTION_ACK: 3000, // 3 seconds for interaction acknowledgment
  API_REQUEST: 10000, // 10 seconds for API requests
} as const

/**
 * Custom ID format constants
 */
export const CUSTOM_ID_PATTERNS = {
  SEARCH_RESULTS: /^search_results:([^:]+):(\d+)$/,
  PAGINATION: /^pagination:([^:]+):([^:]+):(\d+)$/,
  MEDIA_ACTION: /^media_action:([^:]+):([^:]+):([^:]+)$/,
  SIMPLE_ACTION: /^([^:]+):([^:]+)$/,
} as const

/**
 * Status icons for different media states
 */
export const STATUS_ICONS = {
  MOVIE: '🎬',
  SERIES: '📺',
  IN_LIBRARY: '✅',
  MONITORED: '👁️',
  DOWNLOADING: '⬇️',
  AVAILABLE: '📥',
  WANTED: '❓',
  ERROR: '❌',
} as const

/**
 * Helper function to parse custom IDs
 */
export function parseCustomId(customId: string): ParsedCustomId | null {
  // Try different patterns
  for (const [patternName, pattern] of Object.entries(CUSTOM_ID_PATTERNS)) {
    const match = customId.match(pattern)
    if (match) {
      const [, correlationId, ...rest] = match
      return {
        action: patternName.toLowerCase(),
        correlationId,
        additionalData: rest.reduce(
          (acc, value, index) => {
            acc[`param${index}`] = value
            return acc
          },
          {} as Record<string, string>,
        ),
      }
    }
  }

  // Fallback to simple parsing
  const parts = customId.split(':')
  if (parts.length >= 2) {
    return {
      action: parts[0],
      correlationId: parts[1],
      additionalData: parts.slice(2).reduce(
        (acc, value, index) => {
          acc[`param${index}`] = value
          return acc
        },
        {} as Record<string, string>,
      ),
    }
  }

  return null
}

/**
 * Helper function to create custom IDs
 */
export function createCustomId(
  action: string,
  correlationId: string,
  ...params: string[]
): string {
  return [action, correlationId, ...params].join(':')
}

/**
 * Type guard for media search interactions
 */
export function isMediaSearchInteraction(
  interaction: unknown,
): interaction is MediaSearchInteraction {
  return (
    typeof interaction === 'object' &&
    interaction !== null &&
    'componentType' in interaction &&
    'customId' in interaction &&
    ((interaction as { componentType: unknown }).componentType ===
      ComponentType.StringSelect ||
      (interaction as { componentType: unknown }).componentType ===
        ComponentType.Button) &&
    typeof (interaction as { customId: unknown }).customId === 'string'
  )
}

/**
 * Helper function to get media type emoji
 */
export function getMediaTypeEmoji(mediaType: MediaType): string {
  return mediaType === MediaType.MOVIE
    ? STATUS_ICONS.MOVIE
    : STATUS_ICONS.SERIES
}

/**
 * Helper function to get status emoji
 */
export function getStatusEmoji(result: MediaSearchResult): string {
  if (result.inLibrary) {
    return STATUS_ICONS.IN_LIBRARY
  }
  // Note: 'downloading' status not currently used in this implementation
  // if (result.status === 'downloading') {
  //   return STATUS_ICONS.DOWNLOADING
  // }
  if (result.status === 'available') {
    return STATUS_ICONS.AVAILABLE
  }
  if (result.status === 'wanted') {
    return STATUS_ICONS.WANTED
  }
  return ''
}
