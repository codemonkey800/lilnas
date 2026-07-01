import { z } from 'zod'

// Shell metacharacter denylist for claudeCommand — prevents command injection
// via the operator-editable spawn lever.
const SHELL_META = /[;&|`$<>!(){}'"\\\n\r]/

export const UpdateConfigBodySchema = z.object({
  cwd: z.string().min(1, 'cwd must not be empty'),
  claudeCommand: z
    .string()
    .min(1, 'claudeCommand must not be empty')
    .refine(v => v.trim().length > 0, 'claudeCommand must not be whitespace-only')
    .refine(v => !SHELL_META.test(v), 'claudeCommand must not contain shell metacharacters'),
  claudeArgs: z
    .array(z.string())
    .max(64, 'claudeArgs must have at most 64 elements')
    .refine(
      args => args.every(a => !a.includes('\0')),
      'claudeArgs must not contain NUL bytes',
    ),
  idleTimeoutSec: z
    .number()
    .int()
    .min(1, 'idleTimeoutSec must be at least 1'),
  maxConcurrentSessions: z
    .number()
    .int()
    .min(1, 'maxConcurrentSessions must be at least 1'),
})
export type UpdateConfigBodyDto = z.infer<typeof UpdateConfigBodySchema>

export const ConfigResponseSchema = z.object({
  cwd: z.string(),
  claudeCommand: z.string(),
  claudeArgs: z.array(z.string()),
  idleTimeoutSec: z.number(),
  maxConcurrentSessions: z.number(),
})
export type ConfigResponseDto = z.infer<typeof ConfigResponseSchema>
