import { TokenClient } from '@lilnas/token-client'
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'

import { TOKEN_CLIENT } from './auth.constants'

@Injectable()
export class TokenAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_CLIENT) private readonly tokenClient: TokenClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<true> {
    const req = context.switchToHttp().getRequest<Record<string, unknown>>()
    const headers = req['headers'] as Record<string, string | undefined>
    const tokenValue = headers['x-token-value']
    if (!tokenValue)
      throw new UnauthorizedException('Missing authentication token')
    const valid = await this.tokenClient.validate('lidarr', tokenValue)
    if (!valid) throw new UnauthorizedException('Invalid authentication token')
    return true
  }
}
