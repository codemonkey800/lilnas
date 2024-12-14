import { Module } from '@nestjs/common'

import { StateModule } from 'src/state/state.module'

import { ApiController } from './api.controller'

@Module({
  controllers: [ApiController],
  imports: [StateModule],
})
export class ApiModule {}
