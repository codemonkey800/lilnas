import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Test } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'
import type { LogStream } from 'src/logging/log-view.types'

import { LogSourcesService } from './log-sources.service'

function fakeLogger(): PinoLogger {
  return {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    setContext: jest.fn(),
  } as unknown as PinoLogger
}

function fileNameFor(stream: LogStream): string {
  // Mirrors log-paths.ts's own naming (logEnvSuffix() resolves to 'dev' or
  // 'production' -> 'dev'/'prod' outside NODE_ENV=production, which Jest
  // never sets) without importing logFilePath itself, since this suite
  // deliberately points LogSourcesService at a temp dir instead.
  return `${stream}.dev.log`
}

describe('LogSourcesService', () => {
  let tmpDir: string
  let logger: PinoLogger
  let service: LogSourcesService

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'log-sources-service-spec-'),
    )
    logger = fakeLogger()
    const moduleRef = await Test.createTestingModule({
      providers: [LogSourcesService, { provide: PinoLogger, useValue: logger }],
    }).compile()
    service = moduleRef.get(LogSourcesService)
    service.setLogDirForTests(tmpDir)
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  it('happy path: all three files present -> three entries with correct exists:true and byte sizes, in the fixed LogStream order', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, fileNameFor('backend')),
      'a'.repeat(10),
    )
    await fs.promises.writeFile(
      path.join(tmpDir, fileNameFor('frontend-server')),
      'b'.repeat(20),
    )
    await fs.promises.writeFile(
      path.join(tmpDir, fileNameFor('frontend-browser')),
      'c'.repeat(30),
    )

    const sources = await service.getSources()

    expect(sources).toEqual([
      { stream: 'backend', exists: true, size: 10 },
      { stream: 'frontend-server', exists: true, size: 20 },
      { stream: 'frontend-browser', exists: true, size: 30 },
    ])
  })

  it('edge case (R2): frontend-server absent -> { stream: "frontend-server", exists: false, size: 0 }; the other two unaffected', async () => {
    await fs.promises.writeFile(
      path.join(tmpDir, fileNameFor('backend')),
      'x'.repeat(5),
    )
    // frontend-server intentionally never written.
    await fs.promises.writeFile(
      path.join(tmpDir, fileNameFor('frontend-browser')),
      'y'.repeat(7),
    )

    const sources = await service.getSources()

    expect(sources).toEqual([
      { stream: 'backend', exists: true, size: 5 },
      { stream: 'frontend-server', exists: false, size: 0 },
      { stream: 'frontend-browser', exists: true, size: 7 },
    ])
  })

  it('edge case: an empty-but-present file is distinct from an absent file (exists:true, size:0 vs exists:false, size:0)', async () => {
    await fs.promises.writeFile(path.join(tmpDir, fileNameFor('backend')), '')
    // frontend-server absent; frontend-browser also absent for contrast.

    const sources = await service.getSources()

    const backend = sources.find(s => s.stream === 'backend')
    const frontendServer = sources.find(s => s.stream === 'frontend-server')

    expect(backend).toEqual({ stream: 'backend', exists: true, size: 0 })
    expect(frontendServer).toEqual({
      stream: 'frontend-server',
      exists: false,
      size: 0,
    })
    // The two must not collapse to the same shape by accident — this is the
    // whole point of carrying `exists` alongside `size`.
    expect(backend).not.toEqual(frontendServer)
  })

  it('error path: a stat failure other than ENOENT is logged via LOG_EVENTS.logSourceStatFailed and rethrown (not silently swallowed into exists:false)', async () => {
    const statSpy = jest
      .spyOn(fs.promises, 'stat')
      .mockImplementation(async filePath => {
        if (String(filePath).includes('backend')) {
          const err = Object.assign(new Error('permission denied'), {
            code: 'EACCES',
          })
          throw err
        }
        return { size: 0 } as fs.Stats
      })

    await expect(service.getSources()).rejects.toThrow('permission denied')

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: LOG_EVENTS.logSourceStatFailed,
        stream: 'backend',
      }),
      expect.any(String),
    )

    statSpy.mockRestore()
  })
})
