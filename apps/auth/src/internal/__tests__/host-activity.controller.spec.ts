import { BadRequestException } from '@nestjs/common'

import { HostActivityController } from 'src/internal/host-activity.controller'
import type { HostActivityService } from 'src/services/host-activity.service'

function makeController(
  summary = { activeUsers: 0, lastVisitAt: null as Date | null },
) {
  const summarize = jest.fn().mockReturnValue(summary)
  const controller = new HostActivityController({
    summarize,
  } as unknown as HostActivityService)
  return { controller, summarize }
}

describe('HostActivityController', () => {
  it('returns the distinct-user count and last visit for a host', () => {
    const lastVisitAt = new Date('2026-10-18T10:00:00.000Z')
    const { controller, summarize } = makeController({
      activeUsers: 2,
      lastVisitAt,
    })

    expect(controller.hostActivityFor('theater.dev.lilnas.io', '6')).toEqual({
      host: 'theater.dev.lilnas.io',
      windowHours: 6,
      activeUsers: 2,
      lastVisitAt: '2026-10-18T10:00:00.000Z',
    })
    expect(summarize).toHaveBeenCalledWith('theater.dev.lilnas.io', 6)
  })

  it('answers 200 with zero users and a null lastVisitAt for an unseen host', () => {
    const { controller } = makeController()

    expect(controller.hostActivityFor('new.dev.lilnas.io', '6')).toEqual({
      host: 'new.dev.lilnas.io',
      windowHours: 6,
      activeUsers: 0,
      lastVisitAt: null,
    })
  })

  it('normalizes the host to lowercase without a port', () => {
    const { controller, summarize } = makeController()

    controller.hostActivityFor('THEATER.dev.lilnas.io:443', '1.5')

    expect(summarize).toHaveBeenCalledWith('theater.dev.lilnas.io', 1.5)
  })

  it.each([undefined, '', '   '])('rejects a missing host (%p)', host => {
    const { controller } = makeController()

    expect(() => controller.hostActivityFor(host, '6')).toThrow(
      BadRequestException,
    )
  })

  it.each([undefined, '', 'abc', '0', '-1', 'Infinity', '721'])(
    'rejects invalid hours (%p)',
    hours => {
      const { controller } = makeController()

      expect(() =>
        controller.hostActivityFor('theater.dev.lilnas.io', hours),
      ).toThrow(BadRequestException)
    },
  )
})
