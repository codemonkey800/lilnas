import { AIMessage, BaseMessage, isAIMessage } from '@langchain/core/messages'
import { Injectable } from '@nestjs/common'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import type { ActiveMediaContext } from 'src/media-operations/request-handling/types'

import { Skill, SkillInput, SkillOutput } from './skill.interface'

const MEDIA_REQUEST =
  /\b(download|delete|remove)\b.*\b(movie|film|show|series|season|episode)\b/i
const DOWNLOAD_STATUS = /what('s| is) downloading/i

/** Movie and TV downloads, deletions, library browsing and download status. */
@Injectable()
export class MediaSkill implements Skill {
  readonly id = 'media'
  readonly description =
    'Download, delete or browse movies and TV shows, check what is downloading, and answer follow-up picks like "the first one"'

  constructor(private readonly handler: MediaRequestHandler) {}

  match(input: SkillInput): boolean {
    const text = String(input.message.content)
    return MEDIA_REQUEST.test(text) || DOWNLOAD_STATUS.test(text)
  }

  async run(input: SkillInput): Promise<SkillOutput> {
    const { message, history } = input
    const base = [...history, message]

    const result = await this.handler.handleRequest(
      message,
      base,
      input.userId,
      input.discord,
      input.followUp as ActiveMediaContext | undefined,
    )

    if (result.reroute) return { messages: [], followUp: null, reroute: true }

    // Strategies hand back the whole conversation they were given plus their
    // reply; the graph already holds the conversation, so keep what's new.
    const seen = new Set<BaseMessage>(base)
    const reply = result.messages
      .filter(m => !seen.has(m))
      .map(m =>
        isAIMessage(m) ? m : new AIMessage({ id: m.id, content: m.content }),
      )

    return {
      messages: reply,
      images: result.images,
      followUp: result.pendingContext ? { data: result.pendingContext } : null,
    }
  }
}
