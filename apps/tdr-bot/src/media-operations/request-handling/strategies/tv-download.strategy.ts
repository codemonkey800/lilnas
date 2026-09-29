import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import {
  DownloadApiError,
  type DownloadClient,
} from '@lilnas/utils/download/client'
import {
  type DownloadJob,
  DownloadJobStatus,
  isTerminalDownloadJobStatus,
  type QualityTier,
  type RequestShowInput,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { SonarrService } from 'src/media/services/sonarr.service'
import type { SeriesSearchResult } from 'src/media/types/sonarr.types'
import { isPathLikeLookupTerm } from 'src/media/utils/sonarr.utils'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import type {
  DiscordIdentity,
  StrategyRequestParams,
  StrategyResult,
} from 'src/media-operations/request-handling/types'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import type { TvShowSelection } from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'
import { downloadApiErrorMessage } from 'src/utils/download-api-error'
import { withDownloadLinks } from 'src/utils/download-links'

import { BaseMediaStrategy } from './base/base-media-strategy'
import { MAX_SEARCH_RESULTS } from './base/strategy.constants'
import type { TvShowSelectionContext } from './base/strategy.types'

/**
 * The reply to a show search whose term reads as a file path (`/foo`,
 * `C:\shows`) rather than a title - see `isPathLikeLookupTerm`.
 */
export const NOT_A_TITLE_REPLY =
  "That doesn't look like a title - it reads like a file path. Which show are you after?"

/** What a show request carries besides the show and the selection. */
interface ShowRequestOptions {
  /** Who asked - the download app attributes every job to them. */
  discord: DiscordIdentity
  /** Absent means the download app's default tier. */
  qualityTier?: QualityTier
  /**
   * The ordinal/year the user picked the show by in their own message
   * ("the 2008 one"), when it was auto-applied rather than chosen from a list
   */
  selectionCriteria?: string
}

/** How one `POST /download/shows` went: the job it made, or why it didn't. */
type ShowRequestOutcome =
  | { unit: RequestShowInput; job: DownloadJob }
  | { unit: RequestShowInput; error: unknown }

/**
 * The `POST /download/shows` requests a season/episode selection expands to,
 * in the order the user gave them:
 *
 * - no selection (absent or empty) - one whole-series request `{ tvdbId }`;
 * - `{ season }` (or `{ season, episodes: [] }`) - `{ tvdbId, seasonNumber }`;
 * - `{ season, episodes }` - `{ tvdbId, seasonNumber, episodeNumber }` per
 *   episode, which the download app resolves to Sonarr's episode id.
 *
 * Season 0 (specials) and episode 0 are real numbers, passed through as-is.
 * An exact repeat of an earlier unit is dropped. `qualityTier` goes on every
 * unit when set, and is omitted (not `undefined`) otherwise so the server's
 * default applies.
 */
export function toShowRequestUnits(
  tvdbId: number,
  tvSelection: TvShowSelection | null | undefined,
  qualityTier?: QualityTier,
): RequestShowInput[] {
  const tier = qualityTier ? { qualityTier } : {}
  const selection = tvSelection?.selection ?? []

  if (selection.length === 0) {
    return [{ tvdbId, ...tier }]
  }

  const units: RequestShowInput[] = []
  const seen = new Set<string>()
  const add = (seasonNumber: number, episodeNumber?: number) => {
    const key = `${seasonNumber}:${episodeNumber ?? '*'}`
    if (seen.has(key)) return
    seen.add(key)
    units.push({
      tvdbId,
      seasonNumber,
      ...(episodeNumber != null ? { episodeNumber } : {}),
      ...tier,
    })
  }

  for (const { season, episodes } of selection) {
    if (episodes == null || episodes.length === 0) {
      add(season)
    } else {
      for (const episode of episodes) add(season, episode)
    }
  }

  return units
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** "the whole series", "season 2", "the specials", "S02E05". */
function describeShowRequestUnit(unit: RequestShowInput): string {
  if (unit.seasonNumber == null) return 'the whole series'
  if (unit.episodeNumber != null) {
    return `S${pad2(unit.seasonNumber)}E${pad2(unit.episodeNumber)}`
  }
  return unit.seasonNumber === 0
    ? 'the specials'
    : `season ${unit.seasonNumber}`
}

/** One line on how a unit's request went, for the reply's summary. */
function describeShowRequestOutcome(outcome: ShowRequestOutcome): string {
  const part = describeShowRequestUnit(outcome.unit)

  if ('error' in outcome) {
    const reason = downloadApiErrorMessage(outcome.error)
    return outcome.error instanceof DownloadApiError
      ? `${part}: couldn't be requested - ${reason}`
      : `${part}: couldn't be requested - the download app might be unavailable (${reason})`
  }

  const { job } = outcome
  switch (job.status) {
    case DownloadJobStatus.Completed:
      return `${part}: already downloaded`
    case DownloadJobStatus.Failed:
      return `${part}: the request failed - ${job.error ?? 'no reason was given'}`
    case DownloadJobStatus.NotFound:
      return `${part}: no release was found${job.statusNote ? ` (${job.statusNote})` : ''}`
    case DownloadJobStatus.Cancelled:
      return `${part}: cancelled before it got anywhere`
    default:
      return `${part}: requested and queued${job.statusNote ? ` (${job.statusNote})` : ''}`
  }
}

/**
 * Strategy for handling TV show download requests.
 * Supports complex multi-turn flows with granular selection:
 * 1. New Search: Initial TV show download search with optional auto-selection
 * 2. Selection: User selecting from previously shown search results
 * 3. Granular Selection: User specifying seasons/episodes to download
 *
 * Search runs against Sonarr directly; the request itself goes to the
 * download app (`POST /download/shows`), which owns adding, monitoring,
 * quality tiers and searching, and records who asked. A selection becomes
 * one request per whole series, season or episode (see
 * {@link toShowRequestUnits}).
 *
 * Extracted from LLMService methods:
 * - handleNewTvShowSearch() (lines 3261-3571)
 * - handleTvShowSelection() (lines 3573-3752)
 * - downloadTvShow() (lines 1236-1309)
 */
@Injectable()
export class TvDownloadStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(TvDownloadStrategy.name)
  protected readonly strategyName = 'TvDownloadStrategy'

  constructor(
    private readonly sonarrService: SonarrService,
    private readonly downloadClientFactory: DownloadClientFactory,
    private readonly promptService: PromptGenerationService,
    private readonly parsingUtilities: ParsingUtilities,
    private readonly selectionUtilities: SelectionUtilities,
    state: StateService,
    contextService: ContextManagementService,
  ) {
    super()
    this.stateService = state
    this.contextService = contextService
  }

  /**
   * Handle TV show download request.
   * Routes to either new search or selection handling based on context.
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, context, userId, discord, qualityTier } = params

    this.logger.log(
      { userId, hasContext: !!context, strategy: this.strategyName },
      'Strategy execution started',
    )

    // If we have an active TV show context, this is a selection
    const tvShowContext = context as TvShowSelectionContext | undefined
    if (tvShowContext?.type === 'tvShow' && tvShowContext.isActive) {
      return await this.handleTvShowSelection(
        message,
        messages,
        tvShowContext,
        userId,
        // A tier named in the pick itself wins over one named with the search
        { discord, qualityTier: qualityTier ?? tvShowContext.qualityTier },
      )
    }

    // Otherwise, it's a new search
    return await this.handleNewTvShowSearch(message, messages, userId, {
      discord,
      qualityTier,
    })
  }

  /**
   * Handle new TV show search with complex auto-selection logic.
   * Extracted from handleNewTvShowSearch() in llm.service.ts (lines 3261-3571)
   */
  private async handleNewTvShowSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
    request: ShowRequestOptions,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show search',
    )
    // Kept on any selection context, so the follow-up pick still requests it
    const contextTier = request.qualityTier
      ? { qualityTier: request.qualityTier }
      : {}

    // Parse both search query and selection criteria upfront
    const messageContent = this.getMessageContent(message)
    const { searchQuery, selection, tvSelection } =
      await this.parsingUtilities.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse =
        await this.promptService.generateTvShowChatResponse(
          messages,
          'TV_SHOW_CLARIFICATION',
        )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    // A path-like term can't be a title - Sonarr v5 rejects the lookup and
    // `searchShows()` finds nothing for it - so say that, rather than that no
    // show matched. The term itself isn't logged.
    if (isPathLikeLookupTerm(searchQuery)) {
      this.logger.log({ userId }, 'TV show search term reads as a path')
      return {
        images: [],
        messages: messages.concat(
          new HumanMessage({ id: nanoid(), content: NOT_A_TITLE_REPLY }),
        ),
      }
    }

    try {
      // Search for TV shows using SonarrService
      const searchResults = await this.sonarrService.searchShows(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: searchResults.length,
          hasShowSelection: !!selection,
          hasGranularSelection: !!tvSelection?.selection,
        },
        'TV show search completed',
      )

      if (searchResults.length === 0) {
        const noResultsResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_NO_RESULTS',
            { searchQuery },
          )
        return {
          images: [],
          messages: messages.concat(noResultsResponse),
        }
      }

      // Smart auto-selection: Only apply when user provides BOTH search selection (ordinal/year only) AND granular TV selection
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        tvSelection &&
        Object.prototype.hasOwnProperty.call(tvSelection, 'selection') &&
        searchResults.length > 0
      ) {
        const selectedShow = this.selectionUtilities.findSelectedShow(
          selection,
          searchResults,
        )
        if (selectedShow) {
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
              tvSelection,
            },
            'Auto-applying complete TV show specification (search selection + granular selection)',
          )

          return await this.requestShow(
            selectedShow,
            tvSelection,
            messages,
            userId,
            {
              ...request,
              selectionCriteria: `${selection.selectionType}: ${selection.value}`,
            },
          )
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: searchResults.length },
            'Could not find selected show from complete specification, falling back to list',
          )
        }
      }

      // Show-only auto-selection: Apply when user provides ordinal/year selection but no granular selection
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        (!tvSelection ||
          !Object.prototype.hasOwnProperty.call(tvSelection, 'selection')) &&
        searchResults.length > 0
      ) {
        const selectedShow = this.selectionUtilities.findSelectedShow(
          selection,
          searchResults,
        )
        if (selectedShow) {
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
            },
            'Auto-selecting TV show for granular selection phase',
          )

          // Store single selected show in context for granular selection
          const tvShowContext = {
            type: 'tvShow' as const,
            searchResults: [selectedShow], // Only store the selected show
            query: searchQuery,
            timestamp: Date.now(),
            isActive: true,
            originalSearchSelection: selection,
            originalTvSelection: tvSelection || undefined,
            ...contextTier,
          }

          // Store context in ContextManagementService
          await this.contextService.setContext(userId, 'tv', tvShowContext)

          const granularSelectionResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_GRANULAR_SELECTION_NEEDED',
              { selectedShow },
            )

          return {
            images: [],
            messages: messages.concat(granularSelectionResponse),
          }
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: searchResults.length },
            'Could not find selected show from ordinal/year selection, falling back to list',
          )
        }
      }

      if (searchResults.length === 1) {
        // Only one result - but we still need granular selection
        this.logger.log(
          { userId, tvdbId: searchResults[0].tvdbId },
          'Single result found, checking for granular selection',
        )

        // If we have granular selection, apply it directly
        if (
          tvSelection &&
          Object.prototype.hasOwnProperty.call(tvSelection, 'selection')
        ) {
          this.logger.log(
            { userId, tvdbId: searchResults[0].tvdbId },
            'Single show with granular selection, requesting directly',
          )

          return await this.requestShow(
            searchResults[0],
            tvSelection,
            messages,
            userId,
            request,
          )
        }

        // Store context and ask for granular selection
        const tvShowContext = {
          type: 'tvShow' as const,
          searchResults: searchResults.slice(0, 1),
          query: searchQuery,
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: selection || undefined,
          originalTvSelection: tvSelection || undefined,
          ...contextTier,
        }

        // Store context in ContextManagementService
        await this.contextService.setContext(userId, 'tv', tvShowContext)

        const selectionResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SELECTION_NEEDED',
            { searchQuery, shows: searchResults.slice(0, 1) },
          )

        return {
          images: [],
          messages: messages.concat(selectionResponse),
        }
      }

      // Multiple results - store context and ask user to choose
      const tvShowContext = {
        type: 'tvShow' as const,
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: selection || undefined,
        originalTvSelection: tvSelection || undefined,
        ...contextTier,
      }

      // Store context in ContextManagementService
      await this.contextService.setContext(userId, 'tv', tvShowContext)

      // Create selection prompt
      const selectionResponse =
        await this.promptService.generateTvShowChatResponse(
          messages,
          'TV_SHOW_SELECTION_NEEDED',
          {
            searchQuery,
            shows: searchResults.slice(0, MAX_SEARCH_RESULTS),
          },
        )

      return {
        images: [],
        messages: messages.concat(selectionResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search for TV shows',
      )

      const errorResponse = await this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          searchQuery,
          errorMessage: `Couldn't search for "${searchQuery}" right now. The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Handle TV show selection with granular season/episode selection.
   * Extracted from handleTvShowSelection() in llm.service.ts (lines 3573-3752)
   */
  private async handleTvShowSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowContext: TvShowSelectionContext,
    userId: string,
    request: ShowRequestOptions,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show selection',
    )

    try {
      // Check if this is a show selection (ordinal, title, etc.) or a granular selection
      if (tvShowContext.searchResults.length > 1) {
        // Multiple shows - first need to select which show
        const searchSelection = await this.parsingUtilities
          .parseSearchSelection(this.getMessageContent(message))
          .catch(() => null)

        // If no selection was parsed, ask user to clarify
        if (!searchSelection) {
          const clarificationResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              {
                searchQuery: tvShowContext.query,
                shows: tvShowContext.searchResults,
              },
            )
          return {
            images: [],
            messages: messages.concat(clarificationResponse),
          }
        }

        const selectedShow = this.selectionUtilities.findSelectedShow(
          searchSelection,
          tvShowContext.searchResults,
        )

        if (!selectedShow) {
          const clarificationResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              {
                searchQuery: tvShowContext.query,
                shows: tvShowContext.searchResults,
              },
            )
          return {
            images: [],
            messages: messages.concat(clarificationResponse),
          }
        }

        // Show selected - check if we have stored granular selection to apply
        if (
          tvShowContext.originalTvSelection &&
          Object.prototype.hasOwnProperty.call(
            tvShowContext.originalTvSelection,
            'selection',
          )
        ) {
          // We have the original TV selection (either undefined for entire series or array for specific) - apply it automatically
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              originalTvSelection: tvShowContext.originalTvSelection,
            },
            'Auto-applying stored granular selection after show selection',
          )

          // Clear context and request the TV show with stored granular selection
          await this.contextService.clearContext(userId)
          return await this.requestShow(
            selectedShow,
            tvShowContext.originalTvSelection,
            messages,
            userId,
            request,
          )
        } else {
          // No stored granular selection or empty selection - ask user for it
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              originalTvSelection: tvShowContext.originalTvSelection,
            },
            'No granular selection found, asking user for season/episode selection',
          )

          const updatedContext = {
            ...tvShowContext,
            searchResults: [selectedShow],
            // A tier named with this pick carries on to the season/episode one
            ...(request.qualityTier
              ? { qualityTier: request.qualityTier }
              : {}),
          }
          // Store context in ContextManagementService
          await this.contextService.setContext(userId, 'tv', updatedContext)

          const granularSelectionResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              { searchQuery: tvShowContext.query, shows: [selectedShow] },
            )

          return {
            images: [],
            messages: messages.concat(granularSelectionResponse),
          }
        }
      }

      // Single show selected - parse granular selection (seasons/episodes)
      const messageContent = this.getMessageContent(message)

      const tvShowSelection = await this.parsingUtilities
        .parseTvShowSelection(messageContent)
        .catch(() => null)
      this.logger.log(
        { userId, selection: tvShowSelection },
        'Parsed TV show selection',
      )

      // If no granular selection was parsed, ask user to specify what to download
      if (!tvShowSelection) {
        const granularSelectionResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SELECTION_NEEDED',
            {
              searchQuery: tvShowContext.query,
              shows: tvShowContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(granularSelectionResponse),
        }
      }

      const selectedShow = tvShowContext.searchResults[0]

      // Clear context and request the TV show
      await this.contextService.clearContext(userId)
      return await this.requestShow(
        selectedShow,
        tvShowSelection,
        messages,
        userId,
        request,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show selection',
      )

      // Clear context on error
      try {
        await this.contextService.clearContext(userId)
      } catch (clearError) {
        this.logger.warn(
          { error: getErrorMessage(clearError), userId },
          'Failed to clear context during error cleanup',
        )
      }

      const errorResponse = await this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_PROCESSING_ERROR',
        {
          errorMessage:
            'Had trouble processing your selection. Please try searching again.',
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Request `show`'s selected parts from the download app as the Discord user
   * who asked, and reply once for all of them.
   *
   * The selection becomes one request per whole series, season or episode
   * ({@link toShowRequestUnits}). Each job the app answers with is usually
   * still in flight (`requested`/`searching`) - so the reply says the parts
   * were requested and queued, never that they downloaded. A job can also
   * come back already terminal: `completed` when the part was already
   * downloaded, or `failed`/`not_found`/`cancelled` when its request went
   * nowhere. One part failing doesn't stop the rest; the reply lists how each
   * went, and links the show's page once whenever any job exists.
   */
  private async requestShow(
    show: SeriesSearchResult,
    tvSelection: TvShowSelection | null | undefined,
    messages: BaseMessage[],
    userId: string,
    request: ShowRequestOptions,
  ): Promise<StrategyResult> {
    const units = toShowRequestUnits(
      show.tvdbId,
      tvSelection,
      request.qualityTier,
    )

    this.logger.log(
      {
        userId,
        showTitle: show.title,
        tvdbId: show.tvdbId,
        unitCount: units.length,
        qualityTier: request.qualityTier,
      },
      'Requesting show from the download app',
    )

    const outcomes = await this.sendShowRequests(
      this.downloadClientFactory.forDiscord(request.discord),
      units,
      userId,
      show,
    )

    const response = await this.replyForOutcomes(
      show,
      outcomes,
      messages,
      request,
    )

    // Every unit is the same show, so any job's media links the one page
    const job = outcomes.find(outcome => 'job' in outcome)?.job

    return {
      images: [],
      messages: messages.concat(
        // No job was created, so there is nothing to link to
        job
          ? withDownloadLinks(response, job.media, job.media.title)
          : response,
      ),
    }
  }

  /**
   * Sends `units` one at a time, in order: the first request for a show not
   * yet in Sonarr is the one that adds it, and the rest land on the series
   * it added rather than racing it. A unit that fails is recorded and the
   * next one still goes - except when the app couldn't be reached at all,
   * where the rest are recorded with the same error instead of each waiting
   * out another failed call.
   */
  private async sendShowRequests(
    client: DownloadClient,
    units: RequestShowInput[],
    userId: string,
    show: SeriesSearchResult,
  ): Promise<ShowRequestOutcome[]> {
    const outcomes: ShowRequestOutcome[] = []
    let unreachable: unknown

    for (const unit of units) {
      if (unreachable !== undefined) {
        outcomes.push({ unit, error: unreachable })
        continue
      }

      try {
        const startTime = Date.now()
        const job = await client.requestShow(unit)
        this.logger.log(
          {
            userId,
            showTitle: show.title,
            unit,
            jobId: job.id,
            status: job.status,
            duration: Date.now() - startTime,
          },
          'Show part requested',
        )
        outcomes.push({ unit, job })
      } catch (error) {
        this.logger.error(
          { error: downloadApiErrorMessage(error), userId, unit },
          'Failed to request show part',
        )
        outcomes.push({ unit, error })
        if (!(error instanceof DownloadApiError)) {
          unreachable = error
        }
      }
    }

    return outcomes
  }

  /** The one reply for every part's outcome, by where they stand together. */
  private replyForOutcomes(
    show: SeriesSearchResult,
    outcomes: ShowRequestOutcome[],
    messages: BaseMessage[],
    { selectionCriteria }: ShowRequestOptions,
  ): Promise<HumanMessage> {
    const jobs = outcomes.flatMap(outcome =>
      'job' in outcome ? [outcome.job] : [],
    )
    const requestResults = outcomes.map(describeShowRequestOutcome)

    if (jobs.length === 0) {
      const [only] = outcomes
      const errorMessage =
        outcomes.length === 1 && 'error' in only
          ? only.error instanceof DownloadApiError
            ? `Couldn't request "${show.title}": ${downloadApiErrorMessage(only.error)}`
            : `Couldn't request "${show.title}" - the download app might be unavailable (${downloadApiErrorMessage(only.error)}).`
          : `Couldn't request any of "${show.title}": ${requestResults.join('; ')}.`

      return this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        { selectedShow: show, errorMessage },
      )
    }

    if (
      jobs.length === outcomes.length &&
      jobs.every(job => job.status === DownloadJobStatus.Completed)
    ) {
      return this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ALREADY_DOWNLOADED',
        { selectedShow: show, requestResults },
      )
    }

    if (jobs.every(job => isTerminalDownloadJobStatus(job.status))) {
      return this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          selectedShow: show,
          errorMessage: `Requested "${show.title}", but nothing was queued: ${requestResults.join('; ')}.`,
        },
      )
    }

    return this.promptService.generateTvShowChatResponse(
      messages,
      'TV_SHOW_SUCCESS',
      {
        selectedShow: show,
        requestResults,
        autoApplied: selectionCriteria !== undefined,
        selectionCriteria,
      },
    )
  }
}
