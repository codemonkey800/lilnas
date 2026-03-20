import { TokenClient } from '@lilnas/token-client'
import { env } from '@lilnas/utils/env'
import { Module } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import { TOKEN_CLIENT } from './auth.constants'
import { TokenAuthGuard } from './token-auth.guard'

@Module({
  providers: [
    {
      provide: TOKEN_CLIENT,
      useFactory: () =>
        new TokenClient({ baseUrl: env(EnvKeys.TOKEN_SERVICE_URL) }),
    },
    TokenAuthGuard,
  ],
  exports: [TOKEN_CLIENT, TokenAuthGuard],
})
export class AuthModule {}
