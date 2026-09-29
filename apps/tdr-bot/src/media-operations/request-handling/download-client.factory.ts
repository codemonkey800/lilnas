import { DownloadClient } from '@lilnas/utils/download/client'
import { Injectable } from '@nestjs/common'

import { downloadApiUrl } from 'src/utils/download-api-url'

import { DiscordIdentity } from './types/request-context.type'

/**
 * Hands strategies a `DownloadClient` that acts on behalf of one Discord user.
 *
 * The identity is per-message, so it cannot live on a shared client:
 * `forDiscord` stamps it onto a fresh client (via `withDiscordIdentity`) and
 * leaves the base one untouched, so concurrent requests from different users
 * never see each other's headers. The download app records the
 * `x-discord-*` headers as the request's `discordRequester`, which is what
 * attributes a bot request to its sender in the app's Activity.
 */
@Injectable()
export class DownloadClientFactory {
  private readonly client = new DownloadClient(downloadApiUrl())

  forDiscord(identity: DiscordIdentity): DownloadClient {
    return this.client.withDiscordIdentity({
      discordUserId: identity.userId,
      discordUsername: identity.username,
      displayName: identity.displayName,
    })
  }
}
