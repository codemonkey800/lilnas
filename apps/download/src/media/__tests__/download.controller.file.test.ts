// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> MediaDownloadService) must mock it first (see
// download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import 'reflect-metadata'

import { DownloadType } from '@lilnas/utils/download/types'
import {
  type ArgumentMetadata,
  BadRequestException,
  Logger,
  NotFoundException,
  type PipeTransform,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { Test, TestingModule } from '@nestjs/testing'
import type { Response } from 'express'
import type { Readable } from 'stream'

import { AdminCheckService } from 'src/auth/admin-check.service'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import {
  MediaFileService,
  type MediaFileSource,
} from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

/**
 * The response stand-in. `@Res()` hands the route the raw express response,
 * so the only way to observe what the route did is to record the calls it
 * made - there is no return value to assert on, by design.
 */
function createFakeResponse() {
  const res = {
    destroy: jest.fn(),
    end: jest.fn(),
    headersSent: false,
    json: jest.fn(),
    once: jest.fn(),
    sendFile: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn(),
  }

  // `res.status(...).json(...)` is the chained form the route writes its
  // pre-header error bodies with.
  res.status.mockReturnValue(res)

  return res
}

type FakeResponse = ReturnType<typeof createFakeResponse>

/**
 * The MinIO object stream, faked rather than a real `Readable`: the route's
 * contract with it is `on('error')` / `pipe()` / `destroy()`, and jest fns
 * make each of those three directly assertable.
 */
function createFakeStream() {
  return { destroy: jest.fn(), on: jest.fn(), pipe: jest.fn() }
}

type FakeStream = ReturnType<typeof createFakeStream>

function asResponse(res: FakeResponse): Response {
  return res as unknown as Response
}

function asStream(stream: FakeStream): Readable {
  return stream as unknown as Readable
}

/** The `err => ...` callback the route handed to `res.sendFile`. */
function sendFileCallback(res: FakeResponse) {
  const callback = res.sendFile.mock.calls[0]?.[1]

  if (typeof callback !== 'function') {
    throw new Error('res.sendFile was called without a callback')
  }

  return callback as (err?: NodeJS.ErrnoException) => void
}

function listener(
  target: FakeResponse | FakeStream,
  event: string,
): (arg?: unknown) => void {
  const on = 'once' in target ? target.once : target.on
  const call = on.mock.calls.find(([name]: [string]) => name === event)

  if (!call) {
    throw new Error(`no '${event}' listener was registered`)
  }

  return call[1]
}

/**
 * The very pipe instance `@Query(new ZodValidationPipe(GetMediaFileQueryDto))`
 * put on the route, recovered from Nest's own param metadata.
 *
 * Re-deriving a pipe from `GetMediaFileQuerySchema` here would prove the
 * schema works while leaving the decorator wiring untested - and the wiring
 * is the half that can silently be wrong (a missing pipe validates nothing
 * and fails no assertion).
 */
function getMediaFileQueryPipe(): PipeTransform {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    DownloadController,
    'getMediaFile',
  ) as Record<string, { pipes?: PipeTransform[] }> | undefined

  const pipe = Object.values(metadata ?? {}).flatMap(
    entry => entry.pipes ?? [],
  )[0]

  if (!pipe) {
    throw new Error('getMediaFile has no validation pipe on any parameter')
  }

  return pipe
}

const QUERY_METADATA: ArgumentMetadata = { type: 'query' }

