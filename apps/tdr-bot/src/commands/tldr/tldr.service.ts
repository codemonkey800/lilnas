import { HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'

import { DISCORD_MAX_MESSAGE_LENGTH } from 'src/constants/chat'
import { LlmClient } from 'src/llm/client/llm-client'
import { PromptService } from 'src/messages/prompts/prompt.service'

import { buildTldrInstruction } from './prompts'
import {
  formatWhen,
  linkifyCitations,
  renderTranscript,
  splitForDiscord,
} from './transcript'
import { TldrError, TldrWindow } from './types'

export interface TldrRequest {
  window: TldrWindow
  requester: { id: string; name: string }
  /** Only summarize what this person said; null for everyone. */
  from: { id: string; name: string } | null
  /** Answer this instead of summarizing; null for a summary. */
  question: string | null
}

const TLDR_TIMEOUT_MS = 90_000
const TLDR_MAX_TOKENS = 1_200
/** Most Discord messages one reply may post, so a runaway reply can't flood. */
const MAX_REPLY_CHUNKS = 2
const CUT_OFF = '\n… _(cut off)_'

@Injectable()
export class TldrService {
  private readonly logger = new Logger(TldrService.name)

  constructor(
    private readonly llm: LlmClient,
    private readonly promptService: PromptService,
  ) {}

  /** Discord-ready chunks, each ≤ 2000 chars, at least one. */
  async summarize(request: TldrRequest): Promise<string[]> {
    const { window, question } = request
    if (window.messages.length === 0) throw new TldrError('empty')

    const transcript = renderTranscript(window)
    const mode = question === null ? 'summary' : 'question'

    this.logger.log(
      {
        messages: window.messages.length,
        threads: window.threadCount,
        chars: transcript.text.length,
        mode,
      },
      'Summarizing channel window',
    )

    const result = await this.llm.call({
      operation: question === null ? 'tldr.summarize' : 'tldr.answer',
      role: 'chat',
      messages: [
        this.promptService.getSystemPrompt(),
        buildTldrInstruction(request),
        new HumanMessage(transcript.text),
      ],
      overrides: { timeoutMs: TLDR_TIMEOUT_MS, maxTokens: TLDR_MAX_TOKENS },
    })

    this.logger.log(
      {
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        finishReason: result.finishReason,
      },
      'Summary generated',
    )

    const body = linkifyCitations(result.output.trim(), transcript.links)
    const chunks = splitForDiscord(`${this.header(request)}\n\n${body}`)
    if (chunks.length <= MAX_REPLY_CHUNKS) return chunks

    this.logger.warn(
      { chunks: chunks.length, finishReason: result.finishReason },
      'Reply too long, cutting it off',
    )
    const kept = chunks.slice(0, MAX_REPLY_CHUNKS)
    const last = kept.length - 1
    kept[last] =
      kept[last].slice(0, DISCORD_MAX_MESSAGE_LENGTH - CUT_OFF.length) + CUT_OFF
    return kept
  }

  private header({ window, question }: TldrRequest): string {
    const count = window.messages.length
    const where = `#${window.channelName}`
    let line =
      question === null
        ? `**TL;DR of ${where}** since ${formatWhen(window.since)}`
        : `**Re: "${question}"** in ${where} since ${formatWhen(window.since)}`

    line +=
      window.sinceSource === 'fallback'
        ? ` · newest ${count} messages`
        : ` · ${count} messages`
    if (window.threadCount > 0) line += ` in ${window.threadCount} threads`
    if (window.sinceSource === 'lastMessage') {
      line += ' · since your last message'
    }
    if (window.clipped) line += ' · clipped to the newest 1000'
    return line
  }
}
