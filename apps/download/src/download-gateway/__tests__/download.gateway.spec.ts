import { Test, TestingModule } from '@nestjs/testing'
import { WebSocket } from 'ws'

import {
  DownloadGateway,
  DownloadGatewayMessage,
} from 'src/download-gateway/download.gateway'

function createMockClient(
  readyState: number = WebSocket.OPEN,
): jest.Mocked<WebSocket> {
  return {
    readyState,
    send: jest.fn(),
  } as unknown as jest.Mocked<WebSocket>
}

describe('DownloadGateway', () => {
  let gateway: DownloadGateway

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DownloadGateway],
    }).compile()

    gateway = module.get<DownloadGateway>(DownloadGateway)
  })

  describe('handleConnection / handleDisconnect', () => {
    it('tracks a client after handleConnection so it receives broadcasts', () => {
      const client = createMockClient()

      gateway.handleConnection(client)
      gateway.broadcast({ type: 'ping' })

      expect(client.send).toHaveBeenCalledTimes(1)
    })

    it('stops tracking a client after handleDisconnect', () => {
      const client = createMockClient()

      gateway.handleConnection(client)
      gateway.handleDisconnect(client)
      gateway.broadcast({ type: 'ping' })

      expect(client.send).not.toHaveBeenCalled()
    })

    it('is safe to disconnect a client that was never connected', () => {
      const client = createMockClient()

      expect(() => gateway.handleDisconnect(client)).not.toThrow()
    })
  })

  describe('broadcast', () => {
    it('sends the JSON-stringified payload to every connected client', () => {
      const clientA = createMockClient()
      const clientB = createMockClient()
      const payload: DownloadGatewayMessage = {
        type: 'job-update',
        data: { id: '123', status: 'completed' },
      }

      gateway.handleConnection(clientA)
      gateway.handleConnection(clientB)
      gateway.broadcast(payload)

      const expectedMessage = JSON.stringify(payload)
      expect(clientA.send).toHaveBeenCalledWith(expectedMessage)
      expect(clientB.send).toHaveBeenCalledWith(expectedMessage)
    })

    it('does not send to clients that are not in the OPEN state', () => {
      const openClient = createMockClient(WebSocket.OPEN)
      const connectingClient = createMockClient(WebSocket.CONNECTING)
      const closingClient = createMockClient(WebSocket.CLOSING)
      const closedClient = createMockClient(WebSocket.CLOSED)

      gateway.handleConnection(openClient)
      gateway.handleConnection(connectingClient)
      gateway.handleConnection(closingClient)
      gateway.handleConnection(closedClient)

      gateway.broadcast({ type: 'ping' })

      expect(openClient.send).toHaveBeenCalledTimes(1)
      expect(connectingClient.send).not.toHaveBeenCalled()
      expect(closingClient.send).not.toHaveBeenCalled()
      expect(closedClient.send).not.toHaveBeenCalled()
    })

    it('does not throw when there are no connected clients', () => {
      expect(() => gateway.broadcast({ type: 'ping' })).not.toThrow()
    })
  })
})
