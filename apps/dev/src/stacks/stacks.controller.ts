import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  type MessageEvent,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common'
import { map, merge, Observable, timer } from 'rxjs'

import {
  ACTION_ARGS,
  type Operation,
  PreflightError,
  type StackAction,
  StackBusyError,
} from 'src/compose/compose.types'
import { ComposeRunnerService } from 'src/compose/compose-runner.service'
import { DockerEngineService } from 'src/docker/docker-engine.service'
import { RegistryService } from 'src/registry/registry.service'
import { StacksService } from 'src/stacks/stacks.service'
import type { Overview, StackView } from 'src/stacks/stacks.types'

export const KEEPALIVE_MS = 25_000
export const DEFAULT_TAIL = 200
export const MAX_TAIL = 5000

function isStackAction(action: string): action is StackAction {
  return Object.hasOwn(ACTION_ARGS, action)
}

function parseTail(raw: unknown): number {
  const tail = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN
  if (Number.isNaN(tail)) return DEFAULT_TAIL
  return Math.min(Math.max(tail, 1), MAX_TAIL)
}

function parseFlag(raw: unknown): boolean {
  return raw === '1' || raw === 'true'
}

// Every message carries an explicit, per-connection incrementing id. Nest's
// own fallback starts from null and renders "NaN" forever (see
// apps/auth/src/sse/sse.controller.ts). Payloads go out as unnamed events,
// with the discriminator inside `data`, so `EventSource.onmessage` sees them.
function withIds<T extends object>(source: Observable<T>) {
  let nextId = 0
  return source.pipe(
    map((data): MessageEvent => ({ data, id: String(nextId++) })),
  )
}

@Controller()
export class StacksController {
  constructor(
    private readonly stacks: StacksService,
    private readonly registry: RegistryService,
    private readonly runner: ComposeRunnerService,
    private readonly docker: DockerEngineService,
  ) {}

  @Get('stacks')
  overview(): Promise<Overview> {
    return this.stacks.overview()
  }

  @Get('stacks/:id')
  async stack(@Param('id') id: string): Promise<StackView> {
    const view = await this.stacks.get(id)
    if (!view) throw new NotFoundException(`Unknown stack: ${id}`)
    return view
  }

  @Post('stacks/:id/actions/:action')
  @HttpCode(HttpStatus.ACCEPTED)
  async act(
    @Param('id') id: string,
    @Param('action') action: string,
    @Headers('x-forwarded-user') actor?: string,
  ): Promise<{ operation: Operation }> {
    if (!isStackAction(action)) {
      throw new BadRequestException(`Unknown action: ${action}`)
    }
    // Only a stack the registry discovered may reach the runner.
    const stack = await this.registry.get(id)
    if (!stack) throw new NotFoundException(`Unknown stack: ${id}`)

    try {
      return { operation: this.runner.start(stack, action, actor || undefined) }
    } catch (err) {
      if (err instanceof StackBusyError) {
        throw new ConflictException({
          operation: this.runner.get(err.operationId),
        })
      }
      if (err instanceof PreflightError) {
        throw new HttpException(
          { missing: err.missing },
          HttpStatus.PRECONDITION_FAILED,
        )
      }
      throw err
    }
  }

  @Get('operations/:opId')
  operation(@Param('opId') opId: string): Operation {
    const operation = this.runner.get(opId)
    if (!operation) throw new NotFoundException(`Unknown operation: ${opId}`)
    return operation
  }

  @Sse('operations/:opId/stream')
  operationStream(@Param('opId') opId: string): Observable<MessageEvent> {
    if (!this.runner.get(opId)) {
      throw new NotFoundException(`Unknown operation: ${opId}`)
    }
    return withIds(this.runner.stream(opId))
  }

  @Sse('containers/:name/logs')
  async logs(
    @Param('name') name: string,
    @Query('tail') tail?: string,
    @Query('timestamps') timestamps?: string,
  ): Promise<Observable<MessageEvent>> {
    // Never stream a container that is not part of a discovered stack.
    const match = await this.registry.findByContainerName(name)
    if (!match) throw new NotFoundException(`Unknown container: ${name}`)

    return withIds(
      this.docker.logs(match.service.containerName, {
        tail: parseTail(tail),
        timestamps: parseFlag(timestamps),
        follow: true,
      }),
    )
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    const keepalive$ = timer(KEEPALIVE_MS, KEEPALIVE_MS).pipe(
      map((): { type: 'keepalive' } => ({ type: 'keepalive' })),
    )
    return withIds(merge(this.stacks.changes(), keepalive$))
  }
}
