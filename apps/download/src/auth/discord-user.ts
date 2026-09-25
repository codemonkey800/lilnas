import type { DiscordRequester } from '@lilnas/utils/download/types'
import type { IncomingHttpHeaders } from 'http'

// Set by `apps/tdr-bot` on the job-creation calls it makes through
// `DownloadClient.dockerInstance` — the Discord `/download` command already
// knows who invoked it, and these headers are how that identity reaches this
// service. They are the Discord-side sibling of the `X-Forwarded-User` pair
// handled in `./forwarded-user.ts`, but nothing external stamps them: Traefik
// neither strips nor re-adds them, because tdr-bot never goes through Traefik.
//
// The trust model is therefore the *same* one `forwarded-user.ts` already
// documents, just with a different reason to believe it: every NestJS route
// lives on port 8081, which has no Traefik router and is reachable only by
// other containers on the shared lilnas Docker network. The Docker network
// itself is the trust boundary, and tdr-bot is the only caller that sets
// these headers. A browser request arriving via Traefik on 8080 cannot forge
// them into something meaningful either — `DownloadController` gives the
// forwarded identity precedence and drops the Discord pair when both are
// present.
//
// Values are stored raw, exactly as sent. A Discord snowflake exceeds
// `Number.MAX_SAFE_INTEGER`, so `discordUserId` is always a string; usernames
// (post-2023) are 2-32 chars of `a-z0-9._` and are safe as raw header values.

// The shape itself lives in `@lilnas/utils/download/types` (it is shared with
// tdr-bot's sending side and with the job row's serialized form, not a
// download-internal detail) and is re-exported here so import sites can pull
// the extractor and its return type from one place — matching how
// `./forwarded-user.ts` re-exports `ForwardedUser`.
export type { DiscordRequester } from '@lilnas/utils/download/types'

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

// Widened to `{ headers: IncomingHttpHeaders }` for the same reason
// `getForwardedUser` is: this only ever touches `.headers`, so the WS
// handshake path (`DownloadGateway.handleConnection`, which receives a raw
// `http.IncomingMessage`) can pass its request through with no cast.
//
// Deliberately dumb about precedence — it reports only what the Discord
// headers say. Deciding what happens when a request somehow carries BOTH the
// forwarded pair and the Discord pair (forwarded wins, Discord pair dropped
// with a warn) belongs to the controller, not here.
export function getDiscordRequester(req: {
  headers: IncomingHttpHeaders
}): DiscordRequester | undefined {
  const discordUserId = firstHeaderValue(req.headers['x-discord-user-id'])
  const discordUsername = firstHeaderValue(req.headers['x-discord-username'])
  if (!discordUserId || !discordUsername) {
    return undefined
  }
  return { discordUserId, discordUsername }
}

// Kept OUT of `DiscordRequester` on purpose. `x-discord-display-name` carries
// Discord's `globalName`, which is nullable on Discord's own API, so the
// header is genuinely optional and a job can never depend on it. It is roster
// enrichment forwarded on to `apps/auth` (where it is only ever displayed in
// the admin link picker) and is never written to the job row.
//
// Unlike the username it is NOT constrained to a safe charset — treat the
// returned string as untrusted free text.
export function getDiscordDisplayName(req: {
  headers: IncomingHttpHeaders
}): string | undefined {
  return firstHeaderValue(req.headers['x-discord-display-name'])
}
