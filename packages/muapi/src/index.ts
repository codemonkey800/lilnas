import { type Client, createClient, createConfig } from './generated/client'

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
 *
 * Generation is async and results are delivered by webhook (see README.md).
 * This endpoint is only meant as a one-off reconciliation fallback for jobs
 * whose webhook never arrived; do not poll it in a loop.
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

/**
 * Body muapi POSTs to the `?webhook=` URL when a job finishes. Documented at
 * https://muapi.ai/docs/webhooks (not in the OpenAPI spec).
 *
 * - `id` is the same value as the `request_id` returned at submit time.
 * - Only `completed` and `failed` are delivered; `cancelled` is not documented.
 * - Deliveries are NOT signed, and muapi retries up to 3 times with exponential
 *   backoff, so receivers must authenticate the URL themselves and be
 *   idempotent on `id`.
 */
export interface WebhookPayload {
  id: string
  status: 'completed' | 'failed'
  /** Present only when `status` is `completed`. */
  outputs?: string[]
  /** Present only when `status` is `failed`. */
  error?: string
  has_nsfw_contents?: boolean[]
  created_at?: string
  urls?: { get: string }
  executionTime?: number | string
  timings?: { inference?: number | string }
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
