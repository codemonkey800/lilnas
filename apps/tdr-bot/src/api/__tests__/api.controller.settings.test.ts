import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Client } from 'discord.js'

import { ApiController } from 'src/api/api.controller'
import { DrizzleService } from 'src/db/drizzle.service'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { SettingsService } from 'src/llm/settings/settings.service'
import { LLMOrchestrationService } from 'src/messages/llm/llm-orchestration.service'
import { EquationImageService } from 'src/services/equation-image.service'

function makeDb(rows: unknown[] = []) {
  const limit = jest.fn().mockResolvedValue(rows)
  const where = jest.fn().mockResolvedValue(undefined)
  return {
    select: jest.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })),
    insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
    update: jest.fn(() => ({ set: () => ({ where }) })),
  }
}

describe('ApiController settings and models', () => {
  let app: INestApplication
  let base: string

  const req = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        ModelRegistry,
        SettingsService,
        { provide: DrizzleService, useValue: { db: makeDb() } },
        { provide: EquationImageService, useValue: {} },
        { provide: Client, useValue: {} },
        { provide: LLMOrchestrationService, useValue: {} },
      ],
    }).compile()
    app = module.createNestApplication({ logger: false })
    await app.init()
    await app.listen(0, '127.0.0.1')
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
    await module.get(SettingsService).onModuleInit()
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /settings returns settings with updatedAt', async () => {
    const res = await req('/settings')
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual(
      expect.objectContaining({
        models: expect.objectContaining({ chat: 'gpt-4-turbo' }),
        temperature: 0,
        updatedAt: expect.any(String),
      }),
    )
  })

  it('PUT /settings applies a valid patch', async () => {
    const res = await req('/settings', 'PUT', { temperature: 0.5 })

    expect(res.status).toBe(200)
    expect((await res.json()).temperature).toBe(0.5)
    expect(
      ((await (await req('/settings')).json()) as { temperature: number })
        .temperature,
    ).toBe(0.5)
  })

  it('PUT /settings rejects unknown models with 400', async () => {
    const res = await req('/settings', 'PUT', { models: { chat: 'nope' } })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.issues).toEqual([
      expect.objectContaining({ path: 'models.chat' }),
    ])
  })

  it('PUT /settings rejects an image model for the chat role', async () => {
    const res = await req('/settings', 'PUT', { models: { chat: 'dall-e-3' } })

    expect(res.status).toBe(400)
  })

  it('PUT /settings rejects out-of-range temperature with 400', async () => {
    const res = await req('/settings', 'PUT', { temperature: 5 })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.issues[0].path).toBe('temperature')
  })

  it('POST /settings/reset restores defaults', async () => {
    await req('/settings', 'PUT', { temperature: 1.5, systemPrompt: 'x' })

    const res = await req('/settings/reset', 'POST')
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.temperature).toBe(0)
    expect(json.systemPrompt).toContain('kawaii')
  })

  it('GET /models?role=chat excludes image models', async () => {
    const res = await req('/models?role=chat')
    const json = (await res.json()) as Array<{ id: string; roles: string[] }>

    expect(res.status).toBe(200)
    expect(json.length).toBeGreaterThan(0)
    expect(json.every(m => m.roles.includes('chat'))).toBe(true)
    expect(json.map(m => m.id)).not.toContain('dall-e-3')
  })

  it('GET /models?role=image returns only image models', async () => {
    const json = (await (await req('/models?role=image')).json()) as Array<{
      roles: string[]
    }>

    expect(json.length).toBeGreaterThan(0)
    expect(json.every(m => m.roles.includes('image'))).toBe(true)
  })

  it('GET /models rejects an invalid role with 400', async () => {
    expect((await req('/models?role=bogus')).status).toBe(400)
  })
})
