import { type Client, createClient, createConfig } from './generated/client'
import { getPredictionResultApiV1PredictionsIdResultGet } from './generated/sdk.gen'

export * from './generated/sdk.gen'
export type * from './generated/types.gen'

export const MUAPI_BASE_URL = 'https://api.muapi.ai'

export type PredictionStatus =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Shape of `GET /api/v1/predictions/{id}/result`. The OpenAPI spec leaves this
 * response untyped, so only the documented fields are declared here.
 */
export interface PredictionResult {
  id?: string
  request_id?: string
  status: PredictionStatus
  outputs?: string[]
  error?: string | null
  [key: string]: unknown
}

/** Submit responses from every generation endpoint (also untyped in the spec). */
export interface SubmitResponse {
  request_id: string
  [key: string]: unknown
}

export interface MuapiClientOptions {
  apiKey: string
  baseUrl?: string
}

/** Creates a client that sends `x-api-key` on every authenticated request. */
export function createMuapiClient({
  apiKey,
  baseUrl = MUAPI_BASE_URL,
}: MuapiClientOptions): Client {
  return createClient(createConfig({ baseUrl, auth: () => apiKey }))
}

export class PredictionError extends Error {
  constructor(
    message: string,
    readonly result: PredictionResult,
  ) {
    super(message)
    this.name = 'PredictionError'
  }
}

export interface WaitForPredictionOptions {
  client: Client
  requestId: string
  /** Delay between polls in ms. Defaults to 2000. */
  intervalMs?: number
  /** Give up after this many ms. Defaults to 10 minutes. */
  timeoutMs?: number
  signal?: AbortSignal
}

const TERMINAL_STATUSES = new Set<PredictionStatus>([
  'completed',
  'failed',
  'cancelled',
])

/**
 * Polls a prediction until it reaches a terminal status. Resolves with the
 * completed result; rejects with a `PredictionError` on failure/cancellation.
 */
export async function waitForPrediction({
  client,
  requestId,
  intervalMs = 2000,
  timeoutMs = 10 * 60 * 1000,
  signal,
}: WaitForPredictionOptions): Promise<PredictionResult> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    signal?.throwIfAborted()

    const { data } = await getPredictionResultApiV1PredictionsIdResultGet({
      client,
      path: { id: requestId },
      throwOnError: true,
      signal,
    })
    const result = data as PredictionResult

    if (TERMINAL_STATUSES.has(result.status)) {
      if (result.status !== 'completed') {
        throw new PredictionError(
          `Prediction ${requestId} ${result.status}${result.error ? `: ${result.error}` : ''}`,
          result,
        )
      }
      return result
    }

    if (Date.now() + intervalMs > deadline) {
      throw new Error(
        `Timed out waiting for prediction ${requestId} (last status: ${result.status})`,
      )
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
