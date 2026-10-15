import { HumanMessage } from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'

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
      },
      'Summary generated',
    )

    const body = linkifyCitations(result.output.trim(), transcript.links)
    return splitForDiscord(`${this.header(request)}\n\n${body}`)
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
