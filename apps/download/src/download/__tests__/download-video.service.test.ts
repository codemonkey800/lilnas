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
import { YTDLP_PROGRESS_ARGS } from 'src/download/ytdlp-progress'

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

/**
 * A stand-in for the job's log file that enforces the same contract the real
 * one does. `createWriteStream()` returns a stream that is *not* in object
 * mode, so `write()` **throws** ERR_INVALID_ARG_TYPE for anything that isn't
 * a string/Buffer/TypedArray - it does not emit, and it does not coerce.
 *
 * That detail is the entire spawn-error wedge: `runProcess()` used to pass
 * the raw Error into `write()` from inside its 'error' listener, the throw
 * escaped as an uncaught exception, and `reject()` on the next line never
 * ran - leaving the download promise permanently unsettled. A permissive
 * `write: jest.fn()` swallows a raw Error happily and would let that back in
 * without a single test going red, so the fake refuses it the same way.
 */
function createMockLogStream() {
  return {
    close: jest.fn(),
    write: jest.fn((chunk: unknown) => {
      if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk)) {
        throw new TypeError(
          'The "chunk" argument must be of type string or an instance of ' +
            `Buffer. Received ${typeof chunk}`,
        )
      }

      return true
    }),
  }
}

const JOB_ID = 'job-1'
const NOW_ISO = '2026-08-20T12:00:00.000Z'
const VIDEO_URL = 'https://example.com/video'
const VIDEO_INFO = { description: 'An overview', title: 'A title' }

// Real yt-dlp output for a `160+139` grab: two files, the video stream then
// the audio stream, each announced by its own first tick.
const FORMAT_LINE = '[info] x: Downloading 1 format(s): 160+139'
const VIDEO_TICK_START =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 4323893, "tmpfilename": "test.f160.mp4.part", "filename": "test.f160.mp4", "eta": null, "speed": null}'
const VIDEO_TICK_MID =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 2096128, "total_bytes": 4323893, "tmpfilename": "test.f160.mp4.part", "filename": "test.f160.mp4", "eta": 0, "speed": 42971715.11}'
const VIDEO_TICK_DONE =
  'LILNAS_PROGRESS {"downloaded_bytes": 4323893, "total_bytes": 4323893, "filename": "test.f160.mp4", "status": "finished", "speed": 22382070.50}'
const AUDIO_TICK_START =
  'LILNAS_PROGRESS {"status": "downloading", "downloaded_bytes": 1024, "total_bytes": 3871021, "tmpfilename": "test.f139.m4a.part", "filename": "test.f139.m4a", "eta": null, "speed": null}'

/**
 * The fixture as yt-dlp's pipe might deliver it: the second tick is split
 * mid-prefix across two 'data' events, and the last chunk carries two lines.
 */
const PROGRESS_CHUNKS = [
  `${FORMAT_LINE}\n${VIDEO_TICK_START}\nLILNAS_PRO`,
  `${VIDEO_TICK_MID.slice('LILNAS_PRO'.length)}\n`,
  `${VIDEO_TICK_DONE}\n${AUDIO_TICK_START}\n`,
]

