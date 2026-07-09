import { z } from 'zod'

// Discord snowflake: 17–20 digit numeric string.
export const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Must be a Discord snowflake (17–20 digits)')

// U5: discordUserId is deliberately NOT a field here anymore — POST
// /git-identity is now purely self-service (mirrors github-link
// .controller.ts's own self/break-glass asymmetry, where there is no
// "act on behalf of someone else" upsert path at all). The controller
// resolves the acting user's own Discord snowflake server-side via
// getDiscordUserIdForUser(db, req.user.id) rather than trusting a
// client-supplied id — see git-identity.controller.ts's upsertIdentity.
export const UpsertGitIdentityBodySchema = z.object({
  name: z.string().min(1, 'name must not be empty').max(256),
  email: z.string().email('email must be a valid email address').max(256),
  // Raw private key blob — validated and encrypted before storage.
  // Never echoed back in any response (R9, write-only contract).
  privateKey: z.string().min(1, 'privateKey must not be empty'),
})
export type UpsertGitIdentityBodyDto = z.infer<
  typeof UpsertGitIdentityBodySchema
>

// Identity list item — never includes the private key.
export const GitIdentityItemSchema = z.object({
  discordUserId: z.string(),
  name: z.string(),
  email: z.string(),
  fingerprint: z.string(),
  status: z.enum(['configured', 'decrypt_failed']),
})
export type GitIdentityItemDto = z.infer<typeof GitIdentityItemSchema>

export const GitIdentityListResponseSchema = z.array(GitIdentityItemSchema)
export type GitIdentityListResponseDto = GitIdentityItemDto[]

export const UpsertGitIdentityResponseSchema = z.object({
  discordUserId: z.string(),
  fingerprint: z.string(),
  status: z.literal('configured'),
})
export type UpsertGitIdentityResponseDto = z.infer<
  typeof UpsertGitIdentityResponseSchema
>

// A Discord guild member. Originally surfaced to the git-identity form's
// "pick a user" dropdown (removed in U5 — R2 closes that gap for real, not
// just in the UI); still used by discord-directory.service.ts and
// git-roster.service.ts for the roster's per-member display names.
// displayName is the best available human-readable name (server nickname >
// global display name > username) — Discord never exposes another member's
// email to a bot.
//
// U5 removed DiscordGuildMemberListResponseSchema/Dto (the LIST-wrapper
// alias) alongside GET /git-identity/discord-members — its only consumers
// were that removed route's test fixtures and api.ts's now-removed
// listDiscordGuildMembers. This singular-member schema/type stays: it has
// independent, still-live consumers.
export const DiscordGuildMemberSchema = z.object({
  id: DiscordSnowflakeSchema,
  username: z.string(),
  displayName: z.string(),
})
export type DiscordGuildMemberDto = z.infer<typeof DiscordGuildMemberSchema>
