import { Logger } from '@nestjs/common'
import { ActivityType, Client } from 'discord.js'

import { AppEventsService, formatStartedStatus } from 'src/app-events.service'

describe('formatStartedStatus', () => {
  it('formats the start time as a Pacific day and time', () => {
    // 2026-09-24T22:42:00Z is 3:42 PM PDT
    const status = formatStartedStatus(new Date('2026-09-24T22:42:00Z'))

    expect(status).toMatch(/^Up since Thu, Sep 24, 3:42\sPM PDT$/)
  })

  it('uses PST outside daylight saving time', () => {
    const status = formatStartedStatus(new Date('2026-01-15T17:05:00Z'))

    expect(status).toMatch(/^Up since Thu, Jan 15, 9:05\sAM PST$/)
  })
})

describe('AppEventsService', () => {
  function makeService(user: { setPresence: jest.Mock } | null) {
    const client = { user } as unknown as Client
    return new AppEventsService(client)
  }

  it('sets a custom status with the start time on the ready shard', () => {
    const setPresence = jest.fn()
    const service = makeService({ setPresence })

    service.onShardReady([0, undefined])

    expect(setPresence).toHaveBeenCalledTimes(1)
    const [presence] = setPresence.mock.calls[0]
    expect(presence.shardId).toBe(0)
    expect(presence.activities).toHaveLength(1)
    expect(presence.activities[0].type).toBe(ActivityType.Custom)
    expect(presence.activities[0].state).toMatch(/^Up since /)
  })

  it('keeps the original start time across reconnects', () => {
    const setPresence = jest.fn()
    const service = makeService({ setPresence })

    service.onShardReady([0, undefined])
    service.onShardReady([0, undefined])

    expect(setPresence.mock.calls[1][0].activities[0].state).toBe(
      setPresence.mock.calls[0][0].activities[0].state,
    )
  })

  it('does not throw when setting the presence fails', () => {
    const setPresence = jest.fn(() => {
      throw new Error('gateway not connected')
    })
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
    const service = makeService({ setPresence })

    expect(() => service.onShardReady([0, undefined])).not.toThrow()
    expect(logError).toHaveBeenCalled()
    logError.mockRestore()
  })

  it('does nothing when the client user is not available', () => {
    const service = makeService(null)

    expect(() => service.onShardReady([0, undefined])).not.toThrow()
  })
})
