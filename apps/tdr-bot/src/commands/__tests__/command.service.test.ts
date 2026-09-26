import { existsSync } from 'fs'
import { Docker } from 'node-docker-api'

import { CommandsService } from 'src/commands/command.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

jest.mock('necord', () => {
  const noopDecorator = () => () => undefined

  return {
    BooleanOption: noopDecorator,
    Context: noopDecorator,
    NumberOption: noopDecorator,
    Options: noopDecorator,
    SlashCommand: noopDecorator,
  }
})

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
}))

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  hostname: jest.fn(() => 'abc123def456'),
}))

jest.mock('src/utils/crumbl', () => ({
  getWeeklyCookiesMessages: jest.fn(),
}))

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>
const MockDocker = Docker as unknown as jest.Mock

function createInteraction() {
  return {
    user: { username: 'tester' },
    reply: jest.fn().mockResolvedValue(undefined),
  }
}

function createService() {
  const metrics = {
    commandExecuted: jest.fn(),
  } as unknown as TdrBotMetricsService

  return new CommandsService(metrics)
}

describe('CommandsService.restart', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('restarts only its own container, looked up by hostname', async () => {
    const restart = jest.fn().mockResolvedValue(undefined)
    const get = jest.fn(() => ({ restart }))
    MockDocker.mockImplementation(() => ({ container: { get } }))
    mockExistsSync.mockReturnValue(true)

    const interaction = createInteraction()
    await createService().restart([interaction] as never)

    expect(get).toHaveBeenCalledWith('abc123def456')
    expect(restart).toHaveBeenCalledTimes(1)
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.stringContaining('Restarting TDR bot'),
    )
  })

  it('refuses to restart when no Docker socket is mounted', async () => {
    mockExistsSync.mockReturnValue(false)

    const interaction = createInteraction()
    await createService().restart([interaction] as never)

    expect(MockDocker).not.toHaveBeenCalled()
    expect(interaction.reply).toHaveBeenCalledWith(
      'Restart is unavailable in this environment',
    )
  })
})
