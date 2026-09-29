import type {
  CommandSnapshot,
  CommandStatus,
} from 'src/media/arr-command.types'
import { isCommandEnded, waitForCommand } from 'src/media/command-wait.util'

function command(status: CommandStatus): CommandSnapshot {
  return { body: {}, id: 5, name: 'RefreshMovie', status }
}

/**
 * A clock that only moves when the injected `sleep` is called, so a test can
 * assert exactly how long the wait slept for.
 */
function fakeClock() {
  let now = 0
  const slept: number[] = []

  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms)
      now += ms
    },
    slept,
  }
}

describe('isCommandEnded', () => {
  it.each<[CommandStatus, boolean]>([
    ['queued', false],
    ['started', false],
    ['completed', true],
    ['failed', true],
    ['aborted', true],
    ['cancelled', true],
    ['orphaned', true],
  ])('%s -> %s', (status, ended) => {
    expect(isCommandEnded(command(status))).toBe(ended)
  })
})

describe('waitForCommand', () => {
  it('returns at once for a command that has already ended', async () => {
    const clock = fakeClock()
    const getCommand = jest.fn(async () => command('completed'))

    const result = await waitForCommand(getCommand, 5, {
      intervalMs: 1000,
      timeoutMs: 30_000,
      ...clock,
    })

    expect(result).toEqual({ command: command('completed'), outcome: 'ended' })
    expect(getCommand).toHaveBeenCalledWith(5)
    expect(clock.slept).toEqual([])
  })

  it('polls every interval until the command ends', async () => {
    const clock = fakeClock()
    const getCommand = jest
      .fn<Promise<CommandSnapshot | null>, [number]>()
      .mockResolvedValueOnce(command('queued'))
      .mockResolvedValueOnce(command('started'))
      .mockResolvedValueOnce(command('failed'))

    const result = await waitForCommand(getCommand, 5, {
      intervalMs: 1000,
      timeoutMs: 30_000,
      ...clock,
    })

    expect(result).toEqual({ command: command('failed'), outcome: 'ended' })
    expect(getCommand).toHaveBeenCalledTimes(3)
    expect(clock.slept).toEqual([1000, 1000])
  })

  it('reports a command the *arr no longer knows as missing', async () => {
    const result = await waitForCommand(async () => null, 5, {
      intervalMs: 1000,
      timeoutMs: 30_000,
      ...fakeClock(),
    })

    expect(result).toEqual({ outcome: 'missing' })
  })

  it('gives up at the deadline, never sleeping past it', async () => {
    const clock = fakeClock()
    const getCommand = jest.fn(async () => command('started'))

    const result = await waitForCommand(getCommand, 5, {
      intervalMs: 1000,
      timeoutMs: 2500,
      ...clock,
    })

    expect(result).toEqual({ command: command('started'), outcome: 'timeout' })
    expect(clock.slept).toEqual([1000, 1000, 500])
    // A last read at the deadline itself, so a command that finished during
    // the final sleep still counts.
    expect(getCommand).toHaveBeenCalledTimes(4)
  })

  it('propagates a failed read', async () => {
    await expect(
      waitForCommand(
        async () => {
          throw new Error('radarr down')
        },
        5,
        { intervalMs: 1000, timeoutMs: 30_000, ...fakeClock() },
      ),
    ).rejects.toThrow('radarr down')
  })

  it('defaults to real timers, which fake timers can drive', async () => {
    jest.useFakeTimers()
    try {
      const getCommand = jest
        .fn<Promise<CommandSnapshot | null>, [number]>()
        .mockResolvedValueOnce(command('queued'))
        .mockResolvedValueOnce(command('completed'))

      const pending = waitForCommand(getCommand, 5, {
        intervalMs: 1000,
        timeoutMs: 30_000,
      })
      await jest.advanceTimersByTimeAsync(1000)

      await expect(pending).resolves.toMatchObject({ outcome: 'ended' })
    } finally {
      jest.useRealTimers()
    }
  })
})