function buildJob(overrides: Partial<DownloadJobRecord> = {}) {
  return {
    completedAt: null,
    createdAt: NOW_ISO,
    discordRequester: null,
    hiddenAttribution: false,
    id: JOB_ID,
    linkedDiscord: null,
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
  let warnSpy: jest.SpyInstance
  let flushProgress: jest.Mock
  let getInterruption: jest.Mock
  let requireVideo: jest.Mock
  let setProgress: jest.Mock
  let interruptions: Map<string, JobInterruptKind>
  let options: DownloadStepOptions
  /** Held so a test can reach the handle `download()` registered. */
  let setProc: jest.Mock

  /**
   * Installs a `spawn()` fake. The `--dump-json` metadata probe that
   * `download()` runs first always succeeds - it's a non-critical
   * best-effort step, and letting it fail would only add noise - so
   * `code`/`stderr`/`stdout` describe the *pipeline* process (yt-dlp or
   * ffmpeg). Each `stdout` entry is its own 'data' event, emitted in order
   * before 'close', so a test controls exactly where the chunks split.
   */
  function mockProcessExit({
    code = 0,
    stderr,
    stdout = [],
  }: { code?: number; stderr?: string; stdout?: string[] } = {}) {
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

        for (const chunk of stdout) {
          proc.stdout.emit('data', Buffer.from(chunk))
        }

        if (stderr) {
          proc.stderr.emit('data', Buffer.from(stderr))
        }

        proc.emit('close', code)
      })

      return proc as unknown as ChildProcess
    })
  }

  /** The argv of every `spawn()` call so far, in order. */
  function spawnedArgs(): string[][] {
    return mockSpawn.mock.calls.map(call => {
      const argv: unknown = call[1]

      return Array.isArray(argv) ? argv.map(String) : []
    })
  }

  /** The `download.log`-writing yt-dlp spawn, i.e. not the metadata probe. */
  function downloadSpawnArgs(): string[] {
    const args = spawnedArgs().find(argv => !argv.includes('--dump-json'))
    if (!args) throw new Error('yt-dlp download was never spawned')

    return args
  }

  /**
   * Installs a `spawn()` fake whose pipeline process never starts. Node
   * reports that as an 'error' event followed by a 'close', which is what
   * this reproduces - EACCES here, but ENOENT, EPERM and ENOMEM all arrive
   * through the same listener, as does a `YtdlpUpdateService` update that
   * leaves a truncated or non-executable binary behind mid-`move`.
   *
   * Emitting both in one callback is deliberate: if the 'error' listener
   * throws, the throw takes the 'close' emit with it, exactly as it does in
   * node. The metadata probe still succeeds, same as `mockProcessExit()`.
   */
  function mockProcessSpawnError(error: Error) {
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

        proc.emit('error', error)
        proc.emit('close', null)
      })

      return proc as unknown as ChildProcess
    })
  }

  function spawnError(code: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(
      `spawn /usr/bin/yt-dlp ${code}`,
    )
    error.code = code

    return error
  }

  /** The log-file fake handed to the most recent `runProcess()` call. */
  function lastLogStream() {
    return mockCreateWriteStream.mock.results.at(-1)?.value as ReturnType<
      typeof createMockLogStream
    >
  }

  beforeEach(async () => {
    interruptions = new Map<string, JobInterruptKind>()
    const job = buildJob()
    options = { action: 'download', id: JOB_ID, job }

    const mockDownloadStateService = {
      flushProgress: jest.fn(),
      getInterruption: jest.fn((id: string) => interruptions.get(id)),
      jobs: new Map<string, DownloadJobRecord>([[JOB_ID, job]]),
      requireVideo: jest.fn(() => buildVideoRow()),
      setProc: jest.fn(),
      setProgress: jest.fn(),
      updateJob: jest.fn(),
      updateVideo: jest.fn(),
    }
    flushProgress = mockDownloadStateService.flushProgress
    getInterruption = mockDownloadStateService.getInterruption
    requireVideo = mockDownloadStateService.requireVideo
    setProc = mockDownloadStateService.setProc
    setProgress = mockDownloadStateService.setProgress

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

    mockCreateWriteStream.mockImplementation(() => createMockLogStream())
    mockEnsureDir.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue(['part0.mp4'])
    mockProcessExit()

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
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

  // The spawn-error wedge. `runProcess()`'s 'error' listener wrote the raw
  // Error into the job's log stream, which throws rather than emits for a
  // non-string chunk; the throw escaped the listener as an uncaught
  // exception and `reject()` never ran, so the download promise never
  // settled. `download()` then hung on it forever, the scheduler's catch
  // stayed suspended inside that await and never wrote Failed, and the
  // handle registered just before the spawn stayed registered on a child
  // that never started - so pause and cancel signalled a corpse and parked
  // at Pausing/Cancelling with nothing alive left to move them.
  //
  // Every assertion below is really the same one: the promise *settles*. The
  // suite's 10s testTimeout is what catches a regression - a re-broken
  // handler hangs these rather than failing an expectation.
  describe('a process that never starts', () => {
    it('rejects with the spawn error instead of hanging forever', async () => {
      const error = spawnError('EACCES')
      mockProcessSpawnError(error)

      const err = await captureRejection(service.download(options))

      // `toBe`, not `toMatchObject`: the rejection has to be the spawn error
      // itself. Settling from the trailing 'close' instead would surface as a
      // synthesised "exited with code null", which is a different bug.
      expect(err).toBe(error)
      expect(errorSpy).toHaveBeenCalled()
    })

    it('serialises the error into the log file rather than writing it raw', async () => {
      mockProcessSpawnError(spawnError('ENOENT'))

      await captureRejection(service.download(options))

      const written = lastLogStream().write.mock.calls.map(([chunk]) => chunk)
      expect(written.every(chunk => typeof chunk === 'string')).toBe(true)
      expect(written.join('')).toContain('ENOENT')
    })

    // A pause that arrived while the job was still `downloading` leaves its
    // intent on record and writes Pausing. If the spawn then fails, the only
    // thing that can move the job off Pausing is this rejection reaching the
    // scheduler - `proc.kill()` on a child that never started is a silent
    // no-op, so no exit event is ever coming.
    it('still rejects when a pause is already on record, so Pausing cannot stick', async () => {
      const error = spawnError('EACCES')
      interruptions.set(JOB_ID, 'pause')
      mockProcessSpawnError(error)

      const err = await captureRejection(service.download(options))

      // Not a JobInterruptedError: there was no process to interrupt. The
      // spawn genuinely failed, so the job belongs in Failed - which is
      // terminal, and therefore releases the handle - rather than in a Paused
      // state that could never be resumed.
      expect(err).toBe(error)
      expect(err).not.toBeInstanceOf(JobInterruptedError)
    })

    it('still rejects when a cancel is already on record, so Cancelling cannot stick', async () => {
      const error = spawnError('EACCES')
      interruptions.set(JOB_ID, 'cancel')
      mockProcessSpawnError(error)

      const err = await captureRejection(service.download(options))

      expect(err).toBe(error)
      expect(err).not.toBeInstanceOf(JobInterruptedError)
    })

    it('rejects the conversion phase too, which shares the same helper', async () => {
      const error = spawnError('ENOENT')
      mockProcessSpawnError(error)

      const err = await captureRejection(service.convert(options))

      expect(err).toBe(error)
    })

    // Not every failed spawn reaches the 'error' listener: node throws
    // straight out of `spawn()` for any errno outside its deferred set
    // (EACCES/EAGAIN/EMFILE/ENFILE/ENOENT) - ENOMEM under memory pressure, or
    // the ENOEXEC a half-written binary produces. That path has to settle too,
    // and must not leak the log file's fd on the way out.
    it('closes the log file when spawn throws synchronously', async () => {
      const error = spawnError('ENOMEM')
      mockSpawn.mockImplementation((...spawnArgs: unknown[]) => {
        const args = spawnArgs[1]

        if (Array.isArray(args) && args.includes('--dump-json')) {
          const proc = new MockChildProcess()
          setImmediate(() => {
            proc.stdout.emit('data', Buffer.from(JSON.stringify(VIDEO_INFO)))
            proc.emit('close', 0)
          })

          return proc as unknown as ChildProcess
        }

        throw error
      })

      const err = await captureRejection(service.download(options))

      expect(err).toBe(error)
      expect(lastLogStream().close).toHaveBeenCalled()
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

  describe('progress', () => {
    it('passes the progress args before the URL', async () => {
      await service.download(options)

      const args = downloadSpawnArgs()
      expect(args.slice(0, YTDLP_PROGRESS_ARGS.length)).toEqual(
        YTDLP_PROGRESS_ARGS,
      )
      expect(args.at(-1)).toBe(VIDEO_URL)
    })

    it('keeps the clip args alongside the progress args', async () => {
      requireVideo.mockReturnValue({
        ...buildVideoRow(),
        timeRange: { end: '00:00:20', start: '00:00:10' },
      })

      await service.download(options)

      expect(downloadSpawnArgs()).toEqual([
        ...YTDLP_PROGRESS_ARGS,
        '--download-sections',
        '*00:00:10-00:00:20',
        '--force-keyframes-at-cuts',
        VIDEO_URL,
      ])
    })

    it('leaves the metadata probe without progress args', async () => {
      await service.download(options)

      const probe = spawnedArgs().find(argv => argv.includes('--dump-json'))
      expect(probe).toEqual(['--dump-json', VIDEO_URL])
    })

    it('forwards one snapshot per tick, however the chunks split', async () => {
      mockProcessExit({ stdout: PROGRESS_CHUNKS })

      await service.download(options)

      // Four ticks, four snapshots - the tick split across two 'data' events
      // is one line, and the format line is not a tick at all.
      expect(setProgress).toHaveBeenCalledTimes(4)
      const calls = setProgress.mock.calls.map(([id, snapshot, opts]) => ({
        flush: (opts as { flush: boolean }).flush,
        id: id as string,
        snapshot: snapshot as Record<string, unknown>,
      }))

      expect(calls.map(c => c.id)).toEqual([JOB_ID, JOB_ID, JOB_ID, JOB_ID])
      expect(calls.map(c => c.snapshot.fileIndex)).toEqual([1, 1, 1, 2])
      expect(calls.map(c => c.snapshot.fileCount)).toEqual([2, 2, 2, 2])
      expect(calls.map(c => c.snapshot.percent)).toEqual([
        0.02, 48.48, 100, 0.03,
      ])
      // A new file bypasses the throttle; mid-file ticks, and a finish that
      // isn't the last file's, do not.
      expect(calls.map(c => c.flush)).toEqual([true, false, false, true])
    })

    it('forwards a last line that has no trailing newline', async () => {
      mockProcessExit({ stdout: [`${FORMAT_LINE}\n${VIDEO_TICK_START}`] })

      await service.download(options)

      expect(setProgress).toHaveBeenCalledTimes(1)
      expect(setProgress).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({ fileIndex: 1 }),
        { flush: true },
      )
    })

    it('flushes the held snapshot once the process exits', async () => {
      mockProcessExit({ stdout: PROGRESS_CHUNKS })

      await service.download(options)

      expect(flushProgress).toHaveBeenCalledTimes(1)
      expect(flushProgress).toHaveBeenCalledWith(JOB_ID)
      const lastSet = Math.max(...setProgress.mock.invocationCallOrder)
      expect(flushProgress.mock.invocationCallOrder[0]).toBeGreaterThan(lastSet)
    })

    // A clip goes through ffmpeg's downloader, which never prints a tick.
    it('sets nothing but still flushes once for a run with no ticks', async () => {
      requireVideo.mockReturnValue({
        ...buildVideoRow(),
        timeRange: { end: '00:00:20', start: '00:00:10' },
      })
      mockProcessExit({ stdout: ['[download] Destination: clip.mp4\n'] })

      await service.download(options)

      expect(setProgress).not.toHaveBeenCalled()
      expect(flushProgress).toHaveBeenCalledTimes(1)
    })

    it('flushes before the interrupt check so a paused job keeps its last tick', async () => {
      interruptions.set(JOB_ID, 'pause')
      mockProcessExit({ code: 1, stdout: PROGRESS_CHUNKS })

      const err = await captureRejection(service.download(options))

      expect(err).toBeInstanceOf(JobInterruptedError)
      expect(flushProgress).toHaveBeenCalledTimes(1)
      // The last `getInterruption()` read is `assertNotInterrupted()`.
      const interruptCheck = Math.max(
        ...getInterruption.mock.invocationCallOrder,
      )
      expect(flushProgress.mock.invocationCallOrder[0]).toBeLessThan(
        interruptCheck,
      )
    })

    it('still flushes on a crash and on a spawn error', async () => {
      mockProcessExit({ code: 1, stderr: 'ERROR: boom' })
      await captureRejection(service.download(options))
      expect(flushProgress).toHaveBeenCalledTimes(1)

      mockProcessSpawnError(spawnError('EACCES'))
      await captureRejection(service.download(options))
      expect(flushProgress).toHaveBeenCalledTimes(2)
    })

    it('starts file numbering over on a resumed run', async () => {
      mockProcessExit({ stdout: PROGRESS_CHUNKS })

      await service.download(options)
      setProgress.mockClear()
      await service.download(options)

      expect(setProgress.mock.calls[0]?.[1]).toMatchObject({ fileIndex: 1 })
    })

    it('does not fail the download when forwarding a snapshot throws', async () => {
      setProgress.mockImplementation(() => {
        throw new Error('broken progress')
      })
      mockProcessExit({ stdout: PROGRESS_CHUNKS })

      await expect(service.download(options)).resolves.toBeUndefined()

      // Every tick still reached the handler, and the throw was logged once.
      expect(setProgress).toHaveBeenCalledTimes(4)
      const warnings = warnSpy.mock.calls.filter(([data]) =>
        String((data as { error?: unknown }).error).includes('broken progress'),
      )
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.[0]).toMatchObject({
        job: expect.objectContaining({ id: JOB_ID }),
      })
      expect(flushProgress).toHaveBeenCalledTimes(1)
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('does not change the exit path when forwarding a snapshot throws', async () => {
      setProgress.mockImplementation(() => {
        throw new Error('broken progress')
      })
      mockProcessExit({
        code: 1,
        stderr: 'ERROR: unsupported URL',
        stdout: PROGRESS_CHUNKS,
      })

      const err = await captureRejection(service.download(options))

      expect(err).toMatchObject({ message: 'ERROR: unsupported URL' })
    })

    it('keeps piping stdout into the log file', async () => {
      mockProcessExit({ stdout: PROGRESS_CHUNKS })

      await service.download(options)

      const registered = setProc.mock.calls.at(-1)?.[1] as MockChildProcess
      expect(registered.stdout.pipe).toHaveBeenCalledWith(lastLogStream())
    })

    it('never reads progress from ffmpeg', async () => {
      mockProcessExit({ stdout: PROGRESS_CHUNKS })

      await service.convert(options)

      expect(setProgress).not.toHaveBeenCalled()
      expect(flushProgress).not.toHaveBeenCalled()
      const [ffmpegArgs] = spawnedArgs()
      expect(ffmpegArgs).not.toEqual(
        expect.arrayContaining([...YTDLP_PROGRESS_ARGS]),
      )
      expect(ffmpegArgs).not.toContain('--progress-template')
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
