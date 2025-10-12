import { BaseMessage, isAIMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'

/**
 * Validation utilities for checking LLM responses
 *
 * Extracted from llm.service.ts for reuse across strategies
 */
@Injectable()
export class ValidationUtilities {
  private readonly logger = new Logger(ValidationUtilities.name)

  /**
   * Validate download response for potential hallucinations
   * Extracted from llm.service.ts lines 2934-2986
   */
  validateDownloadResponse(
    response: BaseMessage,
    movieTitles: string[],
    seriesTitles: string[],
    userId: string,
  ): void {
    if (!isAIMessage(response)) return

    const responseContent = response.content.toString().toLowerCase()
    const allValidTitles = [
      ...movieTitles.map(title => title.toLowerCase()),
      ...seriesTitles.map(title => title.toLowerCase()),
    ]

    // Extract potential movie/show titles from response
    // Look for patterns like quotes, specific progress percentages, etc.
    const titlePatterns = [
      /"([^"]+)"/g, // Quoted titles
      /(\w+\s+\w+(?:\s+\w+)*)\s+(?:at\s+)?[\d.]+%/g, // Titles followed by progress
    ]

    const suspiciousTitles: string[] = []

    for (const pattern of titlePatterns) {
      let match
      while ((match = pattern.exec(responseContent)) !== null) {
        const potentialTitle = match[1]?.toLowerCase().trim()
        if (
          potentialTitle &&
          potentialTitle.length > 3 && // Ignore very short matches
          !allValidTitles.some(
            validTitle =>
              validTitle.includes(potentialTitle) ||
              potentialTitle.includes(validTitle),
          )
        ) {
          suspiciousTitles.push(potentialTitle)
        }
      }
    }

    if (suspiciousTitles.length > 0) {
      this.logger.warn(
        {
          userId,
          suspiciousTitles,
          validTitles: allValidTitles,
          responseContent: response.content.toString().substring(0, 200),
        },
        'Potential hallucination detected in download status response',
      )
    }
  }
}
