import { Readable } from 'node:stream'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { Response as ExpressResponse } from 'express'

import { SessionGuard } from 'src/auth/session.guard'

import { EpisodesQuerySchema, PlaybackQuerySchema } from './emby.schema'
import {
  type AudioTrackDto,
  EmbyService,
  type SubtitleTrackDto,
  type TheaterEpisodeDto,
  type TheaterItemDto,
  type TheaterSeasonDto,
} from './emby.service'

// Shape of `GET /theater/playback/:id` — LOCKED IN by the already-shipped
// `src/playback/store.ts` (ORCHESTRATE.md § "Backend endpoints"). `url` is
// already same-origin (`/api/theater/...`) so the store can use it as-is.
interface PlaybackInfoResponseDto {
  mode: 'direct' | 'hls'
  url: string
  playSessionId: string | null
  durationTicks: number
  subtitles: SubtitleTrackDto[]
  audioTracks: AudioTrackDto[]
}

// `?startTicks=` on the subtitle route is a cosmetic resume-position hint
// (worst case with a garbage value: captions start from 0) — lenient
// parsing, no throw, unlike the required `:index` path param below.
function parseOptionalTicks(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

// `fetch`'s `Response.body` types against lib.dom's `ReadableStream`, which
// (as of the TS lib shipped here) doesn't declare the async-iterable
// members `Readable.fromWeb` expects from `node:stream/web`'s own
// `ReadableStream` — even though they're the same object at runtime. A
// narrow, explicit cast (not `any`) bridges the two type declarations.
function toNodeReadable(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>)
}

@Controller('theater')
@UseGuards(SessionGuard)
export class EmbyController {
  constructor(private readonly embyService: EmbyService) {}

  @Get('items')
  listItems(): Promise<TheaterItemDto[]> {
    return this.embyService.listItems()
  }

  // Poster proxy for the iPad grid — simple non-Range proxy, images aren't
  // seekable.
  @Get('items/:id/image')
  async getItemImage(
    @Param('id') id: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const ac = new AbortController()
    res.on('close', () => ac.abort())

    const upstream = await fetch(this.embyService.buildImageUrl(id), {
      signal: ac.signal,
    })
    this.forwardResponse(upstream, res, ['content-type', 'content-length'])
  }

  @Get('items/:id/seasons')
  listSeasons(@Param('id') id: string): Promise<TheaterSeasonDto[]> {
    return this.embyService.listSeasons(id)
  }

  @Get('items/:id/episodes')
  listEpisodes(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<TheaterEpisodeDto[]> {
    const parsed = EpisodesQuerySchema.safeParse(query)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map(issue => issue.message),
      )
    }

