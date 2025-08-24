import {
  ActionRowBuilder,
  APIActionRowComponent,
  APIMessageActionRowComponent,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  Guild,
  InteractionCollector,
  InteractionResponse,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  User,
} from 'discord.js'

import {
  CleanupReason,
  ComponentLifecycleState,
} from 'src/media/component-config'

import { MediaType } from './enums'

export interface CorrelationContext {
  correlationId: string
  userId: string
  username: string
  guildId: string
  channelId: string
  startTime: Date
  componentType?: ComponentType
  interactionType?: 'command' | 'component' | 'modal'
  mediaType?: MediaType
  searchTerm?: string
  requestId?: string
}

export interface ComponentState {
  id: string
  userId: string
  type: ComponentType
  correlationId: string
  sessionId: string
  expiresAt: Date
  createdAt: Date
  lastInteractionAt: Date
  interactionCount: number
  maxInteractions: number
  state: ComponentLifecycleState
  data: ComponentStateData
  cleanup?: () => Promise<void>
}

export interface ComponentStateData {
  searchResults?: SearchResultData[]
  currentPage?: number
  totalPages?: number
  pageSize?: number
  selectedItems?: SelectedItemData[]
  mediaType?: MediaType
  searchTerm?: string
  qualityProfiles?: QualityProfileData[]
  rootFolders?: RootFolderData[]
  formData?: FormData
  validationErrors?: ValidationError[]
  lastSearchTime?: Date
  searchQuery?: string
}

export interface SearchResultData {
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
  status?: string
  network?: string
  runtime?: number
  genres?: string[]
}

export interface SelectedItemData {
  id: string
  title: string
  year?: number
  mediaType: MediaType
  tmdbId?: number
  imdbId?: string
  tvdbId?: number
  qualityProfileId?: number
  rootFolderPath?: string
  episodeSpec?: string
  tags?: number[]
  monitored?: boolean
}

export interface QualityProfileData {
  id: number
  name: string
  isDefault?: boolean
}

export interface RootFolderData {
  id: number
  path: string
  freeSpace?: number
  accessible?: boolean
}

export interface FormData {
  [key: string]: string | number | boolean | string[] | number[]
}

export interface ValidationError {
  field: string
  message: string
  code?: string
}

export interface ComponentConstraints {
  maxActionRows: 5
  maxComponentsPerRow: 5
  maxSelectMenuOptions: 25
  maxSelectMenuValues: 25
  maxButtonsPerRow: 5
  maxTextInputsPerModal: 5
  maxTextInputLength: 4000
  maxLabelLength: 45
  maxPlaceholderLength: 100
  maxCustomIdLength: 100
}

export interface DiscordComponents {
  actionRow: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>
  buttons: DiscordButtonComponents
  selectMenus: DiscordSelectMenuComponents
  modals: DiscordModalComponents
  embeds: DiscordEmbedComponents
}

export interface DiscordButtonComponents {
  searchAction: ButtonBuilder
  requestAction: ButtonBuilder
  addToLibrary: ButtonBuilder
  viewDetails: ButtonBuilder
  cancel: ButtonBuilder
  confirm: ButtonBuilder
  pagination: PaginationButtons
  mediaActions: MediaActionButtons
}

export interface PaginationButtons {
  first: ButtonBuilder
  previous: ButtonBuilder
  next: ButtonBuilder
  last: ButtonBuilder
}

export interface MediaActionButtons {
  play: ButtonBuilder
  download: ButtonBuilder
  delete: ButtonBuilder
  monitor: ButtonBuilder
  unmonitor: ButtonBuilder
}

export interface DiscordSelectMenuComponents {
  searchResults: StringSelectMenuBuilder
  qualityProfiles: StringSelectMenuBuilder
  rootFolders: StringSelectMenuBuilder
  seasons: StringSelectMenuBuilder
  episodes: StringSelectMenuBuilder
  mediaActions: StringSelectMenuBuilder
}

export interface DiscordModalComponents {
  searchModal: ModalBuilder
  requestModal: ModalBuilder
  episodeModal: ModalBuilder
  settingsModal: ModalBuilder
  textInputs: ModalTextInputs
}

export interface ModalTextInputs {
  searchTerm: TextInputBuilder
  episodeSpec: TextInputBuilder
  customPath: TextInputBuilder
  tags: TextInputBuilder
  notes: TextInputBuilder
}

