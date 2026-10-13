import { env } from '@lilnas/utils/env'
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'

import { EnvKeys } from 'src/env'

import type { ItemImageQuery, PlaybackQuery } from './emby.schema'

// ---------------------------------------------------------------------------
// Emby client identity (ORCHESTRATE.md § "Backend endpoints" — DeviceId is a
// fixed backend-wide constant; the backend, not the browser, is the actual
// Emby client of record). Reused for every PlaybackInfo POST and every
// stop-transcode DELETE so Emby can always attribute/clean up sessions
// opened by this app.
// ---------------------------------------------------------------------------
const DEVICE_ID = 'lilnas-theater-backend'
const EMBY_AUTHORIZATION_HEADER =
  'MediaBrowser Client="theater", Device="lilnas-theater", DeviceId="lilnas-theater-backend", Version="1.0.0"'

// Browser-facing prefix for HLS sub-resources. Same-origin from the
// frontend's perspective (routed through the Next.js `/api/:path*` rewrite),
// so both the initial playback URL and every rewritten playlist child URI
// use this exact prefix — see `buildHlsProxyUrl`/`rewriteChildUri`.
const HLS_PROXY_PATH_PREFIX = '/api/theater/hls'

// `buildImageUrl` defaults — the values it used to hardcode, sized for the
// tablet's poster grid. Kept as the defaults so that call site's URL (and cache
// entry) is unchanged now that the method takes options.
const DEFAULT_IMAGE_TYPE = 'Primary'
const DEFAULT_IMAGE_MAX_WIDTH = 400

// ---------------------------------------------------------------------------
// DeviceProfile sent with every `PlaybackInfo` POST. Declares what this
// "client" (the backend, proxying to a plain <video>/hls.js in the browser)
// can play: direct-play mp4/webm, else transcode to fMP4-free MPEG-TS HLS.
// SubtitleProfiles asks Emby to expose text subs as external WebVTT instead
// of burning them in. Static — doesn't depend on any per-request param.
// ---------------------------------------------------------------------------
interface EmbyDirectPlayProfile {
  Container: string
  Type: 'Video' | 'Audio' | 'Photo'
  VideoCodec?: string
  AudioCodec?: string
}

interface EmbyTranscodingProfile {
  Container: string
  Type: 'Video' | 'Audio' | 'Photo'
  Protocol: string
  VideoCodec?: string
  AudioCodec?: string
}

interface EmbySubtitleProfile {
  Format: string
  Method: 'Encode' | 'Embed' | 'External' | 'Hls' | 'VideoSideData'
}

interface EmbyDeviceProfile {
  DirectPlayProfiles: EmbyDirectPlayProfile[]
  TranscodingProfiles: EmbyTranscodingProfile[]
  SubtitleProfiles: EmbySubtitleProfile[]
}

