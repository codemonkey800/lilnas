import { z } from 'zod'

import type { SupervisorPhase } from 'src/supervisor/supervisor-machine'

export const RestartResponseSchema = z.object({
  phase: z.string() as z.ZodType<SupervisorPhase>,
})
export type RestartResponseDto = z.infer<typeof RestartResponseSchema>

export const TeardownResponseSchema = z.object({
  accepted: z.literal(true),
})
export type TeardownResponseDto = z.infer<typeof TeardownResponseSchema>
