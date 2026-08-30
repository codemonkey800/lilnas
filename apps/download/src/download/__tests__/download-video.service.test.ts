// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadStateService, which is imported here purely as a DI token) must
// mock it first (see download-state.service.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobRecord,
  DownloadJobStatus,
  DownloadType,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { createWriteStream } from 'fs'
import { ensureDir, readdir } from 'fs-extra'
import { MINIO_CONNECTION } from 'nestjs-minio'

import { type VideoRow } from 'src/db/schema'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { DownloadVideoService } from 'src/download/download-video.service'
import {
  JobInterruptedError,
  JobInterruptKind,
} from 'src/download/job-interrupted.error'
import { DownloadStepOptions } from 'src/download/types'

jest.mock('child_process')
// Only `createWriteStream` is replaced: the rest of `fs` is left real so
// nothing else in the import graph (better-sqlite3's binding lookup, drizzle)
// loses a function it needs at require time.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs')

  return { ...actual, createWriteStream: jest.fn() }
})
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn(),
  readdir: jest.fn(),
  remove: jest.fn(),
}))

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>
const mockCreateWriteStream = createWriteStream as unknown as jest.Mock
const mockEnsureDir = ensureDir as unknown as jest.Mock
const mockReaddir = readdir as unknown as jest.Mock

// `runProcess()` pipes both child streams into the log file, and node's
// `EventEmitter` has no `pipe()`, so the fakes need one. It's never asserted
// on - the log stream itself is a mock - it just has to exist.
class MockStream extends EventEmitter {
  pipe = jest.fn()
}

class MockChildProcess extends EventEmitter {
  stdout = new MockStream()
  stderr = new MockStream()
  kill = jest.fn()
}

const JOB_ID = 'job-1'
const NOW_ISO = '2026-08-20T12:00:00.000Z'
const VIDEO_URL = 'https://example.com/video'
const VIDEO_INFO = { description: 'An overview', title: 'A title' }

function buildJob(overrides: Partial<DownloadJobRecord> = {}) {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    hiddenAttribution: false,
    id: JOB_ID,
    mediaId: 'video:v1',
    requester: null,
    status: DownloadJobStatus.Pending,
    type: DownloadType.Video,
    updatedAt: NOW_ISO,
    ...overrides,
  } satisfies DownloadJobRecord
}

function buildVideoRow(): VideoRow {
  return {
    createdAt: new Date(NOW_ISO),
    downloadUrls: null,
    id: 'v1',
    naturalKey: VIDEO_URL,
    overview: null,
    posterUrl: null,
    runtime: null,
    sourceUrl: VIDEO_URL,
    timeRange: null,
    title: VIDEO_URL,
    updatedAt: new Date(NOW_ISO),
  }
}

/**
 * Resolves to whatever `promise` rejected with, and fails loudly if it
 * resolves instead - `rejects.toBeInstanceOf()` alone can't also assert on
 * the sentinel's `jobId`/`kind` payload.
 */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }

  throw new Error('Expected the promise to reject, but it resolved')
}

