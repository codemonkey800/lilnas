import { env } from '@lilnas/utils/env'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'

import type { DiscordGuildMemberDto } from './git-identity.dto'

const CACHE_TTL_MS = 5 * 60_000

interface DiscordApiGuildMember {
  user: {
    id: string
    username: string
    global_name: string | null
    bot?: boolean
  }
  nick: string | null
}

// Minimal shape for GET /channels/{channelId} — only the name field is used.
interface DiscordApiChannel {
  id: string
  name?: string
}

// Fetches the connected Discord server's member list. Originally backed the
// git-identity form's "pick a user" dropdown (removed in U5 — R2 closes that
// gap for real); now consumed by git-roster.service.ts for the shared
// GitHub+SSH roster's per-member display names. Deliberately separate from
// GitIdentityService (DB-backed identity storage + SSH-key crypto) — this
// service does one thing, talks to Discord's REST API with the bot token,
// and never touches the DB.
@Injectable()
export class DiscordDirectoryService {
  // Instance field (not a module-level `let`) so each test constructing its
  // own `new DiscordDirectoryService()` starts with a clean cache — a
  // module-level variable would leak state across unrelated test cases
  // sharing the same imported module. In production Nest only ever creates
  // one instance (default singleton scope), so this still behaves as a
  // per-process cache.
  private membersCache: {
    fetchedAt: number
    data: DiscordGuildMemberDto[]
  } | null = null
  private channelNameCache = new Map<string, { fetchedAt: number; name: string | null }>()

  constructor(private readonly logger: PinoLogger) {}

  // Bots are filtered out — a git identity is always for a human. `force`
  // bypasses the cache for on-demand refreshes; a normal load prefers the
  // cache within CACHE_TTL_MS to avoid hitting Discord's rate limits, which
  // are shared with the actual bot process's own gateway/REST usage.
  async listGuildMembers(force = false): Promise<DiscordGuildMemberDto[]> {
    if (
      !force &&
      this.membersCache &&
      Date.now() - this.membersCache.fetchedAt < CACHE_TTL_MS
    ) {
      return this.membersCache.data
    }

    const token = env(EnvKeys.DISCORD_API_TOKEN)
    const guildId = env(EnvKeys.DISCORD_GUILD_ID)

    // limit=1000 is Discord's per-request cap for this endpoint. Not paging
    // past it via the `after` cursor — this is a small, personal Discord
    // server, and a guild over 1000 members is not a case worth building
    // for here.
    let response: Response
    try {
      response = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,
        {
          headers: { Authorization: `Bot ${token}` },
          // Bounded the same way guild-gate.ts bounds its own Discord call —
          // Node's global fetch has no default total-request timeout, only
          // per-phase ones, so an upstream stall would otherwise hang this
          // request far longer than an admin page load should ever wait.
          signal: AbortSignal.timeout(10_000),
        },
      )
    } catch (err) {
      this.logger.warn(
        { err, guildId, event: LOG_EVENTS.discordDirectoryFetchFailed },
        'Failed to reach Discord for guild member list',
      )
      throw new ServiceUnavailableException(
        'Could not reach Discord to list guild members',
      )
    }

    if (!response.ok) {
      this.logger.warn(
        {
          status: response.status,
          statusText: response.statusText,
          event: LOG_EVENTS.discordDirectoryApiError,
        },
        'Discord returned an error listing guild members',
      )
      throw new ServiceUnavailableException(
        'Discord returned an error listing guild members',
      )
    }

    const body = (await response.json()) as DiscordApiGuildMember[]
    const data = body
      .filter(member => !member.user.bot)
      .map(member => ({
        id: member.user.id,
        username: member.user.username,
        displayName:
          member.nick ?? member.user.global_name ?? member.user.username,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    this.membersCache = { fetchedAt: Date.now(), data }
    this.logger.debug(
      { memberCount: data.length, forced: force },
      'Guild member list refreshed',
    )
    return data
  }

  // Returns the channel's name, or null on any error/unknown channel.
  // Uses a per-channel TTL cache matching the member list's TTL.
  async getChannelName(channelId: string): Promise<string | null> {
    const cached = this.channelNameCache.get(channelId)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.name
    }

    const token = env(EnvKeys.DISCORD_API_TOKEN)
    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channelId}`,
        {
          headers: { Authorization: `Bot ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!response.ok) {
        this.channelNameCache.set(channelId, { fetchedAt: Date.now(), name: null })
        return null
      }
      const body = (await response.json()) as DiscordApiChannel
      const name = body.name ?? null
      this.channelNameCache.set(channelId, { fetchedAt: Date.now(), name })
      return name
    } catch {
      return null
    }
  }
}
