import { Injectable, Logger } from '@nestjs/common'
import {
  ChannelType,
  Client,
  GuildBasedChannel,
  GuildMember,
  Message,
  PermissionFlagsBits,
  SnowflakeUtil,
} from 'discord.js'

import {
  DISCORD_FETCH_PAGE,
  FALLBACK_MESSAGE_COUNT,
  MAX_THREADS,
  MAX_WINDOW_MESSAGES,
  SinceSource,
  TldrError,
  TldrWindow,
  WindowMessage,
} from './types'

type ParentChannel = Extract<
  GuildBasedChannel,
  { type: ChannelType.GuildText | ChannelType.GuildAnnouncement }
>
type ThreadTarget = Extract<
  GuildBasedChannel,
  {
    type:
      | ChannelType.PublicThread
      | ChannelType.PrivateThread
      | ChannelType.AnnouncementThread
  }
>
type Walkable = ParentChannel | ThreadTarget

interface Walk {
  /** Newest first. */
  messages: Message<true>[]
  /** The requester's newest message, when an anchor author was given. */
  anchor: Message<true> | null
  /** Stopped at the scan cap with older history possibly left. */
  capped: boolean
}

export interface TldrWindowParams {
  channel: GuildBasedChannel
  requester: GuildMember
  /** null: default rule (since the requester's last message, else fallback). */
  since: Date | null
}

@Injectable()
export class TldrWindowService {
  private readonly logger = new Logger(TldrWindowService.name)

  constructor(private readonly client: Client) {}

  async fetch({
    channel,
    requester,
    since,
  }: TldrWindowParams): Promise<TldrWindow> {
    const isParent =
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement
    const isThread =
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.AnnouncementThread
    if (!isParent && !isThread) throw new TldrError('unsupported_channel')

    const target = channel as Walkable
    this.assertAccess(target, requester, 'no_access')
    this.assertAccess(target, target.guild.members.me, 'bot_no_access')
    if (
      target.type === ChannelType.PrivateThread &&
      !(await this.canViewPrivateThread(target, requester))
    ) {
      throw new TldrError('no_access')
    }

    const walk = await this.walk(target, since, since ? null : requester.id)
    let kept = walk.messages.filter(m => this.isKept(m))
    let effectiveSince: Date
    let sinceSource: SinceSource
    let clipped = false

    if (since) {
      effectiveSince = since
      sinceSource = 'option'
      clipped = walk.capped
    } else if (walk.anchor) {
      effectiveSince = walk.anchor.createdAt
      sinceSource = 'lastMessage'
    } else {
      kept = kept.slice(0, FALLBACK_MESSAGE_COUNT)
      effectiveSince = kept.at(-1)?.createdAt ?? new Date()
      sinceSource = 'fallback'
    }

    const messages = kept.map(m => this.toWindowMessage(m, null))
    let threadCount = 0

    if (isParent) {
      const threads = await this.selectThreads(
        target as ParentChannel,
        requester,
        effectiveSince,
      )
      for (const thread of threads) {
        const threadMessages = await this.fetchThreadMessages(
          thread,
          effectiveSince,
        )
        if (threadMessages.length === 0) continue
        threadCount++
        messages.push(...threadMessages)
      }
    }

    messages.sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )

    if (messages.length > MAX_WINDOW_MESSAGES) {
      messages.splice(0, messages.length - MAX_WINDOW_MESSAGES)
      clipped = true
    }
    if (clipped && messages.length > 0) {
      effectiveSince = messages[0].createdAt
    }

