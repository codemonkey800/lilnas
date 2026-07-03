import { env } from '@lilnas/utils/env'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import type { DiscordGuildMemberDto } from './git-identity.dto'

const CACHE_TTL_MS = 5 * 60_000

// Shape of Discord's Guild Member object we actually read — see
// https://discord.com/developers/docs/resources/guild#guild-member-object.
// Only the fields this service touches are declared; the rest of the real
// payload (roles, joined_at, permissions, ...) is ignored.
interface DiscordApiGuildMember {
  user: {
    id: string
    username: string
    global_name: string | null
    bot?: boolean
  }
  nick: string | null
}

// Fetches the connected Discord server's member list for the git-identity
// form's "pick a user" dropdown. Deliberately separate from
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
  private cache: { fetchedAt: number; data: DiscordGuildMemberDto[] } | null =
    null

  // Bots are filtered out — a git identity is always for a human. `force`
  // bypasses and refreshes the cache (the console page's manual "Refresh"
  // button); a normal load prefers the cache within CACHE_TTL_MS to avoid
  // hitting Discord's rate limits, which are shared with the actual bot
  // process's own gateway/REST usage.
  async listGuildMembers(force = false): Promise<DiscordGuildMemberDto[]> {
    if (
      !force &&
      this.cache &&
      Date.now() - this.cache.fetchedAt < CACHE_TTL_MS
    ) {
      return this.cache.data
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
    } catch {
      throw new ServiceUnavailableException(
        'Could not reach Discord to list guild members',
      )
    }

    if (!response.ok) {
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

    this.cache = { fetchedAt: Date.now(), data }
    return data
  }
}