describe('DownloadController - GET /media/:id/file', () => {
  let controller: DownloadController
  let mediaFileService: jest.Mocked<MediaFileService>
  let metrics: jest.Mocked<DownloadMetricsService>
  let res: FakeResponse

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: { checkIsAdmin: jest.fn() } },
        { provide: DiscoveryService, useValue: {} },
        {
          provide: DownloadMetricsService,
          useValue: { fileSaved: jest.fn() },
        },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: JobQueryService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        {
          provide: MediaFileService,
          useValue: {
            getObjectStream: jest.fn(),
            resolveFileSource: jest.fn(),
          },
        },
        { provide: MediaResolverService, useValue: { resolve: jest.fn() } },
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    mediaFileService = module.get(MediaFileService)
    metrics = module.get(DownloadMetricsService)
    res = createFakeResponse()

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  const movieSource: MediaFileSource = {
    fileName: 'A Movie (2020).mkv',
    kind: 'disk',
    path: '/movies/A Movie (2020)/A Movie (2020).mkv',
  }

  const episodeSource: MediaFileSource = {
    fileName: 'A Show - S01E02.mkv',
    kind: 'disk',
    path: '/tv/A Show/Season 01/A Show - S01E02.mkv',
  }

  const videoSource: MediaFileSource = {
    bucket: 'videos',
    contentType: 'video/mp4',
    fileName: 'A video.mp4',
    key: 'job-1/part0.mp4',
    kind: 'object',
    size: 4096,
  }

  describe('a disk-backed source', () => {
    it('hands the resolved path to sendFile as an attachment', async () => {
      mediaFileService.resolveFileSource.mockResolvedValue(movieSource)

      await controller.getMediaFile('tmdb:1', {}, asResponse(res))

      expect(mediaFileService.resolveFileSource).toHaveBeenCalledWith(
        'tmdb:1',
        {},
      )
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="A Movie (2020).mkv"',
      )
      // The whole reason this branch is `sendFile` and not a hand-rolled
      // read stream: express supplies Range/206, Accept-Ranges, ETag and the
      // extension-derived Content-Type, none of which are set here.
      expect(res.sendFile).toHaveBeenCalledWith(
        movieSource.path,
        expect.any(Function),
      )
      expect(res.setHeader).not.toHaveBeenCalledWith(
        'Content-Length',
        expect.anything(),
      )
    })

    it('threads an episode scope through to the service', async () => {
      mediaFileService.resolveFileSource.mockResolvedValue(episodeSource)

      await controller.getMediaFile(
        'tvdb:9',
        { episodeId: 4412 },
        asResponse(res),
      )

      expect(mediaFileService.resolveFileSource).toHaveBeenCalledWith(
        'tvdb:9',
        {
          episodeId: 4412,
        },
      )
      expect(res.sendFile).toHaveBeenCalledWith(
        episodeSource.path,
        expect.any(Function),
      )
    })

    // The reason the header is built by `content-disposition` rather than
    // string-concatenated: a title outside Latin-1 needs the RFC 5987 form
    // *and* an ASCII fallback, or the browser saves it under a mangled name.
    // (A Latin-1 title like `Amélie` is deliberately left inline by the
    // library - the header charset already covers it.)
    it('RFC 5987-encodes a file name outside Latin-1', async () => {
      mediaFileService.resolveFileSource.mockResolvedValue({
        fileName: '君の名は (2016).mkv',
        kind: 'disk',
        path: '/movies/Kimi no Na wa/君の名は (2016).mkv',
      })

      await controller.getMediaFile('tmdb:2', {}, asResponse(res))

      const [, value] = res.setHeader.mock.calls[0] as [string, string]
      expect(value).toContain("filename*=UTF-8''")
      expect(value).toContain('%E5%90%9B')
    })
  })

  describe('an object-backed source', () => {
    let stream: FakeStream

    beforeEach(() => {
      stream = createFakeStream()
      mediaFileService.resolveFileSource.mockResolvedValue(videoSource)
      mediaFileService.getObjectStream.mockResolvedValue(asStream(stream))
    })

    it('sets the stat-derived headers and pipes the object into the response', async () => {
      await controller.getMediaFile('video:v1', {}, asResponse(res))

      expect(mediaFileService.getObjectStream).toHaveBeenCalledWith(videoSource)
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="A video.mp4"',
      )
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4')
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '4096')
      expect(stream.pipe).toHaveBeenCalledWith(res)
      expect(res.sendFile).not.toHaveBeenCalled()
    })

    it('passes the part scope through to the service', async () => {
      await controller.getMediaFile('video:v1', { part: 2 }, asResponse(res))

      expect(mediaFileService.resolveFileSource).toHaveBeenCalledWith(
        'video:v1',
        { part: 2 },
      )
    })

    // The route opens the object *before* touching a header on purpose. A
    // Content-Length already parked on the response would leave Nest's
    // exception filter writing a short JSON error under a header promising
    // 4KB - which a client waits out rather than reports.
    it('sets no header at all when the object cannot be opened', async () => {
      mediaFileService.getObjectStream.mockRejectedValue(
        new Error('minio unreachable'),
      )

      await expect(
        controller.getMediaFile('video:v1', {}, asResponse(res)),
      ).rejects.toThrow('minio unreachable')

      expect(res.setHeader).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    // `pipe()` tears down neither end on the other's close, so without this
    // a client that abandons the save leaks the MinIO socket.
    it('destroys the object stream when the client closes the response', async () => {
      await controller.getMediaFile('video:v1', {}, asResponse(res))

      listener(res, 'close')()

      expect(stream.destroy).toHaveBeenCalled()
    })
  })

  // MediaFileService already raises the right exception for every case it
  // can fail on, so the route adds no mapping layer - unlike mediaJobRoute(),
  // which would report all three of these as a flat 404.
  describe('service failures', () => {
    it.each([
      ['an unknown media id (404)', new NotFoundException('nope')],
      ['a wrong scope param (400)', new BadRequestException('pass episodeId')],
      ['a degraded library (503)', new ServiceUnavailableException('down')],
    ])('lets %s escape the handler untouched', async (_label, exception) => {
      mediaFileService.resolveFileSource.mockRejectedValue(exception)

      await expect(
        controller.getMediaFile('tvdb:9', {}, asResponse(res)),
      ).rejects.toBe(exception)

      // Nothing written, which is what leaves Nest's exception filter free
      // to answer despite the @Res().
      expect(res.setHeader).not.toHaveBeenCalled()
      expect(res.sendFile).not.toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('never counts a save that failed to resolve', async () => {
      mediaFileService.resolveFileSource.mockRejectedValue(
        new NotFoundException('nope'),
      )

      await expect(
        controller.getMediaFile('tmdb:1', {}, asResponse(res)),
      ).rejects.toThrow(NotFoundException)

      expect(metrics.fileSaved).not.toHaveBeenCalled()
    })
  })

  describe('a transfer that fails after it has been handed off', () => {
    beforeEach(() => {
      mediaFileService.resolveFileSource.mockResolvedValue(movieSource)
    })

    it.each([['ENOENT'], ['EACCES']])(
      'answers %s with a 404 in the Nest error shape while the headers are unsent',
      async code => {
        await controller.getMediaFile('tmdb:1', {}, asResponse(res))

        sendFileCallback(res)(Object.assign(new Error('open failed'), { code }))

        expect(res.status).toHaveBeenCalledWith(404)
        expect(res.json).toHaveBeenCalledWith({
          error: 'Not Found',
          message: "Media 'tmdb:1' has no file to save",
          statusCode: 404,
        })
        expect(res.end).not.toHaveBeenCalled()
      },
    )

    it('answers any other pre-header failure with a 500', async () => {
      await controller.getMediaFile('tmdb:1', {}, asResponse(res))

      sendFileCallback(res)(Object.assign(new Error('boom'), { code: 'EIO' }))

      expect(res.status).toHaveBeenCalledWith(500)
    })

    // Past the point of no return - the status line is already on the wire,
    // so there is no code left to change and ending the (short) body is the
    // only honest signal.
    it('just ends the response when the headers are already sent', async () => {
      await controller.getMediaFile('tmdb:1', {}, asResponse(res))
      res.headersSent = true

      sendFileCallback(res)(
        Object.assign(new Error('open failed'), { code: 'ENOENT' }),
      )

      expect(res.end).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
      expect(res.json).not.toHaveBeenCalled()
    })

    // The object branch destroys instead: its source stream is still piped
    // into a live response, and only a destroy stops a half-written body
    // from being mistaken for a complete one.
    it('destroys the response when a piped object stream dies mid-flight', async () => {
      const stream = createFakeStream()
      mediaFileService.resolveFileSource.mockResolvedValue(videoSource)
      mediaFileService.getObjectStream.mockResolvedValue(asStream(stream))

      await controller.getMediaFile('video:v1', {}, asResponse(res))
      res.headersSent = true

      listener(stream, 'error')(new Error('connection reset'))

      expect(res.destroy).toHaveBeenCalled()
      expect(res.end).not.toHaveBeenCalled()
    })

    it('404s a piped object stream that dies before any byte is written', async () => {
      const stream = createFakeStream()
      mediaFileService.resolveFileSource.mockResolvedValue(videoSource)
      mediaFileService.getObjectStream.mockResolvedValue(asStream(stream))

      await controller.getMediaFile('video:v1', {}, asResponse(res))

      listener(
        stream,
        'error',
      )(Object.assign(new Error('gone'), { code: 'ENOENT' }))

      expect(res.status).toHaveBeenCalledWith(404)
    })
  })

  describe('metrics', () => {
    it.each([
      ['a movie', 'tmdb:1', movieSource, DownloadType.Movie],
      ['an episode', 'tvdb:9', episodeSource, DownloadType.Show],
      ['a video', 'video:v1', videoSource, DownloadType.Video],
    ])(
      'counts %s save under its own type label',
      async (_l, id, source, type) => {
        mediaFileService.resolveFileSource.mockResolvedValue(source)
        mediaFileService.getObjectStream.mockResolvedValue(
          asStream(createFakeStream()),
        )

        await controller.getMediaFile(id, {}, asResponse(res))

        expect(metrics.fileSaved).toHaveBeenCalledTimes(1)
        expect(metrics.fileSaved).toHaveBeenCalledWith(type)
      },
    )
  })

  // The route's own `@Query(new ZodValidationPipe(GetMediaFileQueryDto))`,
  // not a re-derived one - the decorator wiring is what these assert.
  describe('the query validation pipe', () => {
    it('coerces the numeric strings a query string actually carries', () => {
      expect(
        getMediaFileQueryPipe().transform(
          { episodeId: '4412', part: '2' },
          QUERY_METADATA,
        ),
      ).toEqual({ episodeId: 4412, part: 2 })
    })

    it('accepts part 0, which is the first part rather than an absent one', () => {
      expect(
        getMediaFileQueryPipe().transform({ part: '0' }, QUERY_METADATA),
      ).toEqual({ part: 0 })
    })

    it.each([
      ['a negative part', { part: '-1' }],
      ['a non-numeric part', { part: 'first' }],
      ['a zero episodeId', { episodeId: '0' }],
    ])('rejects %s with a 400 before the route runs', (_label, query) => {
      expect(() =>
        getMediaFileQueryPipe().transform(query, QUERY_METADATA),
      ).toThrow(BadRequestException)
    })
  })
})
