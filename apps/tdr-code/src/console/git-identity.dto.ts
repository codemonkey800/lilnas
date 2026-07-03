import { z } from 'zod'

// Discord snowflake: 17–20 digit numeric string.
export const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, 'Must be a Discord snowflake (17–20 digits)')

export const UpsertGitIdentityBodySchema = z.object({
  discordUserId: DiscordSnowflakeSchema,
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

// A Discord guild member, as surfaced to the "pick a user" dropdown on the
// git-identity form. displayName is the best available human-readable
// name (server nickname > global display name > username) — Discord never
// exposes another member's email to a bot, so name/email on the form stay
// manual text entry regardless.
export const DiscordGuildMemberSchema = z.object({
  id: DiscordSnowflakeSchema,
  username: z.string(),
  displayName: z.string(),
})
export type DiscordGuildMemberDto = z.infer<typeof DiscordGuildMemberSchema>

export const DiscordGuildMemberListResponseSchema = z.array(
  DiscordGuildMemberSchema,
)
export type DiscordGuildMemberListResponseDto = DiscordGuildMemberDto[]
