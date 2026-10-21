import { Test } from '@nestjs/testing'

import { HostActivityService } from 'src/activity/host-activity.service'
import { ComposeRunnerService } from 'src/compose/compose-runner.service'
import { DockerEngineService } from 'src/docker/docker-engine.service'
import { RegistryService } from 'src/registry/registry.service'
import {
  composeLabels,
  container,
  dockerEvent,
  FakeActivity,
  FakeDocker,
  FakeRegistry,
  FakeRunner,
  operation,
  route,
  service,
  stack,
} from 'src/stacks/__tests__/helpers/fakes'
import { EVENT_DEBOUNCE_MS, StacksService } from 'src/stacks/stacks.service'
import type {
  ServiceView,
  StacksEvent,
  StackView,
} from 'src/stacks/stacks.types'

async function setup() {
  const docker = new FakeDocker()
  const registry = new FakeRegistry()
  const runner = new FakeRunner()
  const activity = new FakeActivity()
  const moduleRef = await Test.createTestingModule({
    providers: [
      StacksService,
      { provide: DockerEngineService, useValue: docker },
      { provide: RegistryService, useValue: registry },
      { provide: ComposeRunnerService, useValue: runner },
      { provide: HostActivityService, useValue: activity },
    ],
  }).compile()
  return {
    docker,
    registry,
    runner,
    activity,
    stacks: moduleRef.get(StacksService),
  }
}

function at<T>(items: T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`no item at ${index}`)
  return item
}

function svc(views: StackView[], index: number): ServiceView {
  return at(at(views, 0).services, index)
}

const twoServices = () =>
  stack('dev:app:docker-compose.yml', 'app', [service('web'), service('db')])