const DEVICE_PROFILE: EmbyDeviceProfile = {
  DirectPlayProfiles: [
    { Container: 'mp4', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac' },
    { Container: 'webm', Type: 'Video', VideoCodec: 'vp9', AudioCodec: 'opus' },
  ],
  TranscodingProfiles: [
    {
      Container: 'ts',
      Type: 'Video',
      Protocol: 'hls',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
    },
  ],
  SubtitleProfiles: [{ Format: 'vtt', Method: 'External' }],
}

interface EmbyPlaybackInfoRequestBody {
  // Required in practice — see the comment on `getPlaybackInfo` — but kept
  // optional here to match how every other field in this body mirrors
  // Emby's own (optional) request schema.
  UserId?: string
  DeviceProfile: EmbyDeviceProfile
  MaxStreamingBitrate?: number
  StartTimeTicks?: number
  AudioStreamIndex?: number
  SubtitleStreamIndex?: number
}

// ---------------------------------------------------------------------------
// Raw Emby JSON shapes — only the fields this service actually reads, not a
// full mirror of `emby-api.json`'s schemas.
// ---------------------------------------------------------------------------
interface EmbySystemInfoResponse {
  ServerName?: string
  Version?: string
}

interface EmbyImageTags {
  Primary?: string
}

interface EmbyBaseItem {
  Id: string
  Name: string
  Type?: string
  ProductionYear?: number | null
  Overview?: string | null
  RunTimeTicks?: number | null
  ImageTags?: EmbyImageTags
  IndexNumber?: number | null
}

interface EmbyItemsResponse {
  Items: EmbyBaseItem[]
}

// `/Shows/{Id}/Episodes`'s response schema is genuinely undocumented in
// emby-api.json ("Response content unknown") — every other Items-listing
// endpoint in this file returns `{ Items: [...] }`, and that's the
// well-established convention across the whole Emby/Jellyfin/MediaBrowser
// API family, but this one specific shape isn't spec-backed. Modeled as
// optional so callers are forced to fall back rather than assume.
interface EmbyQueryResultResponse {
  Items?: EmbyBaseItem[]
}

// Only the fields `resolveUserId` needs to match `EMBY_USERNAME` against —
// Emby's `/Users` response is a bare array of these, not `{ Items: [...] }`.
interface EmbyUser {
  Id: string
  Name: string
}

type EmbyMediaStreamType =
  | 'Unknown'
  | 'Audio'
  | 'Video'
  | 'Subtitle'
  | 'EmbeddedImage'
  | 'Attachment'
  | 'Data'

interface EmbyMediaStream {
  Index: number
  Type: EmbyMediaStreamType
  Language?: string
  DisplayTitle?: string
  IsTextSubtitleStream?: boolean
}

interface EmbyMediaSource {
  Id: string
  RunTimeTicks?: number | null
  DirectStreamUrl?: string
  TranscodingUrl?: string
  // The capability booleans — NOT the presence of DirectStreamUrl — are the
  // reliable signal for whether a source can be played as a single seekable
  // file. Emby sets DirectStreamUrl to an HLS `master.m3u8` (mirroring
  // TranscodingUrl) even when SupportsDirectStream is false; see the comment
  // in `getPlaybackInfo`.
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  TranscodingSubProtocol?: string
  MediaStreams?: EmbyMediaStream[]
}

interface EmbyPlaybackInfoResponse {
  MediaSources?: EmbyMediaSource[]
  PlaySessionId?: string
}

// ---------------------------------------------------------------------------
// DTOs returned to `EmbyController` — these (subtitle/audio track shapes,
// and the `mode`/`rawUrl`/`durationTicks`/`playSessionId` grouping) are what
// the controller shapes into the exact `/theater/playback/:id` response
// contract locked in by the already-shipped `src/playback/store.ts`.
// ---------------------------------------------------------------------------
export type TheaterItemType = 'movie' | 'series'

export interface TheaterItemDto {
  id: string
  name: string
  type: TheaterItemType
  year: number | null
  overview: string | null
  runTimeTicks: number | null
  imageTag: string | null
}

export interface TheaterSeasonDto {
  id: string
  name: string
  indexNumber: number | null
}

export interface TheaterEpisodeDto {
  id: string
  name: string
  indexNumber: number | null
  overview: string | null
  runTimeTicks: number | null
  imageTag: string | null
}

export interface SubtitleTrackDto {
  index: number
  lang: string
  label: string
  isText: boolean
  mediaSourceId: string
}

export interface AudioTrackDto {
  index: number
  lang: string
  label: string
}

export interface PlaybackInfoResult {
  mode: 'direct' | 'hls'
  // Emby's own DirectStreamUrl/TranscodingUrl, absolute or EMBY_URL-relative
  // — never sent to the client as-is; the controller turns it into a
  // same-origin `/api/theater/stream|hls/...` reference.
  rawUrl: string
  playSessionId: string | null
  durationTicks: number
  subtitles: SubtitleTrackDto[]
  audioTracks: AudioTrackDto[]
}

export interface EmbySystemInfoDto {
  serverName: string
  version: string
}

// An HLS transcode is a `master.m3u8` URL. Emby also (mis)populates
// `DirectStreamUrl` with that same `.m3u8` even when direct streaming isn't
// supported, so the URL's extension — not the field it arrived in — is the
// reliable "is this a playlist?" signal. The query string is stripped first
// because Emby's URLs always carry one (`master.m3u8?DeviceId=...`).
function isHlsPlaylistUrl(url: string): boolean {
  const queryStart = url.indexOf('?')
  const path = queryStart === -1 ? url : url.slice(0, queryStart)
  return path.toLowerCase().endsWith('.m3u8')
}

// Emby's raw capability flags for whether THIS DeviceProfile can play a given
// MediaSource without transcoding — shared by version selection (pick the
// direct-playable one among multiple) and mode decision (direct vs hls) below.
function hasDirectPlayCapability(source: EmbyMediaSource): boolean {
  return (
    (source.SupportsDirectStream ?? false) ||
    (source.SupportsDirectPlay ?? false)
  )
}

@Injectable()
export class EmbyService implements OnModuleInit {
  private readonly logger = new Logger(EmbyService.name)
  // Set by `resolveUserId` after its first successful `/Users` lookup. A
  // plain instance field (not a module-level variable) is the right shape
  // here — this is a NestJS singleton `@Injectable()`, so one field per
  // running app is exactly one cache entry, with none of the
  // browser-singleton concerns that motivate `store.ts`'s module-level state.
  private cachedUserId: string | null = null

  // Optional boot-time check only (PLAN.md B2) — never thrown out of here,
  // so a not-yet-configured EMBY_URL (e.g. the `change-me` placeholder)
  // logs a warning instead of blocking app startup.
  async onModuleInit(): Promise<void> {
    try {
      const info = await this.getSystemInfo()
      this.logger.log(
        `Connected to Emby server "${info.serverName}" (v${info.version})`,
      )
    } catch (error) {
      this.logger.warn(
        `Emby boot check failed — /theater/* routes will error until EMBY_URL/EMBY_API_KEY are valid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  async getSystemInfo(): Promise<EmbySystemInfoDto> {
    const data = await this.fetchJson<EmbySystemInfoResponse>(
      this.toAbsoluteEmbyUrl('/System/Info'),
      { headers: this.jsonHeaders() },
    )
    return {
      serverName: data.ServerName ?? 'unknown',
      version: data.Version ?? 'unknown',
    }
  }

  async listItems(): Promise<TheaterItemDto[]> {
    const url = this.toAbsoluteEmbyUrl('/Items')
    url.searchParams.set('Recursive', 'true')
    url.searchParams.set('IncludeItemTypes', 'Movie,Series')
    url.searchParams.set('Fields', 'Overview,ProductionYear,RunTimeTicks')
    url.searchParams.set('SortBy', 'SortName')

    const data = await this.fetchJson<EmbyItemsResponse>(url, {
      headers: this.jsonHeaders(),
    })

    return data.Items.map(item => ({
      id: item.Id,
      name: item.Name,
      type: item.Type === 'Series' ? 'series' : 'movie',
      year: item.ProductionYear ?? null,
      overview: item.Overview ?? null,
      runTimeTicks: item.RunTimeTicks ?? null,
      imageTag: item.ImageTags?.Primary ?? null,
    }))
  }

  // `/Shows/{Id}/Seasons` — despite `PlaybackInfo`'s hard lesson that this
  // server needs `UserId` even where Emby's own spec calls it optional (see
  // `getPlaybackInfo`'s comment), sending it proactively here is cheap
  // insurance against rediscovering the same failure mode live.
  async listSeasons(seriesId: string): Promise<TheaterSeasonDto[]> {
    const userId = await this.resolveUserId()
    const url = this.toAbsoluteEmbyUrl(
      `/Shows/${encodeURIComponent(seriesId)}/Seasons`,
    )
    url.searchParams.set('UserId', userId)
    url.searchParams.set('Fields', 'Overview')

    const data = await this.fetchJson<EmbyQueryResultResponse>(url, {
      headers: this.jsonHeaders(),
    })

    return (data.Items ?? []).map(item => ({
      id: item.Id,
      name: item.Name,
      indexNumber: item.IndexNumber ?? null,
    }))
  }

  // `/Shows/{Id}/Episodes` — response shape is genuinely undocumented in
  // emby-api.json ("Response content unknown"), so `data.Items ?? []` is
  // deliberate defensiveness, not boilerplate: an empty list degrades
  // gracefully in the iPad's episode picker, whereas asserting `.Items`
  // exists would hard-crash the request if this server's shape ever
  // deviates from the `{Items: [...]}` convention every other listing
  // endpoint in this file follows.
  async listEpisodes(
    seriesId: string,
    seasonId: string,
  ): Promise<TheaterEpisodeDto[]> {
    const userId = await this.resolveUserId()
    const url = this.toAbsoluteEmbyUrl(
      `/Shows/${encodeURIComponent(seriesId)}/Episodes`,
    )
    url.searchParams.set('SeasonId', seasonId)
    url.searchParams.set('UserId', userId)
    url.searchParams.set('Fields', 'Overview,RunTimeTicks')

    const data = await this.fetchJson<EmbyQueryResultResponse>(url, {
      headers: this.jsonHeaders(),
    })

    return (data.Items ?? []).map(item => ({
      id: item.Id,
      name: item.Name,
      indexNumber: item.IndexNumber ?? null,
      overview: item.Overview ?? null,
      runTimeTicks: item.RunTimeTicks ?? null,
      imageTag: item.ImageTags?.Primary ?? null,
    }))
  }

  // Despite Emby's own docs (and emby-api.json) marking `UserId` optional on
  // this POST, this server throws a server-side NullReferenceException
  // (500) whenever it's omitted — confirmed live against 3 different items,
  // all failing identically without `UserId` and all succeeding with a real
  // one added. `resolveUserId` maps `EMBY_USERNAME` to that id. The rest of
  // `params` stays optional — JSON.stringify drops any field left
  // `undefined` so we don't need to conditionally build the body.
  async getPlaybackInfo(
    id: string,
    params: PlaybackQuery,
  ): Promise<PlaybackInfoResult> {
    const userId = await this.resolveUserId()
    const url = this.toAbsoluteEmbyUrl(
      `/Items/${encodeURIComponent(id)}/PlaybackInfo`,
    )
    const body: EmbyPlaybackInfoRequestBody = {
      UserId: userId,
      DeviceProfile: DEVICE_PROFILE,
      MaxStreamingBitrate: params.maxBitrate,
      StartTimeTicks: params.startTicks,
      AudioStreamIndex: params.audioIndex,
      SubtitleStreamIndex: params.subtitleIndex,
    }

    const data = await this.fetchJson<EmbyPlaybackInfoResponse>(url, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    })

    const sources = data.MediaSources ?? []
    const firstSource = sources[0]
    if (!firstSource) {
      throw new NotFoundException(
        `Emby returned no playable media source for item ${id}`,
      )
    }

    // With multiple versions of a title (e.g. a 4K HEVC original alongside a
    // pre-made 1080p H.264/AAC MP4 — see docs/solutions on theater playback),
    // Emby returns one MediaSource per version and the array order isn't
    // contractual, so [0] isn't safe to assume. Prefer whichever version this
    // DeviceProfile can actually direct-play; single-version items fall
    // through to that one (already-validated) source unchanged.
    const mediaSource =
      sources.find(source => hasDirectPlayCapability(source)) ?? firstSource

    // Mode is decided by Emby's capability flags and the URL shape, NOT by
    // which URL field is populated. Emby mirrors an HLS `master.m3u8` onto BOTH
    // `DirectStreamUrl` and `TranscodingUrl` whenever a source must be
    // transcoded (e.g. an mkv container, or image-based PGS subtitles →
    // `TranscodeReasons=SubtitleCodecNotSupported`) while still reporting
    // `SupportsDirectStream: false`. Treating a populated `DirectStreamUrl` as
    // "direct" routed those HLS playlists through the direct-play Range proxy
    // (`/theater/stream/:id`), which forwards playlist bytes without rewriting
    // child URIs; the player then resolved the playlist's relative child
    // (`main.m3u8?...`) against that base and re-entered the route with
    // `id="main.m3u8"`, 500ing Emby's `/Items/{id}/PlaybackInfo`
    // ("Unrecognized Guid format").
    const directStreamUrl = mediaSource.DirectStreamUrl
    const canDirectStream =
      hasDirectPlayCapability(mediaSource) &&
      directStreamUrl != null &&
      // Belt-and-suspenders: an `.m3u8` URL is always a transcode playlist and
      // must go through the HLS proxy, even if Emby ever flags it direct.
      !isHlsPlaylistUrl(directStreamUrl)
    const mode: 'direct' | 'hls' = canDirectStream ? 'direct' : 'hls'

    const rawUrl = canDirectStream
      ? directStreamUrl
      : (mediaSource.TranscodingUrl ?? directStreamUrl)
    if (!rawUrl) {
      throw new BadGatewayException(
        `Emby returned neither a direct nor a transcoding URL for item ${id}`,
      )
    }

    const streams = mediaSource.MediaStreams ?? []
    const subtitles: SubtitleTrackDto[] = streams
      .filter(stream => stream.Type === 'Subtitle')
      .map(stream => ({
        index: stream.Index,
        lang: stream.Language ?? '',
        label:
          stream.DisplayTitle ?? stream.Language ?? `Subtitle ${stream.Index}`,
        isText: stream.IsTextSubtitleStream ?? false,
        mediaSourceId: mediaSource.Id,
      }))
    const audioTracks: AudioTrackDto[] = streams
      .filter(stream => stream.Type === 'Audio')
      .map(stream => ({
        index: stream.Index,
        lang: stream.Language ?? '',
        label:
          stream.DisplayTitle ?? stream.Language ?? `Audio ${stream.Index}`,
      }))

    return {
      mode,
      rawUrl,
      playSessionId: data.PlaySessionId ?? null,
      durationTicks: mediaSource.RunTimeTicks ?? 0,
      subtitles,
      audioTracks,
    }
  }

  // Resolves EMBY_USERNAME (the exact `Name` field `/Users` returns for the
  // account, not necessarily a display name) to that user's real Emby id,
  // caching the result on this singleton instance after the first success —
  // the mapping can't change without a restart, so there's no need to
  // re-resolve it on every `getPlaybackInfo` call.
  private async resolveUserId(): Promise<string> {
    if (this.cachedUserId) {
      return this.cachedUserId
    }

    const users = await this.fetchJson<EmbyUser[]>(
      this.toAbsoluteEmbyUrl('/Users'),
      { headers: this.jsonHeaders() },
    )
    const username = env(EnvKeys.EMBY_USERNAME)
    const match = users.find(user => user.Name === username)
    if (!match) {
      throw new BadGatewayException(
        `No Emby user found matching EMBY_USERNAME="${username}"`,
      )
    }

    this.cachedUserId = match.Id
    return this.cachedUserId
  }

  // Cleanup needs both PlaySessionId (from the PlaybackInfo response) and
  // the same DeviceId the client used when opening it — PLAN.md "Risks &
  // gotchas: Transcode leaks".
  async stopTranscode(playSessionId: string): Promise<void> {
    const url = this.toAbsoluteEmbyUrl('/Videos/ActiveEncodings')
    url.searchParams.set('PlaySessionId', playSessionId)
    url.searchParams.set('DeviceId', DEVICE_ID)

    await this.fetchOrThrow(url, {
      method: 'DELETE',
      headers: this.jsonHeaders(),
    })
  }

  // Ready-to-fetch, same-origin-authenticated URLs for the controller's
  // simple (non-Range) proxies.
  //
  // The defaults reproduce this method's original fixed behavior (Primary at
  // 400px, sized for the tablet's poster grid), so the grid keeps hitting the
  // same URL — and therefore the same browser cache entry — while the full-page
  // player can ask for a wide Backdrop hero. `type` is constrained upstream by
  // `ItemImageQuerySchema`'s enum, which is what makes interpolating it into the
  // path safe.
  //
  // Emby returns 404 for an image type an item doesn't have (backdrops are
  // frequently absent), and the controller's `forwardResponse` passes that
  // status straight through — that's the signal the client's artwork fallback
  // chain reads via `<img onError>`.
  buildImageUrl(itemId: string, options: ItemImageQuery = {}): string {
    const url = this.toAbsoluteEmbyUrl(
      `/Items/${encodeURIComponent(itemId)}/Images/${options.type ?? DEFAULT_IMAGE_TYPE}`,
    )
    url.searchParams.set(
      'maxWidth',
      String(options.maxWidth ?? DEFAULT_IMAGE_MAX_WIDTH),
    )
    return this.withApiKey(url).toString()
  }

  buildSubtitleUrl(
    itemId: string,
    mediaSourceId: string,
    index: number,
    startTicks?: number,
  ): string {
    const url = this.toAbsoluteEmbyUrl(
      `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${index}/Stream.vtt`,
    )
    if (startTicks !== undefined) {
      url.searchParams.set('StartPositionTicks', String(startTicks))
    }
    return this.withApiKey(url).toString()
  }

  // The browser-facing `/api/theater/hls/<token>` reference for a raw Emby
  // TranscodingUrl — used both for the initial `/theater/playback/:id`
  // response and (via `rewriteChildUri`) for every child URI inside a
  // proxied playlist.
  buildHlsProxyUrl(rawUrl: string): string {
    const url = this.toAbsoluteEmbyUrl(rawUrl)
    return `${HLS_PROXY_PATH_PREFIX}/${this.encodeHlsToken(`${url.pathname}${url.search}`)}`
  }

  resolveDirectStreamTarget(rawUrl: string): URL {
    return this.withApiKey(this.toAbsoluteEmbyUrl(rawUrl))
  }

  // Stateless HLS proxy target resolution (ORCHESTRATE.md § "Backend
  // endpoints" — `:encodedPath` is an opaque base64url pointer, not a
  // session id; no in-memory session map). Rejects tokens that don't decode
  // to a path under EMBY_URL's own origin, and — since `token` is an
  // untrusted, client-constructible base64url string — also rejects paths
  // outside Emby's `/Videos/...` HLS/segment tree so this proxy can't be
  // walked to arbitrary Emby API endpoints (e.g. `/Users`) with the app's
  // own EMBY_API_KEY attached.
  resolveHlsProxyTarget(token: string): URL {
    const decoded = this.decodeHlsToken(token)
    const url = this.toAbsoluteEmbyUrl(decoded)
    if (
      url.origin !== this.embyOrigin() ||
      !url.pathname.toLowerCase().startsWith('/videos/')
    ) {
      throw new BadRequestException('Invalid HLS proxy token')
    }
    return this.withApiKey(url)
  }

  // Rewrites every child URI in a fetched playlist (master → variant
  // playlists, variant → segments) to a new same-origin `/api/theater/hls/
  // <token>` reference, resolved against the playlist's own fetched URL so
  // relative segment paths resolve correctly.
  rewriteHlsPlaylist(text: string, fetchedUrl: URL): string {
    return text
      .split('\n')
      .map(line => this.rewritePlaylistLine(line, fetchedUrl))
      .join('\n')
  }

  private rewritePlaylistLine(line: string, baseUrl: URL): string {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      return line
    }
    if (trimmed.startsWith('#')) {
      if (!trimmed.includes('URI="')) {
        return line
      }
      // Covers #EXT-X-MEDIA / #EXT-X-KEY / #EXT-X-MAP style tags that carry
      // a child reference in a quoted attribute rather than as the whole
      // line — not expected from our single ts/h264/aac TranscodingProfile,
      // but cheap to handle correctly if Emby ever emits one.
      return line.replace(
        /URI="([^"]+)"/g,
        (_match, uri: string) => `URI="${this.rewriteChildUri(uri, baseUrl)}"`,
      )
    }
    return this.rewriteChildUri(trimmed, baseUrl)
  }

  private rewriteChildUri(uri: string, baseUrl: URL): string {
    const resolved = new URL(uri, baseUrl)
    return `${HLS_PROXY_PATH_PREFIX}/${this.encodeHlsToken(`${resolved.pathname}${resolved.search}`)}`
  }

  private encodeHlsToken(pathAndQuery: string): string {
    return Buffer.from(pathAndQuery, 'utf8').toString('base64url')
  }

  private decodeHlsToken(token: string): string {
    return Buffer.from(token, 'base64url').toString('utf8')
  }

  private embyOrigin(): string {
    return new URL(env(EnvKeys.EMBY_URL)).origin
  }

  // `pathOrUrl` may be an absolute Emby URL (as returned in
  // DirectStreamUrl/TranscodingUrl) or a path relative to EMBY_URL — either
  // way this resolves to a full, absolute URL against EMBY_URL.
  private toAbsoluteEmbyUrl(pathOrUrl: string): URL {
    return new URL(pathOrUrl, `${env(EnvKeys.EMBY_URL)}/`)
  }

  private withApiKey(url: URL): URL {
    url.searchParams.set('api_key', env(EnvKeys.EMBY_API_KEY))
    return url
  }

  private jsonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Emby-Token': env(EnvKeys.EMBY_API_KEY),
      'X-Emby-Authorization': EMBY_AUTHORIZATION_HEADER,
    }
  }

  private async fetchOrThrow(
    url: URL | string,
    init: RequestInit = {},
  ): Promise<Response> {
    let res: Response
    try {
      res = await fetch(url, init)
    } catch (error) {
      throw new BadGatewayException(
        `Failed to reach Emby: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    if (!res.ok) {
      // Read the real Emby error body — without this, diagnosing a
      // server-side failure meant bypassing our own backend and hitting
      // Emby directly to see its actual error text (e.g. the
      // NullReferenceException `resolveUserId` exists to avoid). Guard the
      // read itself so a body-read failure never masks the original error.
      const bodyText = await res.text().catch(() => '')
      const truncatedBody = bodyText.slice(0, 500)
      const suffix = truncatedBody ? ` — ${truncatedBody}` : ''
      throw new BadGatewayException(
        `Emby request to ${url.toString()} failed: ${res.status} ${res.statusText}${suffix}`,
      )
    }

    return res
  }

  private async fetchJson<T>(
    url: URL | string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await this.fetchOrThrow(url, init)
    return (await res.json()) as T
  }
}
