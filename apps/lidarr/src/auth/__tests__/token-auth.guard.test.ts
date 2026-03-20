import { TokenClient } from '@lilnas/token-client'
import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { TOKEN_CLIENT } from 'src/auth/auth.constants'
import { TokenAuthGuard } from 'src/auth/token-auth.guard'

function makeContext(
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext
}

describe('TokenAuthGuard', () => {
  let guard: TokenAuthGuard
  let mockTokenClient: jest.Mocked<Pick<TokenClient, 'validate'>>

  beforeEach(async () => {
    mockTokenClient = {
      validate: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenAuthGuard,
        { provide: TOKEN_CLIENT, useValue: mockTokenClient },
      ],
    }).compile()

    guard = module.get(TokenAuthGuard)
  })

  it('throws UnauthorizedException when x-token-value header is missing', async () => {
    const ctx = makeContext({})
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    expect(mockTokenClient.validate).not.toHaveBeenCalled()
  })

  it('throws UnauthorizedException when x-token-value header is empty string', async () => {
    const ctx = makeContext({ 'x-token-value': '' })
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    expect(mockTokenClient.validate).not.toHaveBeenCalled()
  })

  it('throws UnauthorizedException when token is invalid', async () => {
    mockTokenClient.validate.mockResolvedValue(false)
    const ctx = makeContext({ 'x-token-value': 'bad-token' })
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    expect(mockTokenClient.validate).toHaveBeenCalledWith('lidarr', 'bad-token')
  })

  it('returns true when token is valid', async () => {
    mockTokenClient.validate.mockResolvedValue(true)
    const ctx = makeContext({ 'x-token-value': 'valid-token' })
    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(mockTokenClient.validate).toHaveBeenCalledWith(
      'lidarr',
      'valid-token',
    )
  })
})
