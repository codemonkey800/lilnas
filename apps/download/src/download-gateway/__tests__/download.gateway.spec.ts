import { Test, TestingModule } from '@nestjs/testing'
import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'

import { AdminCheckService } from 'src/auth/admin-check.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'

function createMockClient(
  readyState: number = WebSocket.OPEN,
): jest.Mocked<WebSocket> {
  return {
    readyState,
    send: jest.fn(),
  } as unknown as jest.Mocked<WebSocket>
}

function buildRequest(
  headers: Record<string, string | string[] | undefined> = {},
): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('DownloadGateway', () => {
  let gateway: DownloadGateway
  let adminCheckService: jest.Mocked<AdminCheckService>

  beforeEach(async () => {
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadGateway,
        { provide: AdminCheckService, useValue: mockAdminCheckService },
      ],
    }).compile()

    gateway = module.get<DownloadGateway>(DownloadGateway)
    adminCheckService = module.get(AdminCheckService)
  })

  describe('handleConnection / handleDisconnect', () => {
    it('tracks a client after handleConnection so it receives broadcasts', async () => {
      const client = createMockClient()

      gateway.handleConnection(client, buildRequest())
      await gateway.broadcastPerViewer(() => ({ type: 'ping' }))

      expect(client.send).toHaveBeenCalledTimes(1)
    })

    it('stops tracking a client after handleDisconnect', async () => {
      const client = createMockClient()

      gateway.handleConnection(client, buildRequest())
      gateway.handleDisconnect(client)
      await gateway.broadcastPerViewer(() => ({ type: 'ping' }))

      expect(client.send).not.toHaveBeenCalled()
    })

    it('is safe to disconnect a client that was never connected', () => {
      const client = createMockClient()

      expect(() => gateway.handleDisconnect(client)).not.toThrow()
    })

    it('registers a client with no identity as non-admin, without calling checkIsAdmin', async () => {
      const client = createMockClient()

      gateway.handleConnection(client, buildRequest())

      await gateway.broadcastPerViewer(isAdmin => ({
        type: 'x',
        data: { isAdmin },
      }))

      expect(client.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'x', data: { isAdmin: false } }),
      )
      expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
    })

    it('resolves a real admin status for a client with a forwarded identity', async () => {
      const client = createMockClient()
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      gateway.handleConnection(
        client,
        buildRequest({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      )

      await gateway.broadcastPerViewer(isAdmin => ({
        type: 'x',
        data: { isAdmin },
      }))

      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledWith(
        'alice@example.com',
      )
      expect(client.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'x', data: { isAdmin: true } }),
      )
    })

    it('does not send to a client that disconnected before a broadcast started', async () => {
      const client = createMockClient()
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      gateway.handleConnection(
        client,
        buildRequest({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      )
      gateway.handleDisconnect(client)

      await gateway.broadcastPerViewer(isAdmin => ({
        type: 'x',
        data: { isAdmin },
      }))

      expect(client.send).not.toHaveBeenCalled()
    })

    it('re-resolves admin status on every broadcast, so a still-connected socket can see it change between two calls', async () => {
      const client = createMockClient()

      gateway.handleConnection(
        client,
        buildRequest({
          'x-forwarded-user': 'alice@example.com',
          'x-forwarded-user-id': 'user_1',
        }),
      )

      adminCheckService.checkIsAdmin.mockResolvedValueOnce(false)
      await gateway.broadcastPerViewer(isAdmin => ({
        type: 'x',
        data: { isAdmin },
      }))
      expect(client.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'x', data: { isAdmin: false } }),
      )

      adminCheckService.checkIsAdmin.mockResolvedValueOnce(true)
      await gateway.broadcastPerViewer(isAdmin => ({
        type: 'x',
        data: { isAdmin },
      }))
      expect(client.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'x', data: { isAdmin: true } }),
      )

      // The connection itself never re-registered - both broadcasts saw the
      // same socket, just resolved its admin status independently.
      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledTimes(2)
    })
  })

  describe('broadcastPerViewer', () => {
    it('sends a distinct frame to admin vs non-admin clients from one call', async () => {
      const adminClient = createMockClient()
      const nonAdminClient = createMockClient()
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      gateway.handleConnection(
        adminClient,
        buildRequest({
          'x-forwarded-user': 'admin@example.com',
          'x-forwarded-user-id': 'admin_1',
        }),
      )
      gateway.handleConnection(nonAdminClient, buildRequest())

      await gateway.broadcastPerViewer(isAdmin => ({
        type: 'job-update',
        data: { requester: isAdmin ? 'alice@example.com' : null },
      }))

      expect(adminClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'job-update',
          data: { requester: 'alice@example.com' },
        }),
      )
      expect(nonAdminClient.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'job-update',
          data: { requester: null },
        }),
      )
    })

    it('serializes each distinct variant only once regardless of client count', async () => {
      const admins = [createMockClient(), createMockClient()]
      const nonAdmins = [createMockClient(), createMockClient()]
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      for (const client of admins) {
        gateway.handleConnection(
          client,
          buildRequest({
            'x-forwarded-user': 'admin@example.com',
            'x-forwarded-user-id': 'admin_1',
          }),
        )
      }
      for (const client of nonAdmins) {
        gateway.handleConnection(client, buildRequest())
      }

      const build = jest.fn((isAdmin: boolean) => ({
        type: 'x',
        data: { isAdmin },
      }))
      await gateway.broadcastPerViewer(build)

      // Two connected clients per variant, but the payload is only built
      // (and JSON.stringify'd) once per variant - not once per client.
      expect(build).toHaveBeenCalledTimes(2)
    })

    it('calls checkIsAdmin at most once per distinct email, even with multiple sockets for the same user', async () => {
      const first = createMockClient()
      const second = createMockClient()
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      for (const client of [first, second]) {
        gateway.handleConnection(
          client,
          buildRequest({
            'x-forwarded-user': 'alice@example.com',
            'x-forwarded-user-id': 'user_1',
          }),
        )
      }

      await gateway.broadcastPerViewer(() => ({ type: 'ping' }))

      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledTimes(1)
    })

    it('does not send to clients that are not in the OPEN state', async () => {
      const openClient = createMockClient(WebSocket.OPEN)
      const connectingClient = createMockClient(WebSocket.CONNECTING)
      const closingClient = createMockClient(WebSocket.CLOSING)
      const closedClient = createMockClient(WebSocket.CLOSED)

      gateway.handleConnection(openClient, buildRequest())
      gateway.handleConnection(connectingClient, buildRequest())
      gateway.handleConnection(closingClient, buildRequest())
      gateway.handleConnection(closedClient, buildRequest())

      await gateway.broadcastPerViewer(() => ({ type: 'ping' }))

      expect(openClient.send).toHaveBeenCalledTimes(1)
      expect(connectingClient.send).not.toHaveBeenCalled()
      expect(closingClient.send).not.toHaveBeenCalled()
      expect(closedClient.send).not.toHaveBeenCalled()
    })

    it('does not throw when there are no connected clients', async () => {
      await expect(
        gateway.broadcastPerViewer(() => ({ type: 'ping' })),
      ).resolves.not.toThrow()
    })
  })
})
