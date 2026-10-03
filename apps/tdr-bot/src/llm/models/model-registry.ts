import { Injectable } from '@nestjs/common'

import { MODEL_CATALOG, ModelSpec } from 'src/llm/models/catalog'
import { ModelRole } from 'src/llm/models/roles'

export class UnknownModelError extends Error {
  constructor(readonly modelId: string) {
    super(`Unknown model: ${modelId}`)
    this.name = 'UnknownModelError'
  }
}

export interface ModelUsage {
  input: number
  output: number
  cached?: number
}

@Injectable()
export class ModelRegistry {
  private readonly byId = new Map<string, ModelSpec>(
    MODEL_CATALOG.map(spec => [spec.id, spec]),
  )

  list(role?: ModelRole): ModelSpec[] {
    return MODEL_CATALOG.filter(spec => !role || spec.roles.includes(role))
  }

  get(id: string): ModelSpec {
    const spec = this.byId.get(id)
    if (!spec) throw new UnknownModelError(id)
    return spec
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  isAllowedFor(id: string, role: ModelRole): boolean {
    return this.byId.get(id)?.roles.includes(role) ?? false
  }

  /** `usage.input` includes cached tokens, matching OpenAI's usage reporting. */
  costUsd(id: string, usage: ModelUsage): number {
    const { pricing } = this.get(id)
    if (!pricing) return 0
    const cached = Math.min(usage.cached ?? 0, usage.input)
    const cachedRate = pricing.cachedInputPer1M ?? pricing.inputPer1M
    return (
      ((usage.input - cached) * pricing.inputPer1M +
        cached * cachedRate +
        usage.output * pricing.outputPer1M) /
      1_000_000
    )
  }
}
