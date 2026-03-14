import { JwtService } from '@nestjs/jwt'

import { DownloadGateway } from 'src/download/download.gateway'
import {
  DownloadEventPayload,
  DownloadEvents,
} from 'src/download/download.types'

function makeSocket(cookieHeader?: string): {
  id: string
  handshake: { headers: { cookie?: string } }
  disconnect: jest.Mock
} {
  return {
    id: 'socket-abc',
    handshake: { headers: { cookie: cookieHeader } },
    disconnect: jest.fn(),
  }
}

function makeMockServer() {
  return { emit: jest.fn() }
}

describe('DownloadGateway', () => {
  let gateway: DownloadGateway
  let mockJwt: jest.Mocked<JwtService>
  let mockServer: ReturnType<typeof makeMockServer>

  beforeEach(() => {
    mockJwt = {
      verifyAsync: jest
        .fn()
        .mockResolvedValue({ sub: 'user-1', email: 'user@example.com' }),
    } as unknown as jest.Mocked<JwtService>
    gateway = new DownloadGateway(mockJwt)
    mockServer = makeMockServer()
    // Inject the mock Server directly onto the gateway instance
    gateway.server = mockServer as never
  })

  // ---------------------------------------------------------------------------
  // handleConnection
  // ---------------------------------------------------------------------------

  describe('handleConnection', () => {
    it('allows connection when JWT cookie is valid', async () => {
      const client = makeSocket('auth-token=valid.jwt.token')
      await gateway.handleConnection(client as never)
      expect(mockJwt.verifyAsync).toHaveBeenCalledWith('valid.jwt.token')
      expect(client.disconnect).not.toHaveBeenCalled()
    })

    it('disconnects client when no cookie header', async () => {
      const client = makeSocket(undefined)
      await gateway.handleConnection(client as never)
      expect(client.disconnect).toHaveBeenCalled()
      expect(mockJwt.verifyAsync).not.toHaveBeenCalled()
    })

    it('disconnects client when auth-token cookie is absent from header', async () => {
      const client = makeSocket('other-cookie=some-value')
      await gateway.handleConnection(client as never)
      expect(client.disconnect).toHaveBeenCalled()
    })

    it('disconnects client when JWT verification fails', async () => {
      mockJwt.verifyAsync.mockRejectedValue(new Error('Token expired'))
      const client = makeSocket('auth-token=bad.token')
      await gateway.handleConnection(client as never)
      expect(client.disconnect).toHaveBeenCalled()
    })

    it('parses multiple cookies correctly and extracts auth-token', async () => {
      const client = makeSocket(
        'session=abc; auth-token=real.jwt.token; locale=en',
      )
      await gateway.handleConnection(client as never)
      expect(mockJwt.verifyAsync).toHaveBeenCalledWith('real.jwt.token')
      expect(client.disconnect).not.toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // handleDownloadEvent
  // ---------------------------------------------------------------------------

  describe('handleDownloadEvent', () => {
    it.each([
      DownloadEvents.INITIATED,
      DownloadEvents.GRABBING,
      DownloadEvents.PROGRESS,
      DownloadEvents.COMPLETED,
      DownloadEvents.FAILED,
    ])(
      'emits %s event to all clients using eventName as the Socket.IO topic',
      eventName => {
        const payload = {
          event: eventName,
          mediaType: 'movie' as const,
          tmdbId: 1,
        } as DownloadEventPayload
        gateway.handleDownloadEvent({ eventName, payload })
        expect(mockServer.emit).toHaveBeenCalledWith(eventName, payload)
      },
    )

    it('passes payload through to clients by reference', () => {
      const payload = {
        event: DownloadEvents.CANCELLED,
        mediaType: 'movie' as const,
        tmdbId: 456,
      }
      gateway.handleDownloadEvent({
        eventName: DownloadEvents.CANCELLED,
        payload,
      })
      const [, emittedPayload] = (mockServer.emit as jest.Mock).mock.calls[0]!
      expect(emittedPayload).toBe(payload)
    })
  })
})
