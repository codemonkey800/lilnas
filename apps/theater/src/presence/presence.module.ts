import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'

import { PresenceGateway } from './presence.gateway'

@Module({
  imports: [AuthModule],
  providers: [PresenceGateway],
})
export class PresenceModule {}
