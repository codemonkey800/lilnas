import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'

import { ImmichError } from './immich.errors'
import type { ImmichLibrary, ImmichOptions, ImmichUser } from './immich.types'
import {
  IMMICH_OPTIONS,
  ImmichLibrarySchema,
  ImmichUserSchema,
  ValidateLibraryResponseSchema,
} from './immich.types'

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_MESSAGE_LENGTH = 200

type Method = 'GET' | 'POST' | 'PUT'

/**
 * Typed client for the Immich admin API (v3.3.4). One request per call, a
 * 10 s timeout, no retries. Errors never include a request body or the key.
 */
@Injectable()
export class ImmichClient {
  constructor(
    @Inject(IMMICH_OPTIONS) private readonly options: ImmichOptions,
  ) {}

  listUsers(): Promise<ImmichUser[]> {
    return this.request(
      'GET',
      '/admin/users',
      undefined,
      z.array(ImmichUserSchema),
    )
  }

  createUser(input: {
    email: string
    name: string
    password: string
  }): Promise<ImmichUser> {
    return this.request(
      'POST',
      '/admin/users',
      {
        email: input.email,
        password: input.password,
        name: input.name,
        shouldChangePassword: true,
        notify: false,
      },
      ImmichUserSchema,
    )
  }

  async resetPassword(userId: string, password: string): Promise<void> {
    await this.request(
      'PUT',
      `/admin/users/${encodeURIComponent(userId)}`,
      { password, shouldChangePassword: true },
      undefined,
    )
  }

  listLibraries(): Promise<ImmichLibrary[]> {
    return this.request(
      'GET',
      '/libraries',
      undefined,
      z.array(ImmichLibrarySchema),
    )
  }

  createLibrary(input: {
    ownerId: string
    name: string
    importPath: string
  }): Promise<ImmichLibrary> {
    return this.request(
      'POST',
      '/libraries',
      {
        ownerId: input.ownerId,
        name: input.name,
        importPaths: [input.importPath],
      },
      ImmichLibrarySchema,
    )
  }

  async validateLibrary(
    id: string,
    importPath: string,
  ): Promise<{ isValid: boolean; message?: string }> {
    const path = `/libraries/${encodeURIComponent(id)}/validate`
    const { importPaths } = await this.request(
      'POST',
      path,
      { importPaths: [importPath] },
      ValidateLibraryResponseSchema,
    )
    const entry =
      importPaths.find(p => p.importPath === importPath) ?? importPaths[0]
    if (!entry) {
      throw new ImmichError(
        'bad_response',
        `Immich POST ${path} returned no result`,
      )
    }
    return entry.message
      ? { isValid: entry.isValid, message: entry.message }
      : { isValid: entry.isValid }
  }

  async scanLibrary(id: string): Promise<void> {
    await this.request(
      'POST',
      `/libraries/${encodeURIComponent(id)}/scan`,
      undefined,
      undefined,
    )
  }

  private async request(
    method: Method,
    path: string,
    body: unknown,
    schema: undefined,
  ): Promise<void>
  private async request<T>(
    method: Method,
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
  ): Promise<T>
  private async request<T>(
    method: Method,
    path: string,
    body: unknown,
    schema: z.ZodType<T> | undefined,
  ): Promise<T | void> {
    const { baseUrl, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = this.options
    const label = `Immich ${method} ${path}`
    if (!apiKey) {
      throw new ImmichError('not_configured', 'IMMICH_API_KEY is not set')
    }

    const headers: Record<string, string> = {
      'x-api-key': apiKey,
      accept: 'application/json',
    }
    if (body !== undefined) headers['content-type'] = 'application/json'

    let res: Response
    try {
      res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // Never forward err.message: it can carry the URL or cause details.
      if (isTimeout(err)) {
        throw new ImmichError(
          'timeout',
          `${label} timed out after ${timeoutMs} ms`,
        )
      }
      throw new ImmichError(
        'network',
        `${label} failed: could not reach Immich`,
      )
    }

    const text = await res.text().catch(() => '')
    if (!res.ok) {
      throw new ImmichError(
        'http_error',
        `${label} failed with ${res.status}${describe(text)}`,
        res.status,
      )
    }
    if (!schema) return

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new ImmichError(
        'bad_response',
        `${label} returned a non-JSON body`,
        res.status,
      )
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) {
      throw new ImmichError(
        'bad_response',
        `${label} returned an unexpected body`,
        res.status,
      )
    }
    return parsed.data
  }
}

// Immich errors look like { message: string | string[], error, statusCode }.
function describe(text: string): string {
  try {
    const json: unknown = JSON.parse(text)
    if (typeof json === 'object' && json !== null && 'message' in json) {
      const { message } = json
      const flat = Array.isArray(message)
        ? message.filter(m => typeof m === 'string').join('; ')
        : typeof message === 'string'
          ? message
          : ''
      if (flat) return `: ${flat.slice(0, MAX_MESSAGE_LENGTH)}`
    }
  } catch {
    // Not JSON: say nothing rather than echo an arbitrary body.
  }
  return ''
}

// Duck-typed: the DOMException from AbortSignal.timeout is not an `Error`
// instance in every realm (Jest's VM sandbox, for one).
function isTimeout(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    err.name === 'TimeoutError'
  )
}
