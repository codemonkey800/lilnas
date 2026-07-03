import fs from 'node:fs'

import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { ConfigController } from 'src/console/config.controller'
import type {
  ConfigResponseDto,
  UpdateConfigBodyDto,
} from 'src/console/config.dto'
import { ConfigService } from 'src/console/config.service'
import type { Db } from 'src/db/database.module'

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

const ALLOWED =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

const VALID_BODY: UpdateConfigBodyDto = {
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
}

const MOCK_RESPONSE: ConfigResponseDto = {
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
}

function makeService(
  response: ConfigResponseDto = MOCK_RESPONSE,
): jest.Mocked<ConfigService> {
  return {
    getConfig: jest.fn().mockReturnValue(response),
    updateConfig: jest.fn().mockReturnValue(response),
  } as unknown as jest.Mocked<ConfigService>
}

describe('ConfigController', () => {
  describe('GET /config', () => {
    it('returns the current config', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      const result = ctrl.getConfig()
      expect(result).toEqual(MOCK_RESPONSE)
      expect(svc.getConfig).toHaveBeenCalledTimes(1)
    })
  })

  describe('PUT /config', () => {
    it('valid body returns updated config', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      const result = ctrl.updateConfig(ALLOWED, VALID_BODY)
      expect(result).toEqual(MOCK_RESPONSE)
      expect(svc.updateConfig).toHaveBeenCalledWith(VALID_BODY)
    })

    it('cross-origin request → ForbiddenException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig('https://evil.example.com', VALID_BODY),
      ).toThrow(ForbiddenException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it('absent origin → ForbiddenException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() => ctrl.updateConfig(undefined, VALID_BODY)).toThrow(
        ForbiddenException,
      )
    })

    it('maxConcurrentSessions = 1 (minimum) is accepted', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, { ...VALID_BODY, maxConcurrentSessions: 1 }),
      ).not.toThrow()
    })

    it('maxConcurrentSessions = 0 → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, { ...VALID_BODY, maxConcurrentSessions: 0 }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it('idleTimeoutSec = 0 → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, { ...VALID_BODY, idleTimeoutSec: 0 }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it('empty claudeCommand → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, { ...VALID_BODY, claudeCommand: '' }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it('whitespace-only claudeCommand → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, { ...VALID_BODY, claudeCommand: '   ' }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it.each([';', '|', '&', '$', '`', '<', '>', '!'])(
      'claudeCommand with shell metacharacter "%s" → BadRequestException',
      char => {
        const svc = makeService()
        const ctrl = new ConfigController(svc)
        expect(() =>
          ctrl.updateConfig(ALLOWED, {
            ...VALID_BODY,
            claudeCommand: `claude${char}evil`,
          }),
        ).toThrow(BadRequestException)
        expect(svc.updateConfig).not.toHaveBeenCalled()
      },
    )

    it('non-array claudeArgs → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, {
          ...VALID_BODY,
          claudeArgs: 'not-array' as unknown as string[],
        }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it('claudeArgs over size cap (65 elements) → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, {
          ...VALID_BODY,
          claudeArgs: new Array(65).fill('--arg'),
        }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })

    it('claudeArgs with NUL byte → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new ConfigController(svc)
      expect(() =>
        ctrl.updateConfig(ALLOWED, {
          ...VALID_BODY,
          claudeArgs: ['--arg\0injection'],
        }),
      ).toThrow(BadRequestException)
      expect(svc.updateConfig).not.toHaveBeenCalled()
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// ConfigService.updateConfig — cwd validation and reread_config enqueue
// ──────────────────────────────────────────────────────────────────────────────

const MOCK_CONFIG_ROW = {
  id: 1 as const,
  cwd: '/tmp',
  claudeCommand: 'claude',
  claudeArgs: ['--dangerously-skip-permissions'],
  idleTimeoutSec: 300,
  maxConcurrentSessions: 5,
  updatedAt: new Date(),
}

function makeChain(configRow = MOCK_CONFIG_ROW) {
  const chain: Record<string, jest.Mock> = {
    values: jest.fn(),
    set: jest.fn(),
    where: jest.fn(),
    returning: jest.fn(),
    orderBy: jest.fn(),
    limit: jest.fn(),
    onConflictDoUpdate: jest.fn(),
    from: jest.fn(),
    get: jest.fn().mockReturnValue(configRow),
    all: jest.fn().mockReturnValue([]),
    run: jest.fn().mockReturnValue({ changes: 1 }),
  }
  for (const k of [
    'values',
    'set',
    'where',
    'returning',
    'orderBy',
    'limit',
    'onConflictDoUpdate',
    'from',
  ]) {
    chain[k]!.mockReturnValue(chain)
  }
  return chain
}

function makeServiceDb(
  configRow = MOCK_CONFIG_ROW,
  genRow: unknown = undefined,
) {
  const chain = makeChain(configRow)
  const db = {
    insert: jest.fn().mockReturnValue(chain),
    update: jest.fn().mockReturnValue(chain),
    select: jest.fn().mockReturnValue(chain),
    delete: jest.fn().mockReturnValue(chain),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    transaction: jest.fn().mockImplementation((_cb: () => unknown) => {
      // updateConfig uses transaction — return the updated config row
      return configRow
    }),
  }
  // latestGeneration calls db.select().from(botGeneration).orderBy(...).limit(1).get()
  // Return genRow for this call
  chain.get
    .mockReturnValueOnce(configRow) // getConfig
    .mockReturnValueOnce(configRow) // updateConfig inside transaction
    .mockReturnValue(genRow) // latestGeneration
  return { db, chain }
}

describe('ConfigService', () => {
  describe('updateConfig cwd validation', () => {
    it('non-existent cwd → BadRequestException, nothing persisted', () => {
      const { db } = makeServiceDb()
      const svc = new ConfigService(db as unknown as Db, makeLogger())

      jest.spyOn(fs, 'statSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      })

      expect(() =>
        svc.updateConfig({ ...VALID_BODY, cwd: '/no/such/path' }),
      ).toThrow(BadRequestException)
      // updateConfig (DB write) should not have been called
      expect(db.transaction).not.toHaveBeenCalled()
    })

    it('cwd is a file (not a dir) → BadRequestException', () => {
      const { db } = makeServiceDb()
      const svc = new ConfigService(db as unknown as Db, makeLogger())

      jest.spyOn(fs, 'statSync').mockReturnValueOnce({
        isDirectory: () => false,
      } as unknown as fs.Stats)

      expect(() =>
        svc.updateConfig({ ...VALID_BODY, cwd: '/tmp/somefile' }),
      ).toThrow(BadRequestException)
    })

    it('valid cwd persists config and returns DTO', () => {
      const { db } = makeServiceDb()
      const svc = new ConfigService(db as unknown as Db, makeLogger())

      jest.spyOn(fs, 'statSync').mockReturnValueOnce({
        isDirectory: () => true,
      } as unknown as fs.Stats)

      const result = svc.updateConfig(VALID_BODY)
      expect(result.cwd).toBe('/tmp')
    })
  })

  describe('reread_config enqueue', () => {
    it('enqueues reread_config when a running generation exists', () => {
      const runningGen = {
        id: 42,
        status: 'running',
        pid: 1234,
        lastHeartbeatAt: new Date(),
        endedAt: null,
        exitCode: null,
        startedAt: new Date(),
      }
      const chain = makeChain()
      const db = {
        insert: jest.fn().mockReturnValue(chain),
        update: jest.fn().mockReturnValue(chain),
        select: jest.fn().mockReturnValue(chain),
        delete: jest.fn().mockReturnValue(chain),
        transaction: jest.fn().mockReturnValue(MOCK_CONFIG_ROW),
      }
      // getConfig → MOCK_CONFIG_ROW; latestGeneration → runningGen
      chain.get
        .mockReturnValueOnce(MOCK_CONFIG_ROW)
        .mockReturnValueOnce(runningGen)

      jest
        .spyOn(fs, 'statSync')
        .mockReturnValue({ isDirectory: () => true } as unknown as fs.Stats)

      const svc = new ConfigService(db as unknown as Db, makeLogger())
      svc.updateConfig(VALID_BODY)

      expect(db.insert).toHaveBeenCalled()
    })

    it('does not fail when bot is offline (no running generation)', () => {
      const chain = makeChain()
      const db = {
        insert: jest.fn().mockReturnValue(chain),
        update: jest.fn().mockReturnValue(chain),
        select: jest.fn().mockReturnValue(chain),
        delete: jest.fn().mockReturnValue(chain),
        transaction: jest.fn().mockReturnValue(MOCK_CONFIG_ROW),
      }
      // getConfig → MOCK_CONFIG_ROW; latestGeneration → null (offline)
      chain.get.mockReturnValueOnce(MOCK_CONFIG_ROW).mockReturnValueOnce(null)

      jest
        .spyOn(fs, 'statSync')
        .mockReturnValue({ isDirectory: () => true } as unknown as fs.Stats)

      const svc = new ConfigService(db as unknown as Db, makeLogger())
      expect(() => svc.updateConfig(VALID_BODY)).not.toThrow()
    })
  })
})