describe('DownloadVideoService', () => {
  let service: DownloadVideoService
  let errorSpy: jest.SpyInstance
  let interruptions: Map<string, JobInterruptKind>
  let options: DownloadStepOptions
  /** Held so a test can reach the handle `download()` registered. */
  let setProc: jest.Mock

  /**
   * Installs a `spawn()` fake. The `--dump-json` metadata probe that
   * `download()` runs first always succeeds - it's a non-critical
   * best-effort step, and letting it fail would only add noise - so
   * `code`/`stderr` describe the *pipeline* process (yt-dlp or ffmpeg).
   */
  function mockProcessExit({
    code = 0,
    stderr,
  }: { code?: number; stderr?: string } = {}) {
    mockSpawn.mockImplementation((...spawnArgs: unknown[]) => {
      const args = spawnArgs[1]
      const isInfoProbe = Array.isArray(args) && args.includes('--dump-json')
      const proc = new MockChildProcess()

      setImmediate(() => {
        if (isInfoProbe) {
          proc.stdout.emit('data', Buffer.from(JSON.stringify(VIDEO_INFO)))
          proc.emit('close', 0)
          return
        }

        if (stderr) {
          proc.stderr.emit('data', Buffer.from(stderr))
        }

        proc.emit('close', code)
      })

      return proc as unknown as ChildProcess
    })
  }

  beforeEach(async () => {
    interruptions = new Map<string, JobInterruptKind>()
    const job = buildJob()
    options = { action: 'download', id: JOB_ID, job }

    const mockDownloadStateService = {
      getInterruption: jest.fn((id: string) => interruptions.get(id)),
      jobs: new Map<string, DownloadJobRecord>([[JOB_ID, job]]),
      requireVideo: jest.fn(() => buildVideoRow()),
      setProc: jest.fn(),
      updateJob: jest.fn(),
      updateVideo: jest.fn(),
    }
    setProc = mockDownloadStateService.setProc

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadVideoService,
        { provide: MINIO_CONNECTION, useValue: { fPutObject: jest.fn() } },
        {
          provide: DownloadStateService,
          useValue: mockDownloadStateService,
        },
        {
          provide: DownloadMetricsService,
          useValue: { observeVideoInfo: jest.fn() },
        },
      ],
    }).compile()

    service = module.get<DownloadVideoService>(DownloadVideoService)

    mockCreateWriteStream.mockImplementation(() => ({
      close: jest.fn(),
      write: jest.fn(),
    }))
    mockEnsureDir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue(['part0.mp4'])
    mockProcessExit()

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  describe('download', () => {
    it('resolves when yt-dlp exits cleanly', async () => {
      mockProcessExit({ code: 0 })

      await expect(service.download(options)).resolves.toBeUndefined()

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('still throws the stderr tail on a non-zero exit with no interrupt recorded', async () => {
      mockProcessExit({ code: 1, stderr: 'ERROR: unsupported URL' })

      const err = await captureRejection(service.download(options))

      expect(err).not.toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ message: 'ERROR: unsupported URL' })
      // The no-regression half: a genuine crash is still logged as one.
      expect(errorSpy).toHaveBeenCalled()
    })

    it('throws JobInterruptedError carrying "pause" when a pause was recorded', async () => {
      interruptions.set(JOB_ID, 'pause')
      mockProcessExit({ code: 1, stderr: 'ERROR: Interrupted by user' })

      const err = await captureRejection(service.download(options))

      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ jobId: JOB_ID, kind: 'pause' })
    })

    it('throws JobInterruptedError carrying "cancel" when a cancel was recorded', async () => {
      interruptions.set(JOB_ID, 'cancel')
      mockProcessExit({ code: 1 })

      const err = await captureRejection(service.download(options))

      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ jobId: JOB_ID, kind: 'cancel' })
    })

    it('does not log a deliberate interrupt as a failure', async () => {
      interruptions.set(JOB_ID, 'pause')
      mockProcessExit({ code: 1, stderr: 'ERROR: Interrupted by user' })

      await captureRejection(service.download(options))

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('lets the interrupt win over a clean exit that raced it', async () => {
      // The documented, accepted race: a pause recorded after yt-dlp already
      // finished still parks the job at Paused rather than silently
      // completing it.
      interruptions.set(JOB_ID, 'pause')
      mockProcessExit({ code: 0 })

      const err = await captureRejection(service.download(options))

      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ kind: 'pause' })
    })

    // The pre-spawn window. `download()` writes Downloading, then spends about
    // a second on the metadata probe, and only registers the yt-dlp handle
    // afterwards. A pause arriving in that gap has no process to signal, so it
    // records its intent and this is what has to deliver it - otherwise the
    // request is dropped and the job finishes after the user stopped it.
    it('signals an interrupt that was recorded before the process existed', async () => {
      interruptions.set(JOB_ID, 'pause')
      mockProcessExit({ code: 1, stderr: 'ERROR: Interrupted by user' })

      const err = await captureRejection(service.download(options))

      const registered = setProc.mock.calls.at(-1)?.[1] as MockChildProcess
      expect(registered.kill).toHaveBeenCalledTimes(1)
      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ kind: 'pause' })
    })

    it('leaves the process alone when no interrupt is recorded', async () => {
      mockProcessExit({ code: 0 })

      await service.download(options)

      const registered = setProc.mock.calls.at(-1)?.[1] as MockChildProcess
      expect(registered.kill).not.toHaveBeenCalled()
    })

    it('never reaches the empty-file-list check for an interrupted job', async () => {
      // A paused job has only a `.part` file, which getVideoFiles() filters
      // out - so "no video files" must never be the error a pause surfaces.
      interruptions.set(JOB_ID, 'pause')
      mockReaddir.mockResolvedValue([])
      mockProcessExit({ code: 1 })

      const err = await captureRejection(service.download(options))

      expect(err).toBeInstanceOf(JobInterruptedError)
    })
  })

  describe('convert', () => {
    it('resolves when ffmpeg exits cleanly', async () => {
      mockProcessExit({ code: 0 })

      await expect(service.convert(options)).resolves.toBeUndefined()

      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('still throws the stderr tail on a non-zero exit with no interrupt recorded', async () => {
      mockProcessExit({ code: 1, stderr: 'ffmpeg: invalid codec' })

      const err = await captureRejection(service.convert(options))

      expect(err).not.toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ message: 'ffmpeg: invalid codec' })
      expect(errorSpy).toHaveBeenCalled()
    })

    it('throws JobInterruptedError carrying "cancel" when a cancel was recorded', async () => {
      interruptions.set(JOB_ID, 'cancel')
      mockProcessExit({ code: 1, stderr: 'ffmpeg: Interrupted' })

      const err = await captureRejection(service.convert(options))

      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(err).toMatchObject({ jobId: JOB_ID, kind: 'cancel' })
      expect(errorSpy).not.toHaveBeenCalled()
    })
  })

  describe('runProcess', () => {
    it('opens the job log file in append mode so a resume cannot truncate it', async () => {
      mockProcessExit({ code: 0 })

      await service.download(options)

      expect(mockCreateWriteStream).toHaveBeenCalledWith(
        `/download/videos/${JOB_ID}/download.log`,
        { encoding: 'utf-8', flags: 'a' },
      )
    })
  })
})
