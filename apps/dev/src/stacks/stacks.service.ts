import { Injectable, Logger } from '@nestjs/common'
import { Observable, repeat, retry } from 'rxjs'

import {
  estimateReap,
  HostActivityService,
} from 'src/activity/host-activity.service'
import { ComposeRunnerService } from 'src/compose/compose-runner.service'
import {
  ContainerSummary,
  DockerEngineService,
} from 'src/docker/docker-engine.service'
import { RegistryService } from 'src/registry/registry.service'
import type { Stack, StackService } from 'src/registry/registry.types'
import type {
  Overview,
  ServiceView,
  StacksEvent,
  StackState,
  StackView,
} from 'src/stacks/stacks.types'

const PROJECT_LABEL = 'com.docker.compose.project'
const SERVICE_LABEL = 'com.docker.compose.service'

export const EVENT_DEBOUNCE_MS = 500
const EVENTS_RESUBSCRIBE_MS = 2000

type StacksChanged = Extract<StacksEvent, { type: 'stacks-changed' }>

// Label match first, then the container name. A container that belongs to a
// different compose project is never claimed by name.
function matchContainer(
  stack: Stack,
  service: StackService,
  containers: ContainerSummary[],
): ContainerSummary | undefined {
  const byLabels = containers.find(
    c =>
      c.labels[PROJECT_LABEL] === stack.projectName &&
      c.labels[SERVICE_LABEL] === service.name,
  )
  if (byLabels) return byLabels

  return containers.find(c => {
    const project = c.labels[PROJECT_LABEL]
    return (
      c.name === service.containerName &&
      (project === undefined || project === stack.projectName)
    )
  })
}

function deriveState(
  services: { container?: ContainerSummary }[],
  busy: boolean,
): StackState {
  if (busy) return 'busy'
  const existing = services.filter(s => s.container).length
  if (existing === 0) return 'absent'
  const running = services.filter(s => s.container?.state === 'running').length
  if (running === 0) return 'stopped'
  return running === services.length ? 'running' : 'partial'
}

@Injectable()
export class StacksService {
  private readonly logger = new Logger(StacksService.name)

  constructor(
    private readonly docker: DockerEngineService,
    private readonly registry: RegistryService,
    private readonly runner: ComposeRunnerService,
    private readonly activity: HostActivityService,
  ) {}

  async overview(): Promise<Overview> {
    const [stacks, containers] = await Promise.all([
      this.registry.list(),
      this.docker.listContainers([PROJECT_LABEL]),
    ])
    const views = await Promise.all(
      stacks.map(stack => this.buildView(stack, containers)),
    )

    const running = views
      .flatMap(view => view.services)
      .filter(service => service.container?.state === 'running')
    return {
      stacks: views,
      host: {
        containers: running.length,
        memoryBytes: running.reduce(
          (total, service) => total + (service.stats?.memoryBytes ?? 0),
          0,
        ),
        generatedAt: new Date().toISOString(),
      },
    }
  }

  async get(id: string): Promise<StackView | undefined> {
    const stack = await this.registry.get(id)
    if (!stack) return undefined
    const containers = await this.docker.listContainers([
      `${PROJECT_LABEL}=${stack.projectName}`,
    ])
    return this.buildView(stack, containers)
  }

  // Emits the ids of the discovered stacks whose containers changed,
  // coalescing a burst of Docker events into one emission.
  changes(): Observable<StacksChanged> {
    return new Observable<StacksChanged>(subscriber => {
      const pending = new Set<string>()
      let timer: NodeJS.Timeout | undefined
      let chain = Promise.resolve()

      const flush = () => {
        timer = undefined
        if (pending.size === 0) return
        const stackIds = [...pending]
        pending.clear()
        subscriber.next({ type: 'stacks-changed', stackIds })
      }

      // Docker's stream ends whenever the daemon restarts, so follow it again.
      const subscription = this.docker
        .events()
        .pipe(
          repeat({ delay: EVENTS_RESUBSCRIBE_MS }),
          retry({
            delay: err => {
              this.logger.warn({ msg: 'docker events stream failed', err })
              return new Observable<void>(retrySubscriber => {
                const handle = setTimeout(() => {
                  retrySubscriber.next()
                  retrySubscriber.complete()
                }, EVENTS_RESUBSCRIBE_MS)
                return () => clearTimeout(handle)
              })
            },
          }),
        )
        .subscribe(event => {
          const project = event.labels[PROJECT_LABEL]
          if (!project) return
          // Registry lookups are async; chain them so ids keep event order.
          chain = chain
            .then(async () => {
              const stacks = await this.registry.list()
              const matched = stacks.filter(s => s.projectName === project)
              if (matched.length === 0) return
              matched.forEach(s => pending.add(s.id))
              clearTimeout(timer)
              timer = setTimeout(flush, EVENT_DEBOUNCE_MS)
            })
            .catch(err =>
              this.logger.warn({ msg: 'stack lookup for event failed', err }),
            )
        })

      return () => {
        subscription.unsubscribe()
        clearTimeout(timer)
        pending.clear()
      }
    })
  }

  private async buildView(
    stack: Stack,
    containers: ContainerSummary[],
  ): Promise<StackView> {
    const services = await Promise.all(
      stack.services.map(service =>
        this.buildService(service, matchContainer(stack, service, containers)),
      ),
    )
    const operation = this.runner.runningFor(stack.id)

    return {
      ...stack,
      state: deriveState(services, operation !== undefined),
      services,
      operation,
    }
  }

  private async buildService(
    service: StackService,
    matched: ContainerSummary | undefined,
  ): Promise<ServiceView> {
    const { idleReap } = service
    if (matched?.state !== 'running') {
      return {
        ...service,
        container: matched,
        reap: estimateReap(idleReap, undefined, []),
      }
    }

    // Health and startedAt only come from inspect; stats may be unavailable.
    const [inspected, stats] = await Promise.all([
      this.docker.inspect(matched.id).catch(() => null),
      this.docker.stats(matched.id).catch((): undefined => undefined),
    ])
    const container = inspected ?? matched

    // The reaper only acts on enabled services, so don't ask auth otherwise.
    const hosts = idleReap.enabled
      ? [...new Set(service.routes.map(route => route.host))]
      : []
    const activities = await Promise.all(
      hosts.map(host => this.activity.get(host, idleReap.maxIdleHours)),
    )

    return {
      ...service,
      container,
      stats,
      reap: estimateReap(idleReap, container.startedAt, activities),
    }
  }
}
