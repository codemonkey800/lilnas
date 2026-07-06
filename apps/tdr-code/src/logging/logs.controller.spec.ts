import fs from 'node:fs'

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import type {
  LogSearchResponse,
  LogSource,
  LogWindowResponse,
} from 'src/logging/log-view.types'

import { LogReaderService } from './log-reader.service'
import { LogSearchService } from './log-search.service'
import { LogSourcesService } from './log-sources.service'
import { LogsController } from './logs.controller'

const MOCK_WINDOW_RESPONSE: LogWindowResponse = {
  stream: 'backend',
  fileSize: 100,
  windowStart: 0,
  windowEnd: 100,
  atStart: true,
  atEnd: true,
  lines: [
    {
      byteOffset: 0,
      byteLength: 40,
      raw: '{"level":30,"time":1,"msg":"hello"}',
      parsed: { level: 30, time: 1, msg: 'hello' },
    },
  ],
}

const MOCK_SOURCES_RESPONSE: LogSource[] = [
  { stream: 'backend', exists: true, size: 1234 },
  { stream: 'frontend-server', exists: false, size: 0 },
  { stream: 'frontend-browser', exists: true, size: 0 },
]

const MOCK_SEARCH_RESPONSE: LogSearchResponse = {
  total: 3,
  matches: [{ byteOffset: 0 }, { byteOffset: 40 }, { byteOffset: 80 }],
  nextCursor: null,
}

// A minimal stand-in for Express's Request — the search() handler only ever
// calls `request.on('close', ...)` to derive an AbortSignal from the
// connection lifecycle (see logs.controller.ts's own header comment on
// search()), so this fake only needs to support that one call, not the full
// Request surface. Recording the listener (rather than a no-op jest.fn())
// lets a test simulate a client disconnect by invoking it directly.
function fakeRequest(): { on: jest.Mock; triggerClose: () => void } {
  let closeListener: (() => void) | undefined
  const on = jest.fn((event: string, listener: () => void) => {
    if (event === 'close') closeListener = listener
  })
  return {
    on,
    triggerClose: () => closeListener?.(),
  }
}

