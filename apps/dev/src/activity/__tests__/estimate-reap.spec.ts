import { estimateReap, HostActivity } from 'src/activity/host-activity.service'

const now = new Date('2026-10-19T12:00:00.000Z')
const started = '2026-10-19T08:00:00.000Z'
const idleReap = { enabled: true, maxIdleHours: 2 }

const act = (
  activeUsers: number,
  lastVisitAt: string | null,
  host = 'a.dev.lilnas.io',
): HostActivity => ({ host, windowHours: 2, activeUsers, lastVisitAt })

describe('estimateReap', () => {
  it('is disabled when idle reaping is off, whatever else is known', () => {
    expect(
      estimateReap(
        { enabled: false, maxIdleHours: 2 },
        started,
        [act(0, null)],
        now,
      ),
    ).toEqual({ enabled: false, maxIdleHours: 2, basis: 'disabled' })
  })

  it('has no times when the container is not running', () => {
    expect(estimateReap(idleReap, undefined, [act(0, null)], now)).toEqual({
      enabled: true,
      maxIdleHours: 2,
      basis: 'unknown',
    })
  })

  it('is unknown when any lookup failed', () => {
    expect(estimateReap(idleReap, started, [act(0, null), null], now)).toEqual({
      enabled: true,
      maxIdleHours: 2,
      basis: 'unknown',
    })
  })

  it('is unknown when there are no routes', () => {
    expect(estimateReap(idleReap, started, [], now)).toEqual({
      enabled: true,
      maxIdleHours: 2,
      basis: 'unknown',
    })
  })

  it('counts from container start when nobody has visited', () => {
    expect(estimateReap(idleReap, started, [act(0, null)], now)).toEqual({
      enabled: true,
      maxIdleHours: 2,
      lastActiveAt: '2026-10-19T08:00:00.000Z',
      idleHours: 4,
      reapsAt: '2026-10-19T10:00:00.000Z',
      activeUsers: 0,
      basis: 'container-start',
    })
  })

  it('ignores visits older than the container start', () => {
    const result = estimateReap(
      idleReap,
      started,
      [act(0, '2026-10-18T00:00:00.000Z')],
      now,
    )

    expect(result.basis).toBe('container-start')
    expect(result.lastActiveAt).toBe('2026-10-19T08:00:00.000Z')
  })

  it('moves forward to the latest visit across all hosts', () => {
    const result = estimateReap(
      { enabled: true, maxIdleHours: 3 },
      started,
      [
        act(0, '2026-10-19T09:00:00.000Z'),
        act(0, '2026-10-19T10:30:00.000Z', 'b.dev.lilnas.io'),
        act(0, null, 'c.dev.lilnas.io'),
      ],
      now,
    )

    expect(result).toEqual({
      enabled: true,
      maxIdleHours: 3,
      lastActiveAt: '2026-10-19T10:30:00.000Z',
      idleHours: 1,
      reapsAt: '2026-10-19T13:30:00.000Z',
      activeUsers: 0,
      basis: 'auth',
    })
  })

  it('floors idle hours', () => {
    const result = estimateReap(
      idleReap,
      started,
      [act(0, '2026-10-19T10:00:01.000Z')],
      now,
    )

    expect(result.idleHours).toBe(1)
  })

  it('keeps the unit while users are active: no reapsAt, auth basis', () => {
    const result = estimateReap(
      idleReap,
      started,
      [act(1, '2026-10-19T11:00:00.000Z'), act(2, null, 'b.dev.lilnas.io')],
      now,
    )

    expect(result.reapsAt).toBeUndefined()
    expect(result.activeUsers).toBe(3)
    expect(result.basis).toBe('auth')
    expect(result.lastActiveAt).toBe('2026-10-19T11:00:00.000Z')
    expect(result.idleHours).toBe(1)
  })

  it('defaults now to the current time', () => {
    const result = estimateReap(idleReap, new Date().toISOString(), [
      act(0, null),
    ])

    expect(result.idleHours).toBe(0)
  })
})
