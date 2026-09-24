import { DynamicModule, INestApplication, Logger, Module } from '@nestjs/common'
import { Client } from 'discord.js'
import type { AddressInfo } from 'net'

import { createTestingModule } from 'src/__tests__/test-utils'
import { AlertsModule } from 'src/alerts/alerts.module'
import type { GrafanaWebhookPayload } from 'src/alerts/grafana-webhook.types'

const TOKEN = 'c0ffee'.repeat(10)
const CHANNEL_ID = '123456789012345678'

interface FakeChannel {
  isTextBased: jest.Mock
  send: jest.Mock
}

interface FakeClient {
  channels: { fetch: jest.Mock }
}

function makeTextChannel(): FakeChannel {
  return {
    isTextBased: jest.fn().mockReturnValue(true),
    send: jest.fn().mockResolvedValue({}),
  }
}

function makeClient(channel: unknown): FakeClient {
  return { channels: { fetch: jest.fn().mockResolvedValue(channel) } }
}

/** Stands in for NecordModule, which provides `Client` globally in prod. */
@Module({})
class FakeDiscordModule {
  static withClient(client: FakeClient): DynamicModule {
    return {
      module: FakeDiscordModule,
      global: true,
      providers: [{ provide: Client, useValue: client }],
      exports: [Client],
    }
  }
}

function firingAlert(name = 'NexusDaemonDown') {
  return {
    status: 'firing' as const,
    labels: { alertname: name, severity: 'critical', job: 'nexus-code' },
    annotations: { summary: 'Nexus daemon is down' },
    startsAt: '2026-09-24T10:00:00Z',
  }
}

describe('GrafanaAlertsController (POST /alerts/grafana)', () => {
  let app: INestApplication | undefined
  let baseUrl: string
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let logSpies: jest.SpyInstance[]
  const originalEnv = { ...process.env }

  async function startApp(client: FakeClient) {
    const moduleRef = await createTestingModule(
      [],
      [FakeDiscordModule.withClient(client), AlertsModule],
    )

    app = moduleRef.createNestApplication({ logger: false })
    await app.listen(0, '127.0.0.1')

    const { port } = app.getHttpServer().address() as AddressInfo

    baseUrl = `http://127.0.0.1:${port}`
  }

  function post(
    body: GrafanaWebhookPayload | unknown,
    authorization: string | null = `Bearer ${TOKEN}`,
  ) {
    return fetch(`${baseUrl}/alerts/grafana`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  beforeEach(() => {
    process.env.GRAFANA_WEBHOOK_TOKEN = TOKEN
    process.env.ALERTS_CHANNEL_ID = CHANNEL_ID
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation()
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    logSpies = [
      errorSpy,
      warnSpy,
      jest.spyOn(Logger.prototype, 'log').mockImplementation(),
      jest.spyOn(Logger.prototype, 'debug').mockImplementation(),
    ]
  })

  afterEach(async () => {
    // The bearer token must never reach a log line.
    const logged = logSpies.flatMap(spy => spy.mock.calls).flat()

    expect(JSON.stringify(logged)).not.toContain(TOKEN)

    await app?.close()
    app = undefined
    process.env = { ...originalEnv }
  })

  it('posts alert embeds to the configured channel and answers 202', async () => {
    const channel = makeTextChannel()
    const client = makeClient(channel)

    await startApp(client)

    const res = await post({ status: 'firing', alerts: [firingAlert()] })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ sent: 1 })
    expect(client.channels.fetch).toHaveBeenCalledWith(CHANNEL_ID)
    expect(channel.send).toHaveBeenCalledTimes(1)

    const [message] = channel.send.mock.calls[0]

    expect(message.allowedMentions).toEqual({ parse: [] })
    expect(message.embeds).toHaveLength(1)
    expect(message.embeds[0].title).toBe('[FIRING] NexusDaemonDown')
  })

  it('sends one message per batch when there are more than 10 alerts', async () => {
    const channel = makeTextChannel()

    await startApp(makeClient(channel))

    const alerts = Array.from({ length: 12 }, (_, i) => firingAlert(`A${i}`))
    const res = await post({ status: 'firing', alerts })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ sent: 12 })
    expect(channel.send).toHaveBeenCalledTimes(2)
    expect(channel.send.mock.calls[0][0].embeds).toHaveLength(10)
    expect(channel.send.mock.calls[1][0].embeds).toHaveLength(2)
  })

  it('answers 202 without fetching a channel when there are no alerts', async () => {
    const client = makeClient(makeTextChannel())

    await startApp(client)

    for (const body of [{ alerts: [] }, { status: 'firing' }, [1, 2, 3]]) {
      const res = await post(body)

      expect(res.status).toBe(202)
      expect(await res.json()).toEqual({ sent: 0 })
    }

    expect(client.channels.fetch).not.toHaveBeenCalled()
  })

  it('posts a Grafana contact-point test notification', async () => {
    const channel = makeTextChannel()

    await startApp(makeClient(channel))

    const res = await post({ title: '[FIRING:1]  (TestAlert Grafana)' })

    expect(res.status).toBe(202)
    expect(channel.send.mock.calls[0][0].embeds[0].title).toBe(
      '[FIRING] TestAlert',
    )
  })

  it('answers 202 and logs an error when the channel is not text-based', async () => {
    const channel = makeTextChannel()

    channel.isTextBased.mockReturnValue(false)
    await startApp(makeClient(channel))

    const res = await post({ alerts: [firingAlert()] })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ sent: 0 })
    expect(channel.send).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('not found or not text-based'),
    )
  })

  it('answers 202 when the channel does not exist', async () => {
    const client = makeClient(null)

    client.channels.fetch.mockRejectedValue(new Error('Unknown Channel'))
    await startApp(client)

    const res = await post({ alerts: [firingAlert()] })

    expect(res.status).toBe(202)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown Channel'),
    )
  })

  it('answers 202 and logs an error when ALERTS_CHANNEL_ID is unset', async () => {
    delete process.env.ALERTS_CHANNEL_ID

    const client = makeClient(makeTextChannel())

    await startApp(client)

    const res = await post({ alerts: [firingAlert()] })

    expect(res.status).toBe(202)
    expect(client.channels.fetch).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ALERTS_CHANNEL_ID'),
    )
  })

  it('answers 202 and logs when the Discord send throws', async () => {
    const channel = makeTextChannel()

    channel.send.mockRejectedValue(new Error('Missing Permissions'))
    await startApp(makeClient(channel))

    const res = await post({ alerts: [firingAlert()] })

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ sent: 0 })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Missing Permissions'),
    )
  })

  it('rejects a missing or wrong bearer token with 401 and sends nothing', async () => {
    const client = makeClient(makeTextChannel())

    await startApp(client)

    expect((await post({ alerts: [firingAlert()] }, null)).status).toBe(401)
    expect(
      (await post({ alerts: [firingAlert()] }, 'Bearer wrong')).status,
    ).toBe(401)
    expect(client.channels.fetch).not.toHaveBeenCalled()
  })

  it('fails closed with 401 and a boot warning when the token env is unset', async () => {
    delete process.env.GRAFANA_WEBHOOK_TOKEN

    const client = makeClient(makeTextChannel())

    await startApp(client)

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('GRAFANA_WEBHOOK_TOKEN is not set'),
    )

    const res = await post({ alerts: [firingAlert()] })

    expect(res.status).toBe(401)
    expect(client.channels.fetch).not.toHaveBeenCalled()
  })
})
