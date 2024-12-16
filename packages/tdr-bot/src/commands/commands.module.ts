import { Module } from '@nestjs/common'

import { CommandsService } from './command.service'

@Module({
  providers: [CommandsService],
})
export class CommandsModule {}