describe('LogsController (unit, mocked service)', () => {
  let controller: LogsController
  let mockLogReader: { readWindow: jest.Mock }
  let mockLogSources: { getSources: jest.Mock }
  let mockLogSearch: { scan: jest.Mock }

  beforeEach(async () => {
    mockLogReader = {
      readWindow: jest.fn().mockResolvedValue(MOCK_WINDOW_RESPONSE),
    }
    mockLogSources = {
      getSources: jest.fn().mockResolvedValue(MOCK_SOURCES_RESPONSE),
    }
    mockLogSearch = {
      scan: jest.fn().mockResolvedValue(MOCK_SEARCH_RESPONSE),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [LogsController],
      providers: [
        { provide: LogReaderService, useValue: mockLogReader },
        { provide: LogSourcesService, useValue: mockLogSources },
        { provide: LogSearchService, useValue: mockLogSearch },
      ],
    }).compile()
    controller = moduleRef.get(LogsController)
  })

  it('happy path: delegates a valid query to LogReaderService.readWindow and returns its result verbatim', async () => {
    const result = await controller.window({
      stream: 'backend',
      anchor: '50',
      direction: 'before',
      maxBytes: '4096',
    })

    expect(result).toEqual(MOCK_WINDOW_RESPONSE)
    expect(mockLogReader.readWindow).toHaveBeenCalledWith({
      stream: 'backend',
      anchor: 50,
      direction: 'before',
      maxBytes: 4096,
    })
  })

  it('happy path: an absent maxBytes query param still calls the service (service applies its own default/cap)', async () => {
    await controller.window({
      stream: 'frontend-browser',
      anchor: '0',
      direction: 'after',
    })

    expect(mockLogReader.readWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: 'frontend-browser',
        anchor: 0,
        direction: 'after',
      }),
    )
  })

  it('happy path: direction=around is accepted and forwarded', async () => {
    await controller.window({
      stream: 'backend',
      anchor: '10',
      direction: 'around',
    })

    expect(mockLogReader.readWindow).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'around' }),
    )
  })

  it('error path (R17): an unknown stream value is rejected with BadRequestException before any fs call', async () => {
    // The proof that no fs access is attempted: LogReaderService (the ONLY
    // component in this request path that ever touches fs — see
    // log-reader.service.ts) is a bare jest.fn() mock with no real
    // implementation, so "readWindow was never called" is definitionally
    // "no fs call happened downstream of this request." A direct spy on
    // fs.statSync/existsSync is not used here — those are also called by
    // unrelated Jest/module-resolution internals during this same tick
    // (confirmed empirically: spying on fs.existsSync globally in this
    // suite trips on jest-circus's own runner, not application code), so a
    // global fs spy would be an unreliable assertion in this test's context
    // even though the underlying claim (no fs access) is still true and
    // fully covered by the mock-not-called check below.
    const statSpy = jest.spyOn(fs, 'statSync')

    await expect(
      controller.window({
        stream: '../../etc/passwd',
        anchor: '0',
        direction: 'before',
      }),
    ).rejects.toThrow(BadRequestException)

    expect(mockLogReader.readWindow).not.toHaveBeenCalled()
    expect(statSpy).not.toHaveBeenCalled()

    statSpy.mockRestore()
  })

  it('error path (R17): a value outside the LogStream union (but not path-traversal-shaped) is also rejected', async () => {
    await expect(
      controller.window({
        stream: 'totally-bogus-stream',
        anchor: '0',
        direction: 'before',
      }),
    ).rejects.toThrow(BadRequestException)
    expect(mockLogReader.readWindow).not.toHaveBeenCalled()
  })

  it('error path: a missing stream query param is rejected', async () => {
    await expect(
      controller.window({
        anchor: '0',
        direction: 'before',
      } as unknown as Record<string, string>),
    ).rejects.toThrow(BadRequestException)
    expect(mockLogReader.readWindow).not.toHaveBeenCalled()
  })

  it('error path: an invalid direction value is rejected', async () => {
    await expect(
      controller.window({
        stream: 'backend',
        anchor: '0',
        direction: 'sideways',
      }),
    ).rejects.toThrow(BadRequestException)
    expect(mockLogReader.readWindow).not.toHaveBeenCalled()
  })

  it('error path: a negative anchor is rejected', async () => {
    await expect(
      controller.window({
        stream: 'backend',
        anchor: '-5',
        direction: 'before',
      }),
    ).rejects.toThrow(BadRequestException)
    expect(mockLogReader.readWindow).not.toHaveBeenCalled()
  })

  it('error path: a non-numeric anchor is rejected', async () => {
    await expect(
      controller.window({
        stream: 'backend',
        anchor: 'not-a-number',
        direction: 'before',
      }),
    ).rejects.toThrow(BadRequestException)
    expect(mockLogReader.readWindow).not.toHaveBeenCalled()
  })

  it('error path: a non-positive maxBytes is rejected at the DTO layer (not silently clamped)', async () => {
    await expect(
      controller.window({
        stream: 'backend',
        anchor: '0',
        direction: 'before',
        maxBytes: '0',
      }),
    ).rejects.toThrow(BadRequestException)
    expect(mockLogReader.readWindow).not.toHaveBeenCalled()

    await expect(
      controller.window({
        stream: 'backend',
        anchor: '0',
        direction: 'before',
        maxBytes: '-100',
      }),
    ).rejects.toThrow(BadRequestException)
  })

  it('an oversized (but positive) maxBytes reaches the service, which is responsible for clamping it (not rejected here)', async () => {
    await controller.window({
      stream: 'backend',
      anchor: '0',
      direction: 'before',
      maxBytes: '999999999999',
    })

    expect(mockLogReader.readWindow).toHaveBeenCalledWith(
      expect.objectContaining({ maxBytes: 999999999999 }),
    )
  })

  describe('sources route (U3)', () => {
    it('happy path: returns the service result verbatim, with no query params or request body involved', async () => {
      const result = await controller.sources()

      expect(result).toEqual(MOCK_SOURCES_RESPONSE)
      expect(mockLogSources.getSources).toHaveBeenCalledWith()
    })

    it('the existing window route still works once the controller also injects LogSourcesService', async () => {
      const result = await controller.window({
        stream: 'backend',
        anchor: '0',
        direction: 'before',
      })

      expect(result).toEqual(MOCK_WINDOW_RESPONSE)
    })
  })

  describe('search route (Phase 2 U9)', () => {
    it('happy path: delegates a valid query to LogSearchService.scan, composing only the fields actually present into the predicate', async () => {
      const req = fakeRequest()
      const result = await controller.search(
        {
          stream: 'backend',
          text: 'boom',
          level: '40',
          process: 'bot',
          event: 'writer-fault',
        },
        req as never,
      )

      expect(result).toEqual(MOCK_SEARCH_RESPONSE)
      expect(mockLogSearch.scan).toHaveBeenCalledWith(
        expect.objectContaining({
          stream: 'backend',
          predicate: {
            text: 'boom',
            level: 40,
            process: 'bot',
            event: 'writer-fault',
          },
          cursor: undefined,
        }),
      )
    })

    it('happy path: an entirely empty predicate (no text/level/process/event) is passed through as {}', async () => {
      const req = fakeRequest()
      await controller.search({ stream: 'backend' }, req as never)

      expect(mockLogSearch.scan).toHaveBeenCalledWith(
        expect.objectContaining({ stream: 'backend', predicate: {} }),
      )
    })

    it("happy path: a present `cursor` query param is forwarded to the service UNVALIDATED (the service's own decodeCursor is responsible for rejecting it)", async () => {
      const req = fakeRequest()
      await controller.search(
        { stream: 'backend', cursor: '10:100:2' },
        req as never,
      )

      expect(mockLogSearch.scan).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: '10:100:2' }),
      )
    })

    it('wires an AbortSignal derived from the request: triggering the request close listener aborts the signal passed to the service', async () => {
      const req = fakeRequest()
      await controller.search({ stream: 'backend' }, req as never)

      expect(req.on).toHaveBeenCalledWith('close', expect.any(Function))
      const { signal } = mockLogSearch.scan.mock.calls[0][0] as {
        signal: AbortSignal
      }
      expect(signal.aborted).toBe(false)
      req.triggerClose()
      expect(signal.aborted).toBe(true)
    })

    it('error path (R17): an unknown stream value is rejected with BadRequestException before the service is ever called', async () => {
      const req = fakeRequest()
      await expect(
        controller.search({ stream: '../../etc/passwd' }, req as never),
      ).rejects.toThrow(BadRequestException)
      expect(mockLogSearch.scan).not.toHaveBeenCalled()
    })

    it('error path: a missing stream query param is rejected', async () => {
      const req = fakeRequest()
      await expect(
        controller.search(
          {} as unknown as Record<string, string>,
          req as never,
        ),
      ).rejects.toThrow(BadRequestException)
      expect(mockLogSearch.scan).not.toHaveBeenCalled()
    })

    it('error path: a non-numeric level is rejected at the DTO layer', async () => {
      const req = fakeRequest()
      await expect(
        controller.search(
          { stream: 'backend', level: 'not-a-number' },
          req as never,
        ),
      ).rejects.toThrow(BadRequestException)
      expect(mockLogSearch.scan).not.toHaveBeenCalled()
    })

    it('error path: an invalid process value is rejected at the DTO layer', async () => {
      const req = fakeRequest()
      await expect(
        controller.search(
          { stream: 'backend', process: 'sideways' },
          req as never,
        ),
      ).rejects.toThrow(BadRequestException)
      expect(mockLogSearch.scan).not.toHaveBeenCalled()
    })
  })
})
