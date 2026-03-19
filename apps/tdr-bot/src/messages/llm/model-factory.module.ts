import { Module } from '@nestjs/common'

import { StateModule } from 'src/state/state.module'

import { ModelFactoryService } from './model-factory.service'

/** Provides and exports {@link ModelFactoryService} for LLM model creation. */
@Module({
  imports: [StateModule],
  providers: [ModelFactoryService],
  exports: [ModelFactoryService],
})
export class ModelFactoryModule {}
