/** Thread id the graph-test stdin loop runs under. */
export const GRAPH_TEST_THREAD_ID = 'graph-test'

/**
 * Checkpoint thread for a Discord conversation: one per channel, so every
 * message in a channel shares history and DMs get their own channel id.
 * `guildId` is accepted for call-site clarity but never part of the key.
 */
export function threadIdFor({
  channelId,
}: {
  channelId: string
  guildId?: string
}): string {
  return channelId
}