export interface DiscordEmbedComponents {
  searchResults: EmbedBuilder
  mediaDetails: EmbedBuilder
  requestConfirmation: EmbedBuilder
  downloadStatus: EmbedBuilder
  errorMessage: EmbedBuilder
  successMessage: EmbedBuilder
  helpMessage: EmbedBuilder
}

export interface ComponentCollectorConfig {
  time: number
  max?: number
  maxComponents?: number
  maxUsers?: number
  filter?: (interaction: MessageComponentInteraction) => boolean
  idle?: number
}

export interface CollectorManager {
  collectors: Map<string, InteractionCollector<MessageComponentInteraction>>
  activeStates: Map<string, ComponentState>
  timeouts: Map<string, NodeJS.Timeout>
}

export type MessageComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction

export type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction

export interface InteractionContext {
  interaction: ComponentInteraction
  state: ComponentState
  correlationContext: CorrelationContext
  user: User
  guild: Guild | null
  channel: TextChannel | null
  message: Message | null
}

export interface ComponentResponse {
  success: boolean
  response?: InteractionResponse
  error?: ComponentError
  shouldContinue: boolean
  newState?: Partial<ComponentStateData>
  cleanup?: boolean
}

export interface ComponentError {
  code: string
  message: string
  userMessage?: string
  correlationId: string
  timestamp: Date
  stack?: string
  context?: Record<string, unknown>
}

export interface RateLimitConfig {
  windowMs: number
  maxRequests: number
  skipSuccessfulRequests: boolean
  skipFailedRequests: boolean
  keyGenerator: (context: CorrelationContext) => string
}

export interface RateLimitState {
  requests: number
  windowStart: number
  resetTime: number
}

export interface ComponentFactory {
  createActionRow<T extends ButtonBuilder | StringSelectMenuBuilder>(
    components: T[],
  ): ActionRowBuilder<T>

  createButton(config: ButtonConfig): ButtonBuilder

  createSelectMenu(config: SelectMenuConfig): StringSelectMenuBuilder

  createModal(config: ModalConfig): ModalBuilder

  createEmbed(config: EmbedConfig): EmbedBuilder

  validateConstraints(component: unknown): ValidationResult
}

export interface ButtonConfig {
  customId: string
  label: string
  style: ButtonStyle
  emoji?: string
  disabled?: boolean
  url?: string
}

export interface SelectMenuConfig {
  customId: string
  placeholder: string
  options: SelectMenuOption[]
  minValues?: number
  maxValues?: number
  disabled?: boolean
}

export interface SelectMenuOption {
  label: string
  value: string
  description?: string
  emoji?: string
  default?: boolean
}

export interface ModalConfig {
  customId: string
  title: string
  components: ModalComponentConfig[]
}

export interface ModalComponentConfig {
  customId: string
  label: string
  style: TextInputStyle
  placeholder?: string
  required?: boolean
  minLength?: number
  maxLength?: number
  value?: string
}

export interface EmbedConfig {
  title?: string
  description?: string
  color?: number
  author?: EmbedAuthorConfig
  thumbnail?: EmbedImageConfig
  image?: EmbedImageConfig
  footer?: EmbedFooterConfig
  timestamp?: Date
  fields?: EmbedFieldConfig[]
  url?: string
}

export interface EmbedAuthorConfig {
  name: string
  iconURL?: string
  url?: string
}

export interface EmbedImageConfig {
  url: string
  height?: number
  width?: number
}

export interface EmbedFooterConfig {
  text: string
  iconURL?: string
}