    return this.embyService.listEpisodes(id, parsed.data.seasonId)
  }

  @Get('playback/:id')
  async getPlaybackInfo(
    @Param('id') id: string,
    @Query() query: unknown,
  ): Promise<PlaybackInfoResponseDto> {
    const parsed = PlaybackQuerySchema.safeParse(query)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map(issue => issue.message),
      )
    }

    const result = await this.embyService.getPlaybackInfo(id, parsed.data)
    const url =
      result.mode === 'direct'
        ? `/api/theater/stream/${encodeURIComponent(id)}`
        : this.embyService.buildHlsProxyUrl(result.rawUrl)

    return {
      mode: result.mode,
      url,
      playSessionId: result.playSessionId,
      durationTicks: result.durationTicks,
      subtitles: result.subtitles,
      audioTracks: result.audioTracks,
    }
  }

  // Range-forwarding direct-play proxy (PLAN.md § "Direct-play proxy").
  // Re-resolves PlaybackInfo (no params — direct-play eligibility doesn't
  // depend on bitrate/start caps) on every call since every seek reopens
  // this route with a fresh Range header; stateless by design, same as the
  // HLS proxy below.
  @Get('stream/:id')
  async streamDirect(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const result = await this.embyService.getPlaybackInfo(id, {})
    if (result.mode !== 'direct') {
      throw new BadGatewayException(
        `Item ${id} is no longer eligible for direct play`,
      )
    }

    const target = this.embyService.resolveDirectStreamTarget(result.rawUrl)

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    const upstream = await fetch(target, {
      headers: range ? { Range: range } : {},
      signal: ac.signal,
    })
    this.forwardResponse(upstream, res, [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
    ])
  }

  // Stateless HLS proxy (ORCHESTRATE.md § "Backend endpoints"). Decodes the
  // opaque token back to an Emby path+query, fetches it, and either
  // rewrites-and-returns playlist text or pipes segment bytes straight
  // through — no in-memory session map, so this same handler transparently
  // serves the master playlist, every variant playlist, and every segment.
  @Get('hls/:encodedPath')
  async proxyHls(
    @Param('encodedPath') encodedPath: string,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const target = this.embyService.resolveHlsProxyTarget(encodedPath)

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    const upstream = await fetch(target, { signal: ac.signal })
    const contentType = upstream.headers.get('content-type') ?? ''
    const isPlaylist =
      contentType.includes('mpegurl') ||
      contentType.includes('m3u8') ||
      target.pathname.endsWith('.m3u8')

    if (isPlaylist) {
      const text = await upstream.text()
      const rewritten = this.embyService.rewriteHlsPlaylist(text, target)
      res.status(upstream.status)
      res.setHeader(
        'content-type',
        contentType || 'application/vnd.apple.mpegurl',
      )
      res.send(rewritten)
      return
    }

    this.forwardResponse(upstream, res, ['content-type', 'content-length'])
  }

  // WebVTT proxy. Route gotcha (ORCHESTRATE.md): `:index` has NO literal
  // `.vtt` suffix in the pattern — dotted-suffix param syntax is
  // version-fragile across path-to-regexp releases, and dots aren't path
  // separators, so a request for `.../3.vtt` still matches `:index` as the
  // whole string `"3.vtt"`; `parseInt` stops at the first non-digit and
  // yields `3` with no manual stripping needed.
  @Get('subtitles/:id/:mediaSourceId/:index')
  async getSubtitle(
    @Param('id') id: string,
    @Param('mediaSourceId') mediaSourceId: string,
    @Param('index') index: string,
    @Query('startTicks') startTicks: string | undefined,
    @Res() res: ExpressResponse,
  ): Promise<void> {
    const parsedIndex = parseInt(index, 10)
    if (Number.isNaN(parsedIndex)) {
      throw new BadRequestException('Invalid subtitle index')
    }

    const target = this.embyService.buildSubtitleUrl(
      id,
      mediaSourceId,
      parsedIndex,
      parseOptionalTicks(startTicks),
    )

    const ac = new AbortController()
    res.on('close', () => ac.abort())

    const upstream = await fetch(target, { signal: ac.signal })
    res.status(upstream.status)
    res.setHeader('content-type', 'text/vtt')

    if (!upstream.body) {
      res.end()
      return
    }
    const body = toNodeReadable(upstream.body)
    body.on('error', () => res.destroy())
    body.pipe(res)
  }

  @Delete('playback/:playSessionId')
  async stopPlayback(
    @Param('playSessionId') playSessionId: string,
  ): Promise<{ ok: true }> {
    await this.embyService.stopTranscode(playSessionId)
    return { ok: true }
  }

  // Shared status/header/body forwarding for the simple (non-rewriting)
  // proxies. Never buffers; aborting mid-stream (res.close, e.g. a seek
  // abandoning this request) errors the piped-from Readable, so it always
  // gets an `error` listener before piping or Node would otherwise throw an
  // unhandled error on an already-closed response.
  private forwardResponse(
    upstream: Response,
    res: ExpressResponse,
    headerNames: string[],
  ): void {
    res.status(upstream.status)
    for (const name of headerNames) {
      const value = upstream.headers.get(name)
      if (value) {
        res.setHeader(name, value)
      }
    }

    if (!upstream.body) {
      res.end()
      return
    }
    const body = toNodeReadable(upstream.body)
    body.on('error', () => res.destroy())
    body.pipe(res)
  }
}
