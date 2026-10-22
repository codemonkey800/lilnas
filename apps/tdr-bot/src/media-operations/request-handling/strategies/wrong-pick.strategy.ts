import { HumanMessage } from '@langchain/core/messages'
import type { DownloadClient } from '@lilnas/utils/download/client'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { PromptGenerationService } from 'src/llm/skills/media/prompt-generation.service'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import {
  MediaContextType,
  StrategyRequestParams,
  StrategyResult,
} from 'src/media-operations/request-handling/types'
import { searchWithCompactFallback } from 'src/media-operations/request-handling/utils/title-search.utils'
import { downloadApiErrorMessage } from 'src/utils/download-api-error'

import { BaseMediaStrategy } from './base/base-media-strategy'
import { MAX_SEARCH_RESULTS } from './base/strategy.constants'
import type {
  MovieSelectionContext,
  RecentRequestContext,
  TvShowSelectionContext,
} from './base/strategy.types'

/** How undoing the request went, for the reply's opening line. */
type UndoOutcome =
  | { kind: 'removed' }
  | { kind: 'keptExisting' }
  | { kind: 'removeFailed'; reason: string }

/** The opening line of the reply - what was undone, in plain words. */
function describeUndo(title: string, outcome: UndoOutcome): string {
  switch (outcome.kind) {
    case 'removed':
      return `My bad - I cancelled the request for "${title}" and removed it from the library.`
    case 'keptExisting':
      return `My bad - I cancelled the request for "${title}". It was already in the library before you asked, so I left it there.`
    case 'removeFailed':
      return `I cancelled the request for "${title}", but couldn't remove it from the library (${outcome.reason}) - an admin may need to delete it from the download app.`
  }
}

/**
 * Strategy for "that's the wrong one" right after a request went through.
 *
 * Runs on a {@link RecentRequestContext}, which only the user who made the
 * request can answer. It:
 * 1. cancels the request's jobs (one that already finished is left alone);
 * 2. removes the title from Sonarr/Radarr - files and all - but only when
 *    the request is what added it, so nobody else's show or movie goes;
 * 3. re-runs the same search without the wrong title and offers the rest,
 *    carrying the original seasons/episodes and quality to the new pick.
 */
