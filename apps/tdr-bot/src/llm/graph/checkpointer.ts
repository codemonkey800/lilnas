import { BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import {
  FactoryProvider,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common'

import { DrizzleService } from 'src/db/drizzle.service'

export const GRAPH_CHECKPOINTER = Symbol('GRAPH_CHECKPOINTER')

/** Tests and `GRAPH_CHECKPOINTER=memory` (graph-test) run without Postgres. */
function useMemoryCheckpointer(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.GRAPH_CHECKPOINTER === 'memory'
  )
}

/** Postgres-backed checkpointer sharing the app's pool; in-memory when opted out. */
export const graphCheckpointerProvider: FactoryProvider<BaseCheckpointSaver> = {
  provide: GRAPH_CHECKPOINTER,
  useFactory: (drizzle?: DrizzleService) => {
    if (useMemoryCheckpointer() || !drizzle) {
      return new MemorySaver()
    }
    return new PostgresSaver(drizzle.pool)
  },
  inject: [{ token: DrizzleService, optional: true }],
}

/** Creates the checkpoint tables on boot (idempotent). */
@Injectable()
export class GraphCheckpointerSetup implements OnModuleInit {
  private readonly logger = new Logger(GraphCheckpointerSetup.name)

  constructor(
    @Inject(GRAPH_CHECKPOINTER) private readonly saver: BaseCheckpointSaver,
  ) {}

  async onModuleInit() {
    if (this.saver instanceof PostgresSaver) {
      await this.saver.setup()
      this.logger.log({}, 'Graph checkpoint tables ready')
    }
  }
}
