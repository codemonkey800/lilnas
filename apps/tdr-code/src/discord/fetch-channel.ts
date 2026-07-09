import type { Channel, Client } from 'discord.js'

// Cache-then-fetch channel lookup shared by DiscordHandlerService and
// ContextUsageService. Swallows fetch errors (unknown/deleted channel,
// missing access) and resolves null rather than throwing — every caller in
// this codebase treats "channel unavailable" as a normal, silent no-op case.
//
// Typed to the real discord.js Channel union (not TextChannel) so callers
// that need isThread()/.parent narrowing (e.g. resolving a thread's parent
// channel) can do so directly, without the extra `as unknown as Channel`
// re-cast a TextChannel-typed result would otherwise force.
export async function fetchChannel(
  client: Client,
  channelId: string,
): Promise<Channel | null> {
  const cached = client.channels.cache.get(channelId)
  if (cached) return cached
  try {
    const fetched = await client.channels.fetch(channelId)
    return fetched
  } catch {
    return null
  }
}
