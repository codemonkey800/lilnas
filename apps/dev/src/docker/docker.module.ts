import { Module } from '@nestjs/common'

import { DockerEngineService } from 'src/docker/docker-engine.service'

@Module({
  providers: [DockerEngineService],
  exports: [DockerEngineService],
})
export class DockerModule {}