    return {
      guildId: target.guild.id,
      channelId: target.id,
      channelName: target.name,
      since: effectiveSince,
      sinceSource,
      messages,
      threadCount,
      clipped,
    }
  }

  private assertAccess(
    channel: Walkable,
    member: GuildMember | null,
    code: 'no_access' | 'bot_no_access',
  ): void {
    const permissions = member ? channel.permissionsFor(member) : null
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      throw new TldrError(code)
    }
  }

  /**
   * `permissionsFor` on a thread reflects the parent only; a private thread
   * is also limited to its members and anyone who can manage threads.
   */
  private async canViewPrivateThread(
    thread: ThreadTarget,
    requester: GuildMember,
  ): Promise<boolean> {
    if (
      thread.permissionsFor(requester)?.has(PermissionFlagsBits.ManageThreads)
    ) {
      return true
    }
    try {
      await thread.members.fetch(requester.id)
      return true
    } catch {
      return false
    }
  }

  private async selectThreads(
    channel: ParentChannel,
    requester: GuildMember,
    since: Date,
  ): Promise<ThreadTarget[]> {
    const found = new Map<string, ThreadTarget>()
    try {
      const [active, archived] = await Promise.all([
        channel.threads.fetchActive(),
        channel.threads.fetchArchived({ type: 'public' }),
      ])
      for (const thread of [
        ...active.threads.values(),
        ...archived.threads.values(),
      ]) {
        found.set(thread.id, thread as ThreadTarget)
      }
    } catch (error) {
      this.logger.warn(
        {
          channelId: channel.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'tldr.threads.fetch_failed',
      )
      return []
    }

    const recent = [...found.values()]
      .map(thread => ({ thread, activity: this.threadActivity(thread) }))
      .filter(({ activity }) => activity >= since.getTime())
      .sort((a, b) => b.activity - a.activity)

    const selected: ThreadTarget[] = []
    for (const { thread } of recent) {
      if (selected.length >= MAX_THREADS) break
      if (
        !thread.permissionsFor(requester)?.has(PermissionFlagsBits.ViewChannel)
      ) {
        continue
      }
      if (
        thread.type === ChannelType.PrivateThread &&
        !(await this.canViewPrivateThread(thread, requester))
      ) {
        continue
      }
      selected.push(thread)
    }
    return selected
  }

  private threadActivity(thread: ThreadTarget): number {
    if (thread.lastMessageId) {
      return SnowflakeUtil.timestampFrom(thread.lastMessageId)
    }
    return thread.archiveTimestamp ?? thread.createdTimestamp ?? 0
  }

  private async fetchThreadMessages(
    thread: ThreadTarget,
    since: Date,
  ): Promise<WindowMessage[]> {
    try {
      const walk = await this.walk(thread, since, null)
      return walk.messages
        .filter(m => this.isKept(m))
        .map(m => this.toWindowMessage(m, thread.name))
    } catch (error) {
      this.logger.warn(
        {
          threadId: thread.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'tldr.thread.fetch_failed',
      )
      return []
    }
  }

  /**
   * Pages backwards from the newest message. Stops at `since`, at the
   * requester's newest message when `anchorAuthorId` is given (that message
   * and anything older are left out), on a short page, or at the scan cap.
   */
  private async walk(
    channel: Walkable,
    since: Date | null,
    anchorAuthorId: string | null,
  ): Promise<Walk> {
    const messages: Message<true>[] = []
    let anchor: Message<true> | null = null
    let before: string | undefined
    let scanned = 0
    let capped = false

    for (;;) {
      const fetched = await channel.messages.fetch({
        limit: DISCORD_FETCH_PAGE,
        before,
      })
      const page = [...fetched.values()].sort(
        (a, b) => b.createdTimestamp - a.createdTimestamp,
      )
      if (page.length === 0) break
      scanned += page.length

      let reachedStart = false
      for (const message of page) {
        if (since && message.createdTimestamp < since.getTime()) {
          reachedStart = true
          break
        }
        if (
          anchorAuthorId &&
          !message.system &&
          message.author.id === anchorAuthorId
        ) {
          anchor = message
          break
        }
        messages.push(message)
      }

      if (anchor || reachedStart || page.length < DISCORD_FETCH_PAGE) break
      if (scanned >= MAX_WINDOW_MESSAGES) {
        capped = true
        break
      }
      before = page[page.length - 1].id
    }

    return { messages, anchor, capped }
  }

  private isKept(message: Message<true>): boolean {
    if (message.system) return false
    if (
      message.author.id === this.client.user?.id &&
      message.interactionMetadata
    ) {
      return false
    }
    return (
      message.cleanContent.length > 0 ||
      message.attachments.size > 0 ||
      message.embeds.length > 0
    )
  }

  private toWindowMessage(
    message: Message<true>,
    threadName: string | null,
  ): WindowMessage {
    return {
      id: message.id,
      channelId: message.channelId,
      threadName,
      authorId: message.author.id,
      authorName: message.member?.displayName ?? message.author.displayName,
      isBot: message.author.bot,
      createdAt: message.createdAt,
      content: message.cleanContent,
      attachments: [...message.attachments.values()].map(a => a.name),
      embedTitles: message.embeds
        .map(e => e.title ?? e.url)
        .filter((t): t is string => Boolean(t)),
      replyToId: message.reference?.messageId ?? null,
      url: message.url,
    }
  }
}
