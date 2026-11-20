import type {
  AdminAccountRow,
  BackupView,
  CodeBody,
  PasswordBody,
  StartBackupBody,
} from 'src/shared/contract'

/** The header every POST carries; the backend refuses a POST without it. */
export const REQUESTED_WITH_HEADER = 'X-Requested-With'
export const REQUESTED_WITH_VALUE = 'icloud-backup'

/** A request that did not succeed. `status` is 0 when no response came back. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection."

/**
 * Nest answers with `{ statusCode, message, error }`, where `message` is a
 * string or a list of strings. Anything else falls back to the status text.
 */
async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const { message } = body
      if (typeof message === 'string' && message) return message
      if (Array.isArray(message)) {
        const text = message.filter(m => typeof m === 'string').join(', ')
        if (text) return text
      }
    }
  } catch {
    // Not JSON: use the status text below.
  }

  return response.statusText || `Request failed (${response.status})`
}

async function request<T>(
  path: string,
  init: { method: 'GET' } | { method: 'POST'; body?: unknown },
): Promise<T> {
  const post = init.method === 'POST'
  const body = post && init.body !== undefined ? init.body : undefined

  let response: Response
  try {
    response = await fetch(path, {
      method: init.method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(post ? { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, NETWORK_MESSAGE)
  }

  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response))
  }

  return (await response.json()) as T
}

const get = <T>(path: string): Promise<T> => request<T>(path, { method: 'GET' })

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body })

export const getBackup = (): Promise<BackupView> =>
  get<BackupView>('/api/backup')

export const startBackup = (body: StartBackupBody): Promise<BackupView> =>
  post<BackupView>('/api/backup/start', body)

export const syncBackup = (): Promise<BackupView> =>
  post<BackupView>('/api/backup/sync')

export const submitPassword = (body: PasswordBody): Promise<BackupView> =>
  post<BackupView>('/api/backup/password', body)

export const submitCode = (body: CodeBody): Promise<BackupView> =>
  post<BackupView>('/api/backup/code', body)

export const cancelBackup = (): Promise<BackupView> =>
  post<BackupView>('/api/backup/cancel')

/** Resets the person's Immich password and returns the new one, once. */
export const resetImmichPassword = (): Promise<{ password: string }> =>
  post<{ password: string }>('/api/backup/immich-password')

export const getAdminAccounts = (): Promise<AdminAccountRow[]> =>
  get<AdminAccountRow[]>('/api/admin/accounts')
