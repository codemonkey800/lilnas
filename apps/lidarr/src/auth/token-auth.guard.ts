import { TokenClient } from '@lilnas/token-client'
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common'

import { TOKEN_CLIENT } from './auth.constants'

@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_CLIENT) private readonly tokenClient: TokenClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>()
    const headers = req['headers'] as Record<string, string | undefined>
    const tokenValue = headers['x-token-value']
    if (!tokenValue) return false
    return this.tokenClient.validate('lidarr', tokenValue)
  }
}
