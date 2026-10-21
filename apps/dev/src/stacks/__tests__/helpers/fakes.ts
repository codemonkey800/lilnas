import { from, Observable, of, Subject, throwError } from 'rxjs'

import type { HostActivity } from 'src/activity/host-activity.service'
import {
  type Operation,
  type OpEvent,
  type Preflight,
  PreflightError,
  type RunnableStack,
  type StackAction,
  StackBusyError,
} from 'src/compose/compose.types'
import type {
  ContainerState,
  ContainerStats,
  ContainerSummary,
  DockerEvent,
  LogLine,
  LogOptions,
} from 'src/docker/docker-engine.service'
import type { Route, Stack, StackService } from 'src/registry/registry.types'

export function route(host: string): Route {
  return { router: host, host, url: `https://${host}`, gated: true }
}

export function service(
  name: string,
  overrides: Partial<StackService> = {},
): StackService {
  return {
    name,
    containerName: `app-${name}-1`,
    routes: [],
    idleReap: { enabled: false, maxIdleHours: 2, reason: 'none' },
    loopbackPorts: [],
    ...overrides,
  }
}

export function stack(
  id: string,
  projectName: string,
  services: StackService[],
  overrides: Partial<Stack> = {},
): Stack {
  return {
    id,
    source: 'dev',
    name: projectName,
    composeFile: `/dev/${projectName}/docker-compose.yml`,
    projectDir: `/dev/${projectName}`,
    projectName,
    composeArgs: ['-p', projectName],
    services,
    envFiles: [],
    warnings: [],
    ...overrides,
  }
}

export function container(
  name: string,
  state: ContainerState = 'running',
  labels: Record<string, string> = {},
): ContainerSummary {
  return {
    id: `id-${name}`,
    name,
    state,
    status: state,
    image: 'img',
    labels,
    tty: false,
    ports: [],
  }
}

export function composeLabels(project: string, svc: string) {
  return {
    'com.docker.compose.project': project,
    'com.docker.compose.service': svc,
  }
}

export class FakeDocker {
  containers: ContainerSummary[] = []
  inspected = new Map<string, ContainerSummary>()
  stats_ = new Map<string, ContainerStats>()
  failStatsFor = new Set<string>()
  readonly events$ = new Subject<DockerEvent>()
  readonly listCalls: (string[] | undefined)[] = []
  readonly logCalls: { id: string; opts: LogOptions }[] = []

  async listContainers(labelFilters?: string[]) {
    this.listCalls.push(labelFilters)
    return this.containers
  }

  async inspect(id: string) {
    return (
      this.inspected.get(id) ?? this.containers.find(c => c.id === id) ?? null
    )
  }

  async stats(id: string): Promise<ContainerStats> {
    if (this.failStatsFor.has(id)) throw new Error('stats failed')
    return (
      this.stats_.get(id) ?? {
        cpuPercent: 1,
        memoryBytes: 100,
        memoryLimitBytes: 1000,
      }
    )
  }

  logs(id: string, opts: LogOptions): Observable<LogLine> {
    this.logCalls.push({ id, opts })
    const lines: LogLine[] = [
      { stream: 'stdout', text: 'one' },
      { stream: 'stderr', text: 'two' },
    ]
    return from(lines)
  }

  events(): Observable<DockerEvent> {
    return this.events$
  }
}

export function dockerEvent(project: string | undefined): DockerEvent {
  return {
    action: 'start',
    id: 'abc',
    name: 'x',
    labels: project ? { 'com.docker.compose.project': project } : {},
    time: 1,
  }
}

export class FakeRegistry {
  stacks: Stack[] = []

  async list() {
    return this.stacks
  }

  async get(id: string) {
    return this.stacks.find(s => s.id === id)
  }

  async findByContainerName(name: string) {
    for (const s of this.stacks) {
      const svc = s.services.find(x => x.containerName === name)
      if (svc) return { stack: s, service: svc }
    }
    return undefined
  }
}

export function operation(
  stackId: string,
  overrides: Partial<Operation> = {},
): Operation {
  return {
    id: 'op-1',
    stackId,
    action: 'up',
    status: 'running',
    startedAt: new Date().toISOString(),
    command: ['docker', 'compose', 'up', '-d'],
    lines: [],
    ...overrides,
  }
}

export class FakeRunner {
  readonly operations = new Map<string, Operation>()
  readonly startCalls: {
    stack: RunnableStack
    action: StackAction
    actor?: string
  }[] = []
  missing: string[] = []
  events: OpEvent[] = []

  preflight(): Preflight {
    return { ok: this.missing.length === 0, missing: this.missing }
  }

  start(stack: RunnableStack, action: StackAction, actor?: string) {
    this.startCalls.push({ stack, action, actor })
    const running = this.runningFor(stack.id)
    if (running) throw new StackBusyError(stack.id, running.id)
    if (this.missing.length) throw new PreflightError(this.missing)
    const op = operation(stack.id, { id: 'op-new', action, actor })
    this.operations.set(op.id, op)
    return op
  }

  get(opId: string) {
    return this.operations.get(opId)
  }

  runningFor(stackId: string) {
    return [...this.operations.values()].find(
      o => o.stackId === stackId && o.status === 'running',
    )
  }

  stream(opId: string): Observable<OpEvent> {
    return this.operations.has(opId)
      ? of(...this.events)
      : throwError(() => new Error('not found'))
  }
}

export class FakeActivity {
  readonly calls: { host: string; hours: number }[] = []
  results = new Map<string, HostActivity | null>()

  async get(host: string, hours: number) {
    this.calls.push({ host, hours })
    return this.results.get(host) ?? null
  }
}
