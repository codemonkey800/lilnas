import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import { ImmichClient } from './immich.client'
import { ImmichProvisioner } from './immich.provisioner'
import { IMMICH_OPTIONS, ImmichOptions } from './immich.types'

@Module({
  providers: [
    {
      provide: IMMICH_OPTIONS,
      useFactory: (): ImmichOptions => ({
        baseUrl: env(EnvKeys.IMMICH_URL, 'http://immich:2283'),
        // Empty when unset: the client refuses to call Immich without a key.
        apiKey: env(EnvKeys.IMMICH_API_KEY, ''),
        importRoot: env(EnvKeys.IMMICH_IMPORT_ROOT, '/icloud-users'),
        photosRoot: env(EnvKeys.PHOTOS_ROOT, '/photos'),
      }),
    },
    ImmichClient,
    ImmichProvisioner,
  ],
  exports: [ImmichClient, ImmichProvisioner],
})
export class ImmichModule {}
