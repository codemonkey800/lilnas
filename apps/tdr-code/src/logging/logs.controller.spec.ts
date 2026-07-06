import fs from 'node:fs'

import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import type { LogWindowResponse } from 'src/logging/log-view.types'

import { LogReaderService } from './log-reader.service'
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

describe('LogsController (unit, mocked service)', () => {
  let controller: LogsController
  let mockLogReader: { readWindow: jest.Mock }

  beforeEach(async () => {
    mockLogReader = {
      readWindow: jest.fn().mockResolvedValue(MOCK_WINDOW_RESPONSE),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [LogsController],
      providers: [{ provide: LogReaderService, useValue: mockLogReader }],
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
})
