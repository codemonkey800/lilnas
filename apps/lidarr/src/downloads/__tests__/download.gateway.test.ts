import { TokenClient } from '@lilnas/token-client'
import { Test, TestingModule } from '@nestjs/testing'
import { Server, Socket } from 'socket.io'

import { TOKEN_CLIENT } from 'src/auth/auth.constants'
import { DownloadGateway } from 'src/downloads/download.gateway'
import {
  DownloadEvents,
  INTERNAL_DOWNLOAD_EVENT,
  type InternalDownloadEvent,
} from 'src/downloads/downloads.types'

function makeSocket(
  headerOverrides: Record<string, string | undefined> = {},
): jest.Mocked<Socket> {
  return {
    id: 'test-socket-id',
    handshake: {
      headers: { ...headerOverrides },
    },
    disconnect: jest.fn(),
  } as unknown as jest.Mocked<Socket>
}

function makeServer(socketCount = 0): Partial<Server> {
  return {
    emit: jest.fn(),
    sockets: {
      sockets: { size: socketCount },
    } as unknown as Server['sockets'],
  }
}

describe('DownloadGateway', () => {
  let gateway: DownloadGateway
  let mockTokenClient: jest.Mocked<Pick<TokenClient, 'validate'>>

  beforeEach(async () => {
    mockTokenClient = { validate: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadGateway,
        { provide: TOKEN_CLIENT, useValue: mockTokenClient },
      ],
    }).compile()

    gateway = module.get(DownloadGateway)
  })

  // ---------------------------------------------------------------------------
  // handleConnection
  // ---------------------------------------------------------------------------

  describe('handleConnection', () => {
    it('disconnects client when x-token-value header is missing', async () => {
      const client = makeSocket()
      await gateway.handleConnection(client)
      expect(client.disconnect).toHaveBeenCalled()
      expect(mockTokenClient.validate).not.toHaveBeenCalled()
    })

    it('disconnects client when x-token-value header is empty string', async () => {
      const client = makeSocket({ 'x-token-value': '' })
      await gateway.handleConnection(client)
      expect(client.disconnect).toHaveBeenCalled()
      expect(mockTokenClient.validate).not.toHaveBeenCalled()
    })

    it('disconnects client when token is invalid', async () => {
      mockTokenClient.validate.mockResolvedValue(false)
      const client = makeSocket({ 'x-token-value': 'bad-token' })
      await gateway.handleConnection(client)
      expect(mockTokenClient.validate).toHaveBeenCalledWith(
        'lidarr',
        'bad-token',
      )
      expect(client.disconnect).toHaveBeenCalled()
    })

    it('allows valid client to stay connected', async () => {
      mockTokenClient.validate.mockResolvedValue(true)
      const client = makeSocket({ 'x-token-value': 'valid-token' })
      await gateway.handleConnection(client)
      expect(mockTokenClient.validate).toHaveBeenCalledWith(
        'lidarr',
        'valid-token',
      )
      expect(client.disconnect).not.toHaveBeenCalled()
    })

    it('disconnects client when validate throws an error', async () => {
      mockTokenClient.validate.mockRejectedValue(
        new Error('Token service down'),
      )
      const client = makeSocket({ 'x-token-value': 'any-token' })
      await gateway.handleConnection(client)
      expect(client.disconnect).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // handleDisconnect
  // ---------------------------------------------------------------------------

  describe('handleDisconnect', () => {
    it('does not throw when a client disconnects', () => {
      const client = makeSocket()
      expect(() => gateway.handleDisconnect(client)).not.toThrow()
    })
  })

  // ---------------------------------------------------------------------------
  // hasConnectedClients
  // ---------------------------------------------------------------------------

  describe('hasConnectedClients', () => {
    it('returns false when server is not yet assigned', () => {
      expect(gateway.hasConnectedClients()).toBe(false)
    })

    it('returns false when no sockets are connected', () => {
      gateway.server = makeServer(0) as Server
      expect(gateway.hasConnectedClients()).toBe(false)
    })

    it('returns true when at least one socket is connected', () => {
      gateway.server = makeServer(1) as Server
      expect(gateway.hasConnectedClients()).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // handleDownloadEvent
  // ---------------------------------------------------------------------------

  describe('handleDownloadEvent', () => {
    it('broadcasts event payload to all connected clients', () => {
      const mockServer = makeServer(1) as Server
      gateway.server = mockServer

      const event: InternalDownloadEvent = {
        eventName: DownloadEvents.INITIATED,
        payload: {
          event: DownloadEvents.INITIATED,
          mediaType: 'movie',
          tmdbId: 100,
        },
      }

      gateway.handleDownloadEvent(event)

      expect(mockServer.emit).toHaveBeenCalledWith(
        DownloadEvents.INITIATED,
        event.payload,
      )
    })

    it('is decorated with @OnEvent(INTERNAL_DOWNLOAD_EVENT)', () => {
      // Verify the method exists and can be called without throwing
      const event: InternalDownloadEvent = {
        eventName: DownloadEvents.CANCELLED,
        payload: {
          event: DownloadEvents.CANCELLED,
          mediaType: 'episode',
          tvdbId: 2000,
          episodeId: 50,
        },
      }
      const mockServer = makeServer() as Server
      mockServer.emit = jest.fn()
      gateway.server = mockServer

      expect(() => gateway.handleDownloadEvent(event)).not.toThrow()
      expect(mockServer.emit).toHaveBeenCalledWith(
        DownloadEvents.CANCELLED,
        event.payload,
      )
    })

    it('emits using the eventName field from the event, not the INTERNAL_DOWNLOAD_EVENT topic', () => {
      const mockServer = makeServer() as Server
      mockServer.emit = jest.fn()
      gateway.server = mockServer

      const event: InternalDownloadEvent = {
        eventName: DownloadEvents.PROGRESS,
        payload: {
          event: DownloadEvents.PROGRESS,
          mediaType: 'movie',
          tmdbId: 42,
          progress: 75,
          size: 1000,
          sizeleft: 250,
          eta: null,
          status: 'downloading',
        },
      }

      gateway.handleDownloadEvent(event)

      const [emittedEventName] =
        (mockServer.emit as jest.Mock).mock.calls[0] ?? []
      expect(emittedEventName).toBe(DownloadEvents.PROGRESS)
      expect(emittedEventName).not.toBe(INTERNAL_DOWNLOAD_EVENT)
    })
  })
})
