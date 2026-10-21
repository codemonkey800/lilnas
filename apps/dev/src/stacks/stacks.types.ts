import type { ReapEstimate } from 'src/activity/host-activity.service'
import type { Operation } from 'src/compose/compose.types'
import type {
  ContainerStats,
  ContainerSummary,
} from 'src/docker/docker-engine.service'
import type { Stack, StackService } from 'src/registry/registry.types'

export type StackState = 'running' | 'partial' | 'stopped' | 'absent' | 'busy'

export interface ServiceView extends StackService {
  container?: ContainerSummary
  stats?: ContainerStats
  reap: ReapEstimate
}

export interface StackView extends Omit<Stack, 'services'> {
  state: StackState
  services: ServiceView[]
  operation?: Operation
}

export interface Overview {
  stacks: StackView[]
  host: { containers: number; memoryBytes: number; generatedAt: string }
}

export type StacksEvent =
  { type: 'stacks-changed'; stackIds: string[] } | { type: 'keepalive' }
