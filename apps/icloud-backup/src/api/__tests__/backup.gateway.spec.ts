import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'

import { BackupGateway, CLOSE_UNAUTHORIZED } from 'src/api/backup.gateway'
import { JobUserService } from 'src/api/job-user.service'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { JobsService } from 'src/jobs/jobs.service'
import type { BackupView, ServerMessage } from 'src/shared/contract'

type Mock = jest.Mocked<WebSocket>

function socket(): Mock {
  return {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
  } as unknown as Mock
}

function request(userId?: string, email = `${userId}@example.com`) {
  const headers: Record<string, string> = {}
  if (userId) {
    headers['x-forwarded-user'] = email
    headers['x-forwarded-user-id'] = userId
  }
  return { headers } as unknown as IncomingMessage
}

function viewFor(email: string, note = ''): BackupView {
  return {
    email,
    isAdmin: false,
    lowDiskSpace: false,
    account: null,
    job: note
      ? {
          id: note,
          kind: 'sync',
          state: 'downloading',
          authError: null,
          queuePosition: null,
          totalItems: null,
          downloadedItems: 0,
          skippedItems: 0,
          downloadedBytes: 0,
          currentFile: null,
          attempt: 0,
          maxAttempts: 0,
          retryAt: null,
          errorCode: null,
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: null,
        }
      : null,
  }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

function sent(client: Mock): ServerMessage[] {
  return client.send.mock.calls.map(
    ([frame]) => JSON.parse(String(frame)) as ServerMessage,
  )
}

describe('BackupGateway', () => {
  let gateway: BackupGateway
  let getView: jest.Mock
  let fire: (userId: string) => void
  let unsubscribe: jest.Mock

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    unsubscribe = jest.fn()
    getView = jest.fn(async (user: { email: string }) => viewFor(user.email))
    const fakeJobs = {
      getView,
      onChange: jest.fn((listener: (id: string) => void) => {
        fire = listener
        return unsubscribe
      }),
    }
    const module = await Test.createTestingModule({
      providers: [
        BackupGateway,
        JobUserService,
        { provide: JobsService, useValue: fakeJobs },
        {
          provide: AdminCheckService,
          useValue: { checkIsAdmin: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile()
    gateway = module.get(BackupGateway)
    gateway.onModuleInit()
  })

  it('sends the person their view on connect', async () => {
    const tab = socket()
    gateway.handleConnection(tab, request('u1'))
    await flush()

    expect(tab.close).not.toHaveBeenCalled()
    expect(sent(tab)).toEqual([
      { type: 'backup', data: viewFor('u1@example.com') },
    ])
  })

  it('closes with 4401 and sends nothing without identity', async () => {
    const tab = socket()
    gateway.handleConnection(tab, request())
    await flush()

    expect(tab.close).toHaveBeenCalledWith(
      CLOSE_UNAUTHORIZED,
      expect.any(String),
    )
    expect(CLOSE_UNAUTHORIZED).toBe(4401)
    expect(tab.send).not.toHaveBeenCalled()
    expect(getView).not.toHaveBeenCalled()
  })

  it('sends a change only to the changed person', async () => {
    const a = socket()
    const b = socket()
    gateway.handleConnection(a, request('u1'))
    gateway.handleConnection(b, request('u2'))
    await flush()
    a.send.mockClear()
    b.send.mockClear()

    getView.mockImplementation(async (user: { email: string }) =>
      viewFor(user.email, 'job-1'),
    )
    fire('u1')
    await flush()

    expect(sent(a)).toEqual([
      { type: 'backup', data: viewFor('u1@example.com', 'job-1') },
    ])
    expect(b.send).not.toHaveBeenCalled()
  })

  it('sends a change to both of one person’s tabs', async () => {
    const tab1 = socket()
    const tab2 = socket()
    gateway.handleConnection(tab1, request('u1'))
    gateway.handleConnection(tab2, request('u1'))
    await flush()
    tab1.send.mockClear()
    tab2.send.mockClear()

    getView.mockImplementation(async (user: { email: string }) =>
      viewFor(user.email, 'job-2'),
    )
    fire('u1')
    await flush()

    for (const tab of [tab1, tab2]) {
      expect(sent(tab)).toEqual([
        { type: 'backup', data: viewFor('u1@example.com', 'job-2') },
      ])
    }
  })

  it('keeps sending to the remaining tab after one disconnects', async () => {
    const tab1 = socket()
    const tab2 = socket()
    gateway.handleConnection(tab1, request('u1'))
    gateway.handleConnection(tab2, request('u1'))
    await flush()
    gateway.handleDisconnect(tab1)
    tab1.send.mockClear()
    tab2.send.mockClear()

    fire('u1')
    await flush()

    expect(tab1.send).not.toHaveBeenCalled()
    expect(tab2.send).toHaveBeenCalledTimes(1)
  })

  it('does not read a view for a person with no open tab', async () => {
    fire('nobody')
    await flush()
    expect(getView).not.toHaveBeenCalled()
  })

  it('delivers views in order when changes land while one is in flight', async () => {
    const tab = socket()
    gateway.handleConnection(tab, request('u1'))
    await flush()
    tab.send.mockClear()

    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    getView.mockImplementationOnce(async (user: { email: string }) => {
      await gate
      return viewFor(user.email, 'old')
    })
    getView.mockImplementation(async (user: { email: string }) =>
      viewFor(user.email, 'new'),
    )

    fire('u1')
    fire('u1')
    fire('u1')
    release()
    await flush()

    const jobIds = sent(tab).map(m => m.data.job?.id)
    expect(jobIds).toEqual(['old', 'new'])
  })

  it('logs and survives a failing getView', async () => {
    const tab = socket()
    getView.mockRejectedValueOnce(new Error('db down'))
    gateway.handleConnection(tab, request('u1'))
    await flush()
    expect(tab.send).not.toHaveBeenCalled()

    fire('u1')
    await flush()
    expect(tab.send).toHaveBeenCalledTimes(1)
  })

  it('does not send to a socket that is no longer open', async () => {
    const tab = socket()
    gateway.handleConnection(tab, request('u1'))
    await flush()
    tab.send.mockClear()
    ;(tab as { readyState: number }).readyState = WebSocket.CLOSED

    fire('u1')
    await flush()
    expect(tab.send).not.toHaveBeenCalled()
  })

  it('stops listening to JobsService on module destroy', () => {
    gateway.onModuleDestroy()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
