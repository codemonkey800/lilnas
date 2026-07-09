import { z } from 'zod'

import { SUPERVISOR_PHASES } from 'src/supervisor/supervisor-machine'

export const RestartResponseSchema = z.object({
  phase: z.enum(SUPERVISOR_PHASES),
})
export type RestartResponseDto = z.infer<typeof RestartResponseSchema>

// accepted: true means the teardown command was enqueued, not that the session ended.
// The bot processes it asynchronously; a no-live-session target is a silent no-op.

export const TeardownResponseSchema = z.object({
  accepted: z.literal(true),
})
export type TeardownResponseDto = z.infer<typeof TeardownResponseSchema>
