import { Module } from '@nestjs/common'

import { ServicesModule } from 'src/services/services.module'
import { StateModule } from 'src/state/state.module'

import { ApiController } from './api.controller'

@Module({
  controllers: [ApiController],
  imports: [ServicesModule, StateModule],
})
export class ApiModule {}