export interface EmbedFieldConfig {
  name: string
  value: string
  inline?: boolean
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationWarning {
  field: string
  message: string
  code?: string
}

export interface ComponentCleanupResult {
  cleanedComponents: number
  cleanedStates: number
  errors: string[]
  duration: number
  reason: CleanupReason
}

export interface ComponentMetrics {
  totalComponents: number
  activeComponents: number
  expiredComponents: number
  totalInteractions: number
  avgResponseTime: number
  errorRate: number
}

export interface RetryConfig {
  maxAttempts: number
  baseDelay: number
  maxDelay: number
  exponentialBase: number
  retryableErrors: string[]
}

export interface ComponentSession {
  sessionId: string
  userId: string
  guildId: string
  channelId: string
  startTime: Date
  lastActivity: Date
  componentCount: number
  maxComponents: number
  isActive: boolean
  correlationId: string
  metadata: Record<string, unknown>
}

export type ActionRowComponent =
  APIActionRowComponent<APIMessageActionRowComponent>

export interface ComponentBuilderResult<T = ActionRowComponent> {
  component: T
  constraints: ComponentConstraints
  metadata: ComponentMetadata
}

export interface ComponentMetadata {
  type: ComponentType
  customId: string
  correlationId: string
  userId: string
  sessionId: string
  createdAt: Date
  expiresAt: Date
  maxInteractions: number
  currentInteractions: number
}

// Discriminated union types for Discord.js component data
export interface ButtonComponentData {
  custom_id?: string
  url?: string
  label?: string
  emoji?: {
    name?: string
    id?: string
    animated?: boolean
  }
  style?: number
  disabled?: boolean
}

export interface SelectMenuComponentData {
  custom_id?: string
  placeholder?: string
  options?: SelectMenuOptionData[]
  min_values?: number
  max_values?: number
  disabled?: boolean
}

export interface SelectMenuOptionData {
  label: string
  value: string
  description?: string
  emoji?: {
    name?: string
    id?: string
    animated?: boolean
  }
  default?: boolean
}

export interface ModalComponentData {
  custom_id?: string
  title?: string
  components?: ActionRowComponentData[]
}

export interface EmbedComponentData {
  title?: string
  description?: string
  color?: number
  author?: {
    name?: string
    url?: string
    icon_url?: string
  }
  thumbnail?: {
    url: string
    height?: number
    width?: number
  }
  image?: {
    url: string
    height?: number
    width?: number
  }
  footer?: {
    text?: string
    icon_url?: string
  }
  timestamp?: string
  url?: string
  fields?: EmbedFieldData[]
}

export interface EmbedFieldData {
  name?: string
  value?: string
  inline?: boolean
}

export interface ActionRowComponentData {
  type?: number
  components?: ComponentData[]
}

export interface ComponentData {
  type?: number
  custom_id?: string
  label?: string
  value?: string
  url?: string
  emoji?: {
    name?: string
    id?: string
    animated?: boolean
  }
  style?: number
  disabled?: boolean
  placeholder?: string
  options?: SelectMenuOptionData[]
  min_values?: number
  max_values?: number
}

// Type guard functions for runtime type validation
export function isButtonComponentData(
  data: unknown,
): data is ButtonComponentData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  // Optional fields type validation
  const validCustomId =
    obj.custom_id === undefined || typeof obj.custom_id === 'string'
  const validUrl = obj.url === undefined || typeof obj.url === 'string'
  const validLabel = obj.label === undefined || typeof obj.label === 'string'
  const validEmoji =
    obj.emoji === undefined ||
    (typeof obj.emoji === 'object' && obj.emoji !== null)
  const validStyle = obj.style === undefined || typeof obj.style === 'number'
  const validDisabled =
    obj.disabled === undefined || typeof obj.disabled === 'boolean'

  return (
    validCustomId &&
    validUrl &&
    validLabel &&
    validEmoji &&
    validStyle &&
    validDisabled
  )
}

export function isSelectMenuComponentData(
  data: unknown,
): data is SelectMenuComponentData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  // Validate optional fields
  const validCustomId =
    obj.custom_id === undefined || typeof obj.custom_id === 'string'
  const validPlaceholder =
    obj.placeholder === undefined || typeof obj.placeholder === 'string'
  const validMinValues =
    obj.min_values === undefined || typeof obj.min_values === 'number'
  const validMaxValues =
    obj.max_values === undefined || typeof obj.max_values === 'number'
  const validDisabled =
    obj.disabled === undefined || typeof obj.disabled === 'boolean'
  const validOptions =
    obj.options === undefined ||
    (Array.isArray(obj.options) && obj.options.every(isSelectMenuOptionData))

  return (
    validCustomId &&
    validPlaceholder &&
    validMinValues &&
    validMaxValues &&
    validDisabled &&
    validOptions
  )
}

export function isSelectMenuOptionData(
  data: unknown,
): data is SelectMenuOptionData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  // Required fields
  const hasLabel = typeof obj.label === 'string'
  const hasValue = typeof obj.value === 'string'

  // Optional fields
  const validDescription =
    obj.description === undefined || typeof obj.description === 'string'
  const validDefault =
    obj.default === undefined || typeof obj.default === 'boolean'
  const validEmoji =
    obj.emoji === undefined ||
    (typeof obj.emoji === 'object' && obj.emoji !== null)

  return hasLabel && hasValue && validDescription && validDefault && validEmoji
}

