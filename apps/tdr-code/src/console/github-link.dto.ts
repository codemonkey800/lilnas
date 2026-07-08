import { z } from 'zod'

// Better Auth user ids are opaque, library-generated strings — NOT Discord
// snowflakes (contrast git-identity.dto.ts's DiscordSnowflakeSchema, which
// must not be reused here). The only real constraint is "non-empty".
export const BetterAuthUserIdSchema = z
  .string()
  .min(1, 'userId must not be empty')

// Response shape for both DELETE /git/github (self-unlink) and
// DELETE /git/github/:userId (break-glass clear) — identical at the service
// layer (see github-link.service.ts's header comment), so one response DTO
// covers both routes. `unlinked: false` distinguishes the no-op case (no
// github_credential row existed) from an actual delete, without treating
// either outcome as an error (R13's unlink is idempotent).
export const UnlinkGithubResponseSchema = z.object({
  unlinked: z.boolean(),
})
export type UnlinkGithubResponseDto = z.infer<typeof UnlinkGithubResponseSchema>
