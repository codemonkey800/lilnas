import { BadRequestException, ForbiddenException } from '@nestjs/common'

import { BrowserLogsController } from 'src/logging/browser-logs.controller'
import { BrowserLogsService } from 'src/logging/browser-logs.service'

const ALLOWED =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function makeService(): jest.Mocked<BrowserLogsService> {
  return { write: jest.fn() } as unknown as jest.Mocked<BrowserLogsService>
}

describe('BrowserLogsController', () => {
  describe('POST /logs/browser', () => {
    it('valid body calls service.write with the parsed entry', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      ctrl.logBrowserEvent(ALLOWED, { level: 'error', message: 'boom' })

      expect(svc.write).toHaveBeenCalledWith({
        level: 'error',
        message: 'boom',
      })
    })

    it('cross-origin → ForbiddenException, service never called', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      expect(() =>
        ctrl.logBrowserEvent('https://evil.example.com', {
          level: 'error',
          message: 'boom',
        }),
      ).toThrow(ForbiddenException)
      expect(svc.write).not.toHaveBeenCalled()
    })

    it('missing body → BadRequestException, service never called', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      expect(() => ctrl.logBrowserEvent(ALLOWED, undefined)).toThrow(
        BadRequestException,
      )
      expect(svc.write).not.toHaveBeenCalled()
    })

    it('invalid level → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      expect(() =>
        ctrl.logBrowserEvent(ALLOWED, { level: 'fatal', message: 'boom' }),
      ).toThrow(BadRequestException)
      expect(svc.write).not.toHaveBeenCalled()
    })

    it('empty message → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      expect(() =>
        ctrl.logBrowserEvent(ALLOWED, { level: 'info', message: '' }),
      ).toThrow(BadRequestException)
      expect(svc.write).not.toHaveBeenCalled()
    })

    it('message over 2000 chars → BadRequestException', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      expect(() =>
        ctrl.logBrowserEvent(ALLOWED, {
          level: 'info',
          message: 'x'.repeat(2001),
        }),
      ).toThrow(BadRequestException)
      expect(svc.write).not.toHaveBeenCalled()
    })

    it('accepts optional context/url/userAgent fields', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)
      const body = {
        level: 'warn' as const,
        message: 'heads up',
        context: { foo: 'bar' },
        url: 'https://tdr-code.lilnas.io/sessions/1',
        userAgent: 'test-agent',
      }

      ctrl.logBrowserEvent(ALLOWED, body)

      expect(svc.write).toHaveBeenCalledWith(body)
    })

    it('accepts a valid kebab-case event field and forwards it to the service', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)
      const body = {
        level: 'info' as const,
        message: 'clicked',
        event: 'button-click',
      }

      ctrl.logBrowserEvent(ALLOWED, body)

      expect(svc.write).toHaveBeenCalledWith(body)
    })

    it('omitted event field → still valid, service called without it', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      ctrl.logBrowserEvent(ALLOWED, { level: 'info', message: 'no event' })

      expect(svc.write).toHaveBeenCalledWith({
        level: 'info',
        message: 'no event',
      })
    })

    it('event over 64 chars → BadRequestException, service never called', () => {
      const svc = makeService()
      const ctrl = new BrowserLogsController(svc)

      expect(() =>
        ctrl.logBrowserEvent(ALLOWED, {
          level: 'info',
          message: 'clicked',
          event: `${'a'.repeat(60)}-toolong`,
        }),
      ).toThrow(BadRequestException)
      expect(svc.write).not.toHaveBeenCalled()
    })

    it.each([
      ['uppercase', 'Button-Click'],
      ['underscores', 'button_click'],
      ['spaces', 'button click'],
      ['embedded newline (log-forging attempt)', 'x\nfake-line'],
    ])(
      'event with %s → BadRequestException, service never called',
      (_label, badEvent) => {
        const svc = makeService()
        const ctrl = new BrowserLogsController(svc)

        expect(() =>
          ctrl.logBrowserEvent(ALLOWED, {
            level: 'info',
            message: 'clicked',
            event: badEvent,
          }),
        ).toThrow(BadRequestException)
        expect(svc.write).not.toHaveBeenCalled()
      },
    )
  })
})
