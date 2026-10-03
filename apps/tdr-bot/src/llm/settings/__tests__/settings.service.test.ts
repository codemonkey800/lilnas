import { DrizzleService } from 'src/db/drizzle.service'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { Settings } from 'src/llm/settings/settings.schema'
import {
  SettingsService,
  SettingsValidationError,
} from 'src/llm/settings/settings.service'

function makeDb(rows: unknown[]) {
  const limit = jest.fn().mockResolvedValue(rows)
  const select = jest.fn(() => ({
    from: () => ({ where: () => ({ limit }) }),
  }))
  const values = jest.fn().mockResolvedValue(undefined)
  const insert = jest.fn(() => ({ values }))
  const where = jest.fn().mockResolvedValue(undefined)
  const set = jest.fn(() => ({ where }))
  const update = jest.fn(() => ({ set }))
  return { db: { select, insert, update }, values, set }
}

async function build(rows: unknown[] = []) {
  const fake = makeDb(rows)
  const service = new SettingsService(
    fake as unknown as DrizzleService,
    new ModelRegistry(),
  )
  await service.onModuleInit()
  return { service, fake }
}

describe('SettingsService', () => {
  it('seeds defaults when no row exists', async () => {
    const { service, fake } = await build()
    expect(fake.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        temperature: 0,
        reasoningEffort: 'medium',
      }),
    )
    expect(service.get().temperature).toBe(0)
    expect(service.get().models.chat).toBe('gpt-4-turbo')
  })

  it('loads an existing row without inserting', async () => {
    const { service, fake } = await build([
      {
        id: 'default',
        models: { chat: 'gpt-5', reasoning: 'gpt-5-mini', image: 'dall-e-3' },
        temperature: 1,
        reasoningEffort: 'high',
        systemPrompt: 'hi',
      },
    ])
    expect(fake.db.insert).not.toHaveBeenCalled()
    expect(service.get()).toEqual({
      models: { chat: 'gpt-5', reasoning: 'gpt-5-mini', image: 'dall-e-3' },
      temperature: 1,
      reasoningEffort: 'high',
      systemPrompt: 'hi',
    })
  })

  it('merges a partial patch, persists and emits', async () => {
    const { service, fake } = await build()
    const emitted: Settings[] = []
    service.changes$.subscribe(s => emitted.push(s))

    const result = await service.update({
      temperature: 0.5,
      models: { chat: 'gpt-5' },
    })

    expect(result.temperature).toBe(0.5)
    expect(result.models).toEqual({
      chat: 'gpt-5',
      reasoning: 'gpt-4o-mini',
      image: 'dall-e-3',
    })
    expect(result.reasoningEffort).toBe('medium')
    expect(fake.set).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.5 }),
    )
    expect(emitted).toEqual([result])
    expect(service.get()).toBe(result)
  })

  it('rejects an unknown model id', async () => {
    const { service, fake } = await build()
    await expect(
      service.update({ models: { chat: 'banana' } }),
    ).rejects.toBeInstanceOf(SettingsValidationError)
    expect(fake.set).not.toHaveBeenCalled()
    expect(service.get().models.chat).toBe('gpt-4-turbo')
  })

  it('rejects an image model in the chat role', async () => {
    const { service } = await build()
    const err = await service
      .update({ models: { chat: 'dall-e-3' } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SettingsValidationError)
    expect((err as SettingsValidationError).issues[0].path).toBe('models.chat')
  })

  it('rejects gpt-image-1, which the DALL-E image provider cannot call', async () => {
    const { service } = await build()
    const err = await service
      .update({ models: { image: 'gpt-image-1' } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SettingsValidationError)
    expect((err as SettingsValidationError).issues[0].path).toBe('models.image')
  })

  it('rejects out-of-range values via the schema', async () => {
    const { service } = await build()
    await expect(service.update({ temperature: 5 })).rejects.toBeInstanceOf(
      SettingsValidationError,
    )
  })

  it('reset restores defaults and emits', async () => {
    const { service } = await build()
    await service.update({ temperature: 1 })
    const emitted: Settings[] = []
    service.changes$.subscribe(s => emitted.push(s))
    const result = await service.reset()
    expect(result.temperature).toBe(0)
    expect(emitted).toHaveLength(1)
  })
})
