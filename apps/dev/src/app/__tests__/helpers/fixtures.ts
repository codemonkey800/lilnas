import type { ReapEstimate } from 'src/activity/host-activity.service'
import type { Operation } from 'src/compose/compose.types'
import type {
  ContainerState,
  ContainerSummary,
} from 'src/docker/docker-engine.service'
import type { Route, StackService } from 'src/registry/registry.types'
import type {
  Overview,
  ServiceView,
  StackState,
  StackView,
} from 'src/stacks/stacks.types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** `ms` ago, plus half a minute so a formatted minute can't flip mid-test. */
export const ago = (ms: number) =>
  new Date(Date.now() - ms - MINUTE / 2).toISOString()

/** `ms` from now, plus half a minute for the same reason. */
export const fromNow = (ms: number) =>
  new Date(Date.now() + ms + MINUTE / 2).toISOString()

export function route(host: string, gated = true): Route {
  return { router: host, host, url: `https://${host}`, gated }
}

export function reaping(inMs: number): ReapEstimate {
  return {
    enabled: true,
    maxIdleHours: 2,
    reapsAt: fromNow(inMs),
    activeUsers: 0,
    basis: 'auth',
  }
}

const EXEMPT: ReapEstimate = {
  enabled: false,
  maxIdleHours: 2,
  basis: 'disabled',
}

export { EXEMPT as exempt }

export function container(
  name: string,
  state: ContainerState,
  overrides: Partial<ContainerSummary> = {},
): ContainerSummary {
  return {
    id: `id-${name}`,
    name,
    state,
    status: state,
    image: 'img',
    labels: {},
    tty: false,
    ports: [],
    ...overrides,
  }
}

export function service(
  name: string,
  containerName: string,
  view: Partial<ServiceView> = {},
  base: Partial<StackService> = {},
): ServiceView {
  return {
    name,
    containerName,
    routes: [],
    idleReap: { enabled: true, maxIdleHours: 2, reason: 'auto' },
    loopbackPorts: [],
    reap: { enabled: true, maxIdleHours: 2, basis: 'unknown' },
    ...base,
    ...view,
  }
}

/** A running, healthy container with stats and a reap estimate. */
export function runningService(
  name: string,
  containerName: string,
  view: Partial<ServiceView> = {},
): ServiceView {
  return service(name, containerName, {
    container: container(containerName, 'running', {
      health: 'healthy',
      startedAt: ago(3 * HOUR + 12 * MINUTE),
    }),
    stats: {
      cpuPercent: 4.2,
      memoryBytes: 612 * 1024 * 1024,
      memoryLimitBytes: 0,
    },
    reap: reaping(HOUR + 20 * MINUTE),
    ...view,
  })
}

export function stack(
  id: string,
  name: string,
  state: StackState,
  services: ServiceView[],
  overrides: Partial<StackView> = {},
): StackView {
  const source = id.startsWith('lilnas:') ? 'lilnas' : 'dev'
  return {
    id,
    source,
    name,
    composeFile:
      source === 'lilnas'
        ? `/home/jeremy/lilnas/apps/${name}/deploy.dev.yml`
        : `/home/jeremy/dev/${name}/docker-compose.yml`,
    projectDir: `/home/jeremy/dev/${name}`,
    projectName: name,
    composeArgs: ['-p', name],
    services,
    envFiles: [],
    warnings: [],
    state,
    ...overrides,
  }
}

export function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: 'op-1',
    stackId: 'dev:blabla:docker-compose.yml',
    action: 'up',
    status: 'running',
    startedAt: ago(14_000),
    command: ['docker', 'compose', 'up', '-d'],
    lines: [],
    ...overrides,
  }
}

export function overview(stacks: StackView[]): Overview {
  return {
    stacks,
    host: {
      containers: stacks
        .flatMap(s => s.services)
        .filter(s => s.container?.state === 'running').length,
      memoryBytes: 2.4 * 1024 ** 3,
      generatedAt: new Date().toISOString(),
    },
  }
}

/** The mockup's sample data: one stack in every state the card can be in. */
export const IDS = {
  running: 'lilnas:download',
  unhealthy: 'dev:fitness-pwa:docker-compose.yml',
  exited: 'dev:test-landing-page:docker-compose.yml',
  absent: 'dev:gooncut:docker-compose.yml',
  busy: 'dev:blabla:docker-compose.yml',
  envMissing: 'lilnas:tdr-bot',
} as const

export function sampleOverview(): Overview {
  return overview([
    stack(IDS.running, 'download', 'running', [
      runningService('download-dev', 'lilnas-download-dev', {
        routes: [route('download.dev.lilnas.io')],
      }),
    ]),
    stack(
      IDS.envMissing,
      'tdr-bot',
      'absent',
      [service('tdr-bot-dev', 'lilnas-tdr-bot-dev')],
      {
        envFiles: [
          {
            path: '/home/jeremy/lilnas/apps/tdr-bot/.env.prod.decrypted',
            required: true,
            exists: false,
          },
        ],
      },
    ),
    stack(IDS.unhealthy, 'fitness-pwa', 'partial', [
      runningService('web', 'fitness-pwa-web-1', {
        routes: [route('flexecute.dev.lilnas.io')],
      }),
      runningService('api', 'fitness-pwa-api-1', {
        routes: [route('api-flexecute.dev.lilnas.io', false)],
        container: container('fitness-pwa-api-1', 'running', {
          health: 'unhealthy',
          startedAt: ago(2 * HOUR),
        }),
        reap: { enabled: true, maxIdleHours: 2, basis: 'unknown' },
      }),
      service('migrate', 'fitness-pwa-migrate-1', {
        container: container('fitness-pwa-migrate-1', 'exited', {
          exitCode: 0,
          finishedAt: ago(2 * HOUR),
        }),
      }),
    ]),
    stack(IDS.exited, 'test-landing-page', 'stopped', [
      service('web', 'test-landing-page-web-1', {
        routes: [route('test-landing-page.dev.lilnas.io', false)],
        container: container('test-landing-page-web-1', 'exited', {
          exitCode: 1,
          finishedAt: ago(14 * MINUTE),
        }),
      }),
    ]),
    stack(IDS.absent, 'GoonCut', 'absent', [
      service('web', 'gooncut-web-1', {
        routes: [route('gooncut.dev.lilnas.io')],
      }),
    ]),
    stack(
      IDS.busy,
      'blabla',
      'busy',
      [
        service('web', 'blabla-web-1', {
          container: container('blabla-web-1', 'created'),
        }),
      ],
      {
        operation: operation({
          lines: [
            {
              stream: 'stderr',
              text: 'Container blabla-web-1  Starting',
              ts: new Date().toISOString(),
            },
          ],
        }),
      },
    ),
    stack('dev:hop-road:docker-compose.yml', 'hop-road', 'running', [
      runningService('web', 'hop-road-web-1', {
        reap: EXEMPT,
        routes: [route('rocky-roads.lilnas.io')],
      }),
    ]),
    stack('dev:url-shortener:docker-compose.yml', 'url-shortener', 'running', [
      runningService('web', 'url-shortener-web-1', {
        reap: {
          enabled: true,
          maxIdleHours: 2,
          basis: 'auth',
          activeUsers: 1,
        },
      }),
    ]),
  ])
}
