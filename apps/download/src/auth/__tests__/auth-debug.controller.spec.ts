import { AdminCheckService } from 'src/auth/admin-check.service'
import { AuthDebugController } from 'src/auth/auth-debug.controller'

describe('AuthDebugController', () => {
  it('whoami returns the forwarded identity plus isAdmin', async () => {
    const mockAdminCheckService = {
      checkIsAdmin: jest.fn().mockResolvedValue(true),
    } as unknown as AdminCheckService
    const controller = new AuthDebugController(mockAdminCheckService)

    await expect(
      controller.whoami({ email: 'alice@example.com', userId: 'user_1' }),
    ).resolves.toEqual({
      email: 'alice@example.com',
      userId: 'user_1',
      isAdmin: true,
    })
  })
})