describe('StacksService', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  describe('state derivation', () => {
    it('is absent when no container exists', async () => {
      const { registry, stacks } = await setup()
      registry.stacks = [twoServices()]

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('absent')
      expect(at(views, 0).services.every(s => s.container === undefined)).toBe(
        true,
      )
    })

    it('is stopped when containers exist but none run', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      docker.containers = [
        container('app-web-1', 'exited', composeLabels('app', 'web')),
        container('app-db-1', 'created', composeLabels('app', 'db')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('stopped')
    })

    it('is partial when only some services run', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
        container('app-db-1', 'exited', composeLabels('app', 'db')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('partial')
    })

    it('is partial when one service has no container at all', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('partial')
    })

    it('is running when every service runs', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
        container('app-db-1', 'running', composeLabels('app', 'db')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('running')
    })

    it('is busy, with the operation attached, while the runner has one', async () => {
      const { registry, docker, runner, stacks } = await setup()
      const s = twoServices()
      registry.stacks = [s]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
        container('app-db-1', 'running', composeLabels('app', 'db')),
      ]
      const op = operation(s.id)
      runner.operations.set(op.id, op)

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('busy')
      expect(at(views, 0).operation).toBe(op)
    })
  })

  describe('container matching', () => {
    it('matches by compose project and service labels', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [
          service('web', { containerName: 'custom-name' }),
        ]),
      ]
      docker.containers = [
        container('renamed-by-hand', 'running', composeLabels('app', 'web')),
        container('other-1', 'running', composeLabels('other', 'web')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).container?.name).toBe('renamed-by-hand')
    })

    it('falls back to the container name when labels do not match', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [
          service('web', { containerName: 'app-web-1' }),
        ]),
      ]
      docker.containers = [container('app-web-1', 'running')]

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).container?.name).toBe('app-web-1')
      expect(at(views, 0).state).toBe('running')
    })

    it('does not claim a same-named container from another project', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [service('web')]),
      ]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('elsewhere', 'web')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(at(views, 0).state).toBe('absent')
    })

    it('inspects running containers so health shows up', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [service('web')]),
      ]
      const listed = container(
        'app-web-1',
        'running',
        composeLabels('app', 'web'),
      )
      docker.containers = [listed]
      docker.inspected.set(listed.id, {
        ...listed,
        health: 'healthy',
        startedAt: '2026-10-19T00:00:00.000Z',
      })

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).container?.health).toBe('healthy')
    })

    it('does not fetch stats for stopped containers', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [service('web')]),
      ]
      docker.containers = [
        container('app-web-1', 'exited', composeLabels('app', 'web')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).stats).toBeUndefined()
    })
  })

  describe('stats', () => {
    it('attaches stats and sums host memory over running containers', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
        container('app-db-1', 'running', composeLabels('app', 'db')),
      ]

      const { stacks: views, host } = await stacks.overview()

      expect(svc(views, 0).stats?.memoryBytes).toBe(100)
      expect(host.containers).toBe(2)
      expect(host.memoryBytes).toBe(200)
      expect(Number.isNaN(Date.parse(host.generatedAt))).toBe(false)
    })

    it('tolerates a failed stats call', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      const web = container('app-web-1', 'running', composeLabels('app', 'web'))
      docker.containers = [
        web,
        container('app-db-1', 'running', composeLabels('app', 'db')),
      ]
      docker.failStatsFor.add(web.id)

      const { stacks: views, host } = await stacks.overview()

      expect(at(views, 0).state).toBe('running')
      expect(svc(views, 0).container?.name).toBe('app-web-1')
      expect(svc(views, 0).stats).toBeUndefined()
      expect(svc(views, 1).stats).toBeDefined()
      expect(host.memoryBytes).toBe(100)
    })
  })

  describe('reap estimate', () => {
    const idleReap = { enabled: true, maxIdleHours: 3, reason: 'auto' as const }

    it('asks activity for each route host with the service maxIdleHours', async () => {
      const { registry, docker, activity, stacks } = await setup()
      const startedAt = new Date(Date.now() - 3_600_000).toISOString()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [
          service('web', {
            idleReap,
            routes: [route('a.dev.lilnas.io'), route('b.dev.lilnas.io')],
          }),
        ]),
      ]
      const web = container('app-web-1', 'running', composeLabels('app', 'web'))
      docker.containers = [web]
      docker.inspected.set(web.id, { ...web, startedAt })
      for (const host of ['a.dev.lilnas.io', 'b.dev.lilnas.io']) {
        activity.results.set(host, {
          host,
          windowHours: 3,
          activeUsers: 0,
          lastVisitAt: null,
        })
      }

      const { stacks: views } = await stacks.overview()

      expect(activity.calls).toEqual([
        { host: 'a.dev.lilnas.io', hours: 3 },
        { host: 'b.dev.lilnas.io', hours: 3 },
      ])
      const { reap } = svc(views, 0)
      expect(reap.basis).toBe('container-start')
      expect(reap.maxIdleHours).toBe(3)
      expect(reap.reapsAt).toBeDefined()
    })

    it('is unknown when an activity lookup fails', async () => {
      const { registry, docker, stacks } = await setup()
      const startedAt = new Date().toISOString()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [
          service('web', { idleReap, routes: [route('a.dev.lilnas.io')] }),
        ]),
      ]
      const web = container('app-web-1', 'running', composeLabels('app', 'web'))
      docker.containers = [web]
      docker.inspected.set(web.id, { ...web, startedAt })

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).reap.basis).toBe('unknown')
    })

    it('is disabled, and skips activity, when idle reap is off', async () => {
      const { registry, docker, activity, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [
          service('web', { routes: [route('a.dev.lilnas.io')] }),
        ]),
      ]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).reap.basis).toBe('disabled')
      expect(activity.calls).toEqual([])
    })

    it('has no times for a stopped service', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [
        stack('dev:app:docker-compose.yml', 'app', [
          service('web', { idleReap, routes: [route('a.dev.lilnas.io')] }),
        ]),
      ]
      docker.containers = [
        container('app-web-1', 'exited', composeLabels('app', 'web')),
      ]

      const { stacks: views } = await stacks.overview()

      expect(svc(views, 0).reap.reapsAt).toBeUndefined()
      expect(svc(views, 0).reap.basis).toBe('unknown')
    })
  })

  describe('get', () => {
    it('returns undefined for an unknown id', async () => {
      const { stacks } = await setup()

      await expect(stacks.get('nope')).resolves.toBeUndefined()
    })

    it('builds one view, filtering containers by the project label', async () => {
      const { registry, docker, stacks } = await setup()
      registry.stacks = [twoServices()]
      docker.containers = [
        container('app-web-1', 'running', composeLabels('app', 'web')),
      ]

      const view = await stacks.get('dev:app:docker-compose.yml')

      expect(view?.state).toBe('partial')
      expect(docker.listCalls.at(-1)).toEqual([
        'com.docker.compose.project=app',
      ])
    })
  })

  describe('changes', () => {
    async function collect() {
      jest.useFakeTimers()
      const ctx = await setup()
      ctx.registry.stacks = [
        stack('lilnas:one', 'one', [service('web')]),
        stack('dev:two:a.yml', 'two', [service('web')]),
        stack('dev:two:b.yml', 'two', [service('web')]),
      ]
      const emitted: StacksEvent[] = []
      const sub = ctx.stacks.changes().subscribe(e => emitted.push(e))
      return { ...ctx, emitted, sub }
    }

    it('debounces a burst into one event with the distinct stack ids', async () => {
      const { docker, emitted, sub } = await collect()

      docker.events$.next(dockerEvent('one'))
      docker.events$.next(dockerEvent('one'))
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS - 100)
      docker.events$.next(dockerEvent('two'))
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS - 100)
      expect(emitted).toEqual([])

      await jest.advanceTimersByTimeAsync(100)

      expect(emitted).toEqual([
        {
          type: 'stacks-changed',
          stackIds: ['lilnas:one', 'dev:two:a.yml', 'dev:two:b.yml'],
        },
      ])
      sub.unsubscribe()
    })

    it('emits a separate event for a later burst', async () => {
      const { docker, emitted, sub } = await collect()

      docker.events$.next(dockerEvent('one'))
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS)
      docker.events$.next(dockerEvent('two'))
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS)

      expect(emitted).toEqual([
        { type: 'stacks-changed', stackIds: ['lilnas:one'] },
        {
          type: 'stacks-changed',
          stackIds: ['dev:two:a.yml', 'dev:two:b.yml'],
        },
      ])
      sub.unsubscribe()
    })

    it('ignores events from projects that are not discovered stacks', async () => {
      const { docker, emitted, sub } = await collect()

      docker.events$.next(dockerEvent('lilnas'))
      docker.events$.next(dockerEvent(undefined))
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS * 2)

      expect(emitted).toEqual([])
      sub.unsubscribe()
    })

    it('stops the pending flush once unsubscribed', async () => {
      const { docker, emitted, sub } = await collect()

      docker.events$.next(dockerEvent('one'))
      await jest.advanceTimersByTimeAsync(10)
      sub.unsubscribe()
      await jest.advanceTimersByTimeAsync(EVENT_DEBOUNCE_MS * 2)

      expect(emitted).toEqual([])
      expect(docker.events$.observed).toBe(false)
    })
  })
})
