import { z } from 'zod'

export const SettingsSchema = z.object({
  models: z.object({
    chat: z.string(),
    reasoning: z.string(),
    image: z.string(),
  }),
  temperature: z.number().min(0).max(2),
  reasoningEffort: z.enum(['low', 'medium', 'high']),
  systemPrompt: z.string().min(1).max(20_000),
})
export type Settings = z.infer<typeof SettingsSchema>

// zod 4 has no deepPartial(): spell the patch out
export const SettingsPatchSchema = SettingsSchema.partial().extend({
  models: SettingsSchema.shape.models.partial().optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>