@Injectable()
export class WrongPickStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(WrongPickStrategy.name)
  protected readonly strategyName = 'WrongPickStrategy'

  constructor(
    private readonly sonarrService: SonarrService,
    private readonly radarrService: RadarrService,
    private readonly downloadClientFactory: DownloadClientFactory,
    private readonly promptService: PromptGenerationService,
  ) {
    super()
  }

  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { messages, userId, discord } = params
    const recent = params.context as RecentRequestContext

    this.logger.log(
      {
        userId,
        title: recent.title,
        mediaId: recent.mediaId,
        jobIds: recent.jobIds,
        wasInLibrary: recent.wasInLibrary,
      },
      'Undoing a request the user says picked the wrong title',
    )

    const client = this.downloadClientFactory.forDiscord(discord)
    await this.cancelJobs(client, recent, userId)
    const undo = await this.removeIfAdded(client, recent, userId)
    const undoLine = describeUndo(recent.title, undo)

    try {
      return recent.mediaType === 'tv'
        ? await this.offerOtherShows(recent, messages, undoLine)
        : await this.offerOtherMovies(recent, messages, undoLine)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, query: recent.query },
        'Failed to re-run the search after undoing a request',
      )
      return this.reply(
        messages,
        `${undoLine}\n\nI couldn't search again just now - tell me the exact title and I'll grab the right one.`,
      )
    }
  }

  /**
   * Cancels each of the request's jobs. One that is already terminal (or
   * gone) can't be cancelled, and that's fine - there's nothing left to stop.
   */
  private async cancelJobs(
    client: DownloadClient,
    recent: RecentRequestContext,
    userId: string,
  ): Promise<void> {
    await Promise.all(
      recent.jobIds.map(async jobId => {
        try {
          if (recent.mediaType === 'tv') {
            await client.cancelShowJob(jobId)
          } else {
            await client.cancelMovieJob(jobId)
          }
        } catch (error) {
          this.logger.log(
            { error: downloadApiErrorMessage(error), userId, jobId },
            'Job could not be cancelled (likely already finished)',
          )
        }
      }),
    )
  }

  /**
   * Deletes the title's files and takes it out of Sonarr/Radarr - only when
   * it wasn't in the library before the request.
   */
  private async removeIfAdded(
    client: DownloadClient,
    recent: RecentRequestContext,
    userId: string,
  ): Promise<UndoOutcome> {
    if (recent.wasInLibrary) return { kind: 'keptExisting' }

    try {
      const result = await client.deleteMediaFiles(recent.mediaId)
      this.logger.log(
        {
          userId,
          mediaId: recent.mediaId,
          deletedCount: result.deletedCount,
          removedFromLibrary: result.removedFromLibrary,
        },
        'Removed the wrongly requested title',
      )
      return result.removedFromLibrary
        ? { kind: 'removed' }
        : {
            kind: 'removeFailed',
            reason: 'the download app kept it in the library',
          }
    } catch (error) {
      const reason = downloadApiErrorMessage(error)
      this.logger.error(
        { error: reason, userId, mediaId: recent.mediaId },
        'Failed to remove the wrongly requested title',
      )
      return { kind: 'removeFailed', reason }
    }
  }

  private async offerOtherShows(
    recent: RecentRequestContext,
    messages: StrategyRequestParams['messages'],
    undoLine: string,
  ): Promise<StrategyResult> {
    const shows = (
      await searchWithCompactFallback(
        recent.query,
        term => this.sonarrService.searchShows(term),
        show => show.tvdbId,
      )
    )
      .filter(show => show.tvdbId !== recent.externalId)
      .slice(0, MAX_SEARCH_RESULTS)

    if (shows.length === 0) return this.askForTitle(recent, messages, undoLine)

    const context: TvShowSelectionContext = {
      type: 'tvShow',
      searchResults: shows,
      query: recent.query,
      timestamp: Date.now(),
      isActive: true,
      ...(recent.tvSelection
        ? { originalTvSelection: recent.tvSelection }
        : {}),
      ...(recent.qualityTier ? { qualityTier: recent.qualityTier } : {}),
    }

    const response = await this.promptService.generateTvShowChatResponse(
      messages,
      'TV_SHOW_SELECTION_NEEDED',
      { searchQuery: recent.query, shows },
    )

    return {
      images: [],
      messages: [this.withUndoLine(undoLine, response)],
      pendingContext: { type: MediaContextType.TvDownload, data: context },
    }
  }

  private async offerOtherMovies(
    recent: RecentRequestContext,
    messages: StrategyRequestParams['messages'],
    undoLine: string,
  ): Promise<StrategyResult> {
    const movies = (
      await searchWithCompactFallback(
        recent.query,
        term => this.radarrService.searchMovies(term),
        movie => movie.tmdbId,
      )
    )
      .filter(movie => movie.tmdbId !== recent.externalId)
      .slice(0, MAX_SEARCH_RESULTS)

    if (movies.length === 0) return this.askForTitle(recent, messages, undoLine)

    const context: MovieSelectionContext = {
      type: 'movie',
      searchResults: movies,
      query: recent.query,
      timestamp: Date.now(),
      isActive: true,
      ...(recent.qualityTier ? { qualityTier: recent.qualityTier } : {}),
    }

    const response = await this.promptService.generateMoviePrompt(
      messages,
      'multiple_results',
      { searchQuery: recent.query, movies },
    )

    return {
      images: [],
      messages: [this.withUndoLine(undoLine, response)],
      pendingContext: { type: MediaContextType.MovieDownload, data: context },
    }
  }

  private askForTitle(
    recent: RecentRequestContext,
    messages: StrategyRequestParams['messages'],
    undoLine: string,
  ): StrategyResult {
    return this.reply(
      messages,
      `${undoLine}\n\nI couldn't find anything else for "${recent.query}" - what's the exact title you're after?`,
    )
  }

  /** The undo line leads, so what was cancelled is said in plain words. */
  private withUndoLine(undoLine: string, response: HumanMessage): HumanMessage {
    return new HumanMessage({
      id: response.id ?? nanoid(),
      content: `${undoLine}\n\n${String(response.content)}`,
    })
  }

  private reply(
    messages: StrategyRequestParams['messages'],
    content: string,
  ): StrategyResult {
    return {
      images: [],
      messages: [new HumanMessage({ id: nanoid(), content })],
    }
  }
}
