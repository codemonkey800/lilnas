import { Module } from '@nestjs/common'

import { ActivityModule } from 'src/activity/activity.module'
import { ComposeModule } from 'src/compose/compose.module'
import { DockerModule } from 'src/docker/docker.module'
import { RegistryModule } from 'src/registry/registry.module'
import { StacksController } from 'src/stacks/stacks.controller'
import { StacksService } from 'src/stacks/stacks.service'

@Module({
  imports: [DockerModule, RegistryModule, ComposeModule, ActivityModule],
  controllers: [StacksController],
  providers: [StacksService],
})
export class StacksModule {}
