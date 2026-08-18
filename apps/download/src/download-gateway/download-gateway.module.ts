import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'

import { DownloadGateway } from './download.gateway'

// AuthModule has no dependency back on this module, so this is a plain
// import — unlike the DownloadModule <-> MediaModule forwardRef() pair, this
// introduces no cycle. Needed for AdminCheckService, which
// DownloadGateway.handleConnection() uses to resolve a connecting client's
// admin status.
@Module({
  imports: [AuthModule],
  providers: [DownloadGateway],
  exports: [DownloadGateway],
})
export class DownloadGatewayModule {}
