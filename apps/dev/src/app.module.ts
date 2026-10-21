import { Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'

import { ActivityModule } from './activity/activity.module'
import { ComposeModule } from './compose/compose.module'
import { DockerModule } from './docker/docker.module'
import { HealthModule } from './health/health.module'
import { RegistryModule } from './registry/registry.module'
import { StacksModule } from './stacks/stacks.module'

@Module({
  imports: [
    LoggerModule.forRoot(),
    HealthModule,
    DockerModule,
    RegistryModule,
    ComposeModule,
    ActivityModule,
    StacksModule,
  ],
})
export class AppModule {}
