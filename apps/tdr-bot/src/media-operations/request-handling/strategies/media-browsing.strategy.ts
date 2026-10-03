import { HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { LlmClient } from 'src/llm/client/llm-client'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'
import { DataFetchingUtilities } from 'src/media-operations/request-handling/utils/data-fetching.utils'
import { MediaRequest, SearchIntent } from 'src/schemas/graph'
import { MEDIA_CONTEXT_PROMPT } from 'src/utils/prompts'

import { BaseMediaStrategy } from './base/base-media-strategy'

/**
 * Strategy for handling media browsing requests (library/external search without download intent)
 *
 * Extracted from llm.service.ts handleMediaBrowsing (lines 829-908)
 */
@Injectable()
export class MediaBrowsingStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(MediaBrowsingStrategy.name)
  protected readonly strategyName = 'MediaBrowsingStrategy'

  constructor(
    llm: LlmClient,
    private readonly dataFetchingUtilities: DataFetchingUtilities,
  ) {
    super()
    this.llm = llm
  }

  /**
   * Execute media browsing request
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, context } = params

    // Context should contain MediaRequest
    const mediaRequest = context as MediaRequest

    const { mediaType, searchIntent, searchTerms } = mediaRequest
    const searchQuery = searchTerms.trim()

    this.logger.log(
      { mediaType, searchIntent, searchQuery, strategy: this.strategyName },
      'Strategy execution started - processing media browsing request',
    )

    // Fetch data based on intent and type
    let mediaData = ''
    let totalCount = 0

    // Fetch library data if needed
    if (
      searchIntent === SearchIntent.Library ||
      searchIntent === SearchIntent.Both
    ) {
      const libraryData = await this.dataFetchingUtilities.fetchLibraryData(
        mediaType,
        searchQuery,
      )
      mediaData += libraryData.content
      totalCount += libraryData.count
    }

    // Fetch external search data if needed
    if (
      searchIntent === SearchIntent.External ||
      searchIntent === SearchIntent.Both
    ) {
      if (searchQuery) {
        const externalData =
          await this.dataFetchingUtilities.fetchExternalSearchData(
            mediaType,
            searchQuery,
          )
        if (searchIntent === SearchIntent.Both && mediaData) {
          mediaData += '\n\n---\n'
        }
        mediaData += externalData.content
        totalCount += externalData.count
      } else {
        this.logger.warn(
          'External search requested but no search terms extracted',
        )
        mediaData +=
          '\n\n**SEARCH:** Please provide more specific search terms to find new content.'
      }
    }

    // Create context prompt for conversational response
    const contextPrompt = new HumanMessage({
      content: `${typeof MEDIA_CONTEXT_PROMPT.content === 'string' ? MEDIA_CONTEXT_PROMPT.content : 'Respond about media content.'}\n\nUser's request: "${message.content}"\n\nMEDIA DATA:${mediaData}`,
      id: nanoid(),
    })

    // Get conversational response from chat model
    this.logger.log('Getting conversational response with media context')
    const { message: chatResponse } = await this.llm.call({
      operation: 'media.browse',
      role: 'chat',
      messages: [...messages, contextPrompt],
    })

    this.logger.log(
      { mediaType, searchIntent, totalCount },
      'Media browsing response generated successfully',
    )

    return {
      images: [],
      messages: messages.concat(chatResponse),
    }
  }
}