export function isModalComponentData(
  data: unknown,
): data is ModalComponentData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  const validCustomId =
    obj.custom_id === undefined || typeof obj.custom_id === 'string'
  const validTitle = obj.title === undefined || typeof obj.title === 'string'
  const validComponents =
    obj.components === undefined ||
    (Array.isArray(obj.components) &&
      obj.components.every(isActionRowComponentData))

  return validCustomId && validTitle && validComponents
}

export function isEmbedComponentData(
  data: unknown,
): data is EmbedComponentData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  // All fields are optional, so we just validate types when present
  const validTitle = obj.title === undefined || typeof obj.title === 'string'
  const validDescription =
    obj.description === undefined || typeof obj.description === 'string'
  const validColor = obj.color === undefined || typeof obj.color === 'number'
  const validUrl = obj.url === undefined || typeof obj.url === 'string'
  const validTimestamp =
    obj.timestamp === undefined || typeof obj.timestamp === 'string'
  const validFields =
    obj.fields === undefined ||
    (Array.isArray(obj.fields) && obj.fields.every(isEmbedFieldData))

  return (
    validTitle &&
    validDescription &&
    validColor &&
    validUrl &&
    validTimestamp &&
    validFields
  )
}

export function isEmbedFieldData(data: unknown): data is EmbedFieldData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  const validName = obj.name === undefined || typeof obj.name === 'string'
  const validValue = obj.value === undefined || typeof obj.value === 'string'
  const validInline =
    obj.inline === undefined || typeof obj.inline === 'boolean'

  return validName && validValue && validInline
}

export function isActionRowComponentData(
  data: unknown,
): data is ActionRowComponentData {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false
  }

  const obj = data as Record<string, unknown>

  const validType = obj.type === undefined || typeof obj.type === 'number'
  const validComponents =
    obj.components === undefined || Array.isArray(obj.components)

  return validType && validComponents
}

// Enhanced type guard that can extract specific properties safely
export function extractButtonData(builder: { data: unknown }): {
  customId: string | undefined
  url: string | undefined
  label: string | undefined
  emoji: unknown | undefined
} {
  if (!isButtonComponentData(builder.data)) {
    return {
      customId: undefined,
      url: undefined,
      label: undefined,
      emoji: undefined,
    }
  }

  return {
    customId: builder.data.custom_id,
    url: builder.data.url,
    label: builder.data.label,
    emoji: builder.data.emoji,
  }
}

export function extractSelectMenuData(builder: { data: unknown }): {
  customId: string | undefined
  options: SelectMenuOptionData[] | undefined
} {
  if (!isSelectMenuComponentData(builder.data)) {
    return {
      customId: undefined,
      options: undefined,
    }
  }

  return {
    customId: builder.data.custom_id,
    options: builder.data.options,
  }
}

export function extractModalData(builder: { data: unknown }): {
  customId: string | undefined
  title: string | undefined
  components: ActionRowComponentData[] | undefined
} {
  if (!isModalComponentData(builder.data)) {
    return {
      customId: undefined,
      title: undefined,
      components: undefined,
    }
  }

  return {
    customId: builder.data.custom_id,
    title: builder.data.title,
    components: builder.data.components,
  }
}

export function extractEmbedData(builder: { data: unknown }): {
  title: string | undefined
  description: string | undefined
  fields: EmbedFieldData[] | undefined
  author: { name?: string } | undefined
  footer: { text?: string } | undefined
} {
  if (!isEmbedComponentData(builder.data)) {
    return {
      title: undefined,
      description: undefined,
      fields: undefined,
      author: undefined,
      footer: undefined,
    }
  }

  return {
    title: builder.data.title,
    description: builder.data.description,
    fields: builder.data.fields,
    author: builder.data.author,
    footer: builder.data.footer,
  }
}

export function extractActionRowData(builder: { data: unknown }): {
  components: ComponentData[] | undefined
} {
  if (!isActionRowComponentData(builder.data)) {
    return {
      components: undefined,
    }
  }

  return {
    components: builder.data.components,
  }
}

// Helper function to safely extract string values from metadata
export function extractStringFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key]
  return typeof value === 'string' ? value : undefined
}
