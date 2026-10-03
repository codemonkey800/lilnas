import { MemorySaver } from '@langchain/langgraph'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'

import { DrizzleService } from 'src/db/drizzle.service'
import {
  GRAPH_CHECKPOINTER,
  graphCheckpointerProvider,
  GraphCheckpointerSetup,
} from 'src/llm/graph/checkpointer'

type Factory = (drizzle?: DrizzleService) => unknown
const factory = graphCheckpointerProvider.useFactory as Factory
const fakeDrizzle = { pool: {} } as unknown as DrizzleService

describe('graphCheckpointerProvider', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('provides the GRAPH_CHECKPOINTER token', () => {
    expect(graphCheckpointerProvider.provide).toBe(GRAPH_CHECKPOINTER)
  })

  it('uses MemorySaver under test', () => {
    expect(factory(fakeDrizzle)).toBeInstanceOf(MemorySaver)
  })

  it('uses MemorySaver when GRAPH_CHECKPOINTER=memory', () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    process.env.GRAPH_CHECKPOINTER = 'memory'
    expect(factory(fakeDrizzle)).toBeInstanceOf(MemorySaver)
  })

  it('uses PostgresSaver on the shared pool otherwise', () => {
    ;(process.env as Record<string, string>).NODE_ENV = 'production'
    delete process.env.GRAPH_CHECKPOINTER
    expect(factory(fakeDrizzle)).toBeInstanceOf(PostgresSaver)
  })
})

describe('GraphCheckpointerSetup', () => {
  it('runs setup() on a PostgresSaver at module init', async () => {
    const saver = Object.create(PostgresSaver.prototype) as PostgresSaver
    saver.setup = jest.fn().mockResolvedValue(undefined)

    await new GraphCheckpointerSetup(saver).onModuleInit()

    expect(saver.setup).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a MemorySaver', async () => {
    await expect(
      new GraphCheckpointerSetup(new MemorySaver()).onModuleInit(),
    ).resolves.toBeUndefined()
  })
})
