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
  isExpired: boolean
  isActive: boolean
  data: ComponentStateData
  timeoutWarned: boolean
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
  refresh: ButtonBuilder
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
  pageInfo: ButtonBuilder
}

export interface MediaActionButtons {
  play: ButtonBuilder
  download: ButtonBuilder
  delete: ButtonBuilder
  monitor: ButtonBuilder
  unmonitor: ButtonBuilder
  search: ButtonBuilder
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
  filter?: (interaction: ComponentInteraction) => boolean
  idle?: number
}

export interface CollectorManager {
  collectors: Map<string, InteractionCollector<ComponentInteraction>>
  activeStates: Map<string, ComponentState>
  cleanupTasks: Map<string, NodeJS.Timeout>
  memoryThreshold: number
  maxConcurrentCollectors: number
  maxCollectorsPerUser: number
  defaultTimeout: number
  warningTimeout: number
}

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
  memoryFreed: number
  errors: string[]
  duration: number
}

export interface ComponentMetrics {
  totalComponents: number
  activeComponents: number
  expiredComponents: number
  totalInteractions: number
  avgResponseTime: number
  errorRate: number
  memoryUsage: number
  cacheHitRate: number
}

export interface TimeoutConfig {
  defaultTimeout: number
  warningTime: number
  gracePeriod: number
  maxExtensions: number
  extensionDuration: number
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
