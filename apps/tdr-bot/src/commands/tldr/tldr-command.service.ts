import { Injectable, Logger } from '@nestjs/common'
import {
  ChannelType,
  GuildBasedChannel,
  MessageFlags,
  type User,
} from 'discord.js'
import { nanoid } from 'nanoid'
import {
  ChannelOption,
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
  UserOption,
} from 'necord'

import { runWithRequestContext } from 'src/llm/observability/request-context'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

import { parseSince } from './since'
import { TldrService } from './tldr.service'
import { formatWhen } from './transcript'
import { TldrError, TldrErrorCode, TldrWindow } from './types'
import { TldrWindowService } from './window.service'

const SADGE = '<:Sadge:781403152258826281>'

const SINCE_EXAMPLES = '`2h`, `30m`, `3d`, `8:30pm`, `yesterday`, `10/13`'

class TldrDto {
  @StringOption({
    name: 'since',
    description:
      'How far back: 2h, 30m, 3d, 8:30pm, yesterday, 10/13. Default: since your last message here',
    max_length: 40,
  })
  since!: string | null

  @UserOption({
    name: 'from',
    description: 'Only summarize what this person said',
  })
  from!: User | null

  @ChannelOption({
    name: 'channel',
    description: 'Another channel or thread to catch up on (default: this one)',
    channel_types: [
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ],
  })
  channel!: GuildBasedChannel | null

  @StringOption({
    name: 'question',
    description: 'Ask something about the conversation instead of a summary',
    max_length: 500,
  })
  question!: string | null
}

@Injectable()
export class TldrCommandService {
  private readonly logger = new Logger(TldrCommandService.name)
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly window: TldrWindowService,
    private readonly tldr: TldrService,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  @SlashCommand({
    name: 'tldr',
    description:
      'Catch up on a conversation: a summary of what you missed, in TDR voice',
  })
  async onTldr(
    @Context() [interaction]: SlashCommandContext,
    @Options() { since, from, channel, question }: TldrDto,
  ) {
    this.logger.log(
      {
        command: '/tldr',
        user: interaction.user.username,
        since,
        from: from?.username,
        channel: channel?.id,
        question,
      },
      'User used command',
    )
    this.metrics.commandExecuted('tldr')

    if (!interaction.inCachedGuild()) {
      await this.replyPrivately(interaction, 'that only works in a server')
      return
    }

    let sinceDate: Date | null = null
    if (since) {
      try {
        sinceDate = parseSince(since)
      } catch (error) {
        if (error instanceof TldrError && error.code === 'future_since') {
          await this.replyPrivately(interaction, "that's in the future")
          return
        }
        if (error instanceof TldrError && error.code === 'bad_since') {
          await this.replyPrivately(
            interaction,
            `couldn't read that time, try something like ${SINCE_EXAMPLES}`,
          )
          return
        }
        throw error
      }
    }

    const target = channel ?? interaction.channel
    if (!target) {
      await this.replyPrivately(interaction, errorText('unsupported_channel'))
      return
    }

    const userId = interaction.user.id
    if (this.inFlight.has(userId)) {
      await this.replyPrivately(interaction, errorText('busy'))
      return
    }
    this.inFlight.add(userId)

    const requestId = nanoid()
    let window: TldrWindow | undefined
    try {
      await interaction.deferReply()

      const chunks = await runWithRequestContext(
        {
          requestId,
          userId,
          channelId: target.id,
          guildId: interaction.guildId,
          skill: 'tldr',
        },
        async () => {
          window = await this.window.fetch({
            channel: target,
            requester: interaction.member,
            since: sinceDate,
          })

          return this.tldr.summarize({
            window,
            requester: {
              id: userId,
              name: interaction.member.displayName,
            },
            from: from && {
              id: from.id,
              name:
                interaction.guild.members.cache.get(from.id)?.displayName ??
                from.displayName,
            },
            question,
          })
        },
      )

      const [first = '', ...rest] = chunks
      await interaction.editReply(first)
      for (const chunk of rest) {
        await interaction.followUp(chunk)
      }
    } catch (error) {
      if (error instanceof TldrError) {
        const name = window?.channelName ?? target.name
        const when = window?.since ?? sinceDate
        await interaction.editReply(
          errorText(error.code, { name, when: when && formatWhen(when) }),
        )
        return
      }

      this.logger.error({ error, requestId }, 'Failed to build /tldr reply')
      await interaction.editReply(
        `sorry, couldn't put that together right now ${SADGE}`,
      )
    } finally {
      this.inFlight.delete(userId)
    }
  }

  private async replyPrivately(
    interaction: SlashCommandContext[0],
    content: string,
  ) {
    await interaction.reply({ content, flags: [MessageFlags.Ephemeral] })
  }
}

function errorText(
  code: TldrErrorCode,
  { name, when }: { name?: string; when?: string | null } = {},
): string {
  switch (code) {
    case 'no_access':
      return "you can't read that channel, so neither will I"
    case 'bot_no_access':
      return "I can't read that channel"
    case 'unsupported_channel':
      return 'I can only summarize server text channels and threads'
    case 'dm':
      return 'that only works in a server'
    case 'empty':
      return `nothing new in #${name ?? 'there'} since ${when ?? 'your last message'} ${SADGE}`
    case 'busy':
      return 'still working on your last /tldr'
    case 'bad_since':
    case 'future_since':
      return `couldn't read that time, try something like ${SINCE_EXAMPLES}`
  }
}
