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

// Response shape for GET /git/github/status (U4 addition, not in the
// original plan's file list — see this unit's implementation report for the
// full rationale). Resolves the CURRENT session user's own GitHub-link
// status server-side (req.user.id -> account/github_credential join), which
// the frontend cannot do itself: useSession()'s client-side `user` object
// carries only Better Auth's own opaque id/name/email/image, never the
// underlying Discord snowflake (confirmed against schema.ts's `user` table
// before adding this route — no client-side join was possible). Also
// surfaces `discordUserId` for display/correlation purposes on the same
// page. As of U5, the git-identity endpoints resolve the acting user's own
// discordUserId server-side too (see git-identity.controller.ts) rather than
// accepting one from the client — this field's value no longer needs to be
// sent back to those endpoints, but is still useful here for the page to
// show which Discord identity its SSH section is scoped to.
//
// `derivedName`/`derivedEmail` are present only when `linked` is true —
// never returns tokenCiphertext/tokenIv/tokenAuthTag or a decrypted token
// (R7), same posture as UnlinkGithubResponseSchema above.
export const GithubStatusResponseSchema = z.object({
  discordUserId: z.string().optional(),
  linked: z.boolean(),
  derivedName: z.string().optional(),
  derivedEmail: z.string().optional(),
})
export type GithubStatusResponseDto = z.infer<typeof GithubStatusResponseSchema>
