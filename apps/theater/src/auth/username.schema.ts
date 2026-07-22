import { z } from 'zod'

export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 20

// ASCII letters/digits only, with single spaces/underscores/hyphens allowed
// between characters — never leading or trailing. Blocks unicode, control
// characters, and markup-ish symbols so a username is always safe to render
// later (e.g. as a multiplayer nameplate).
const USERNAME_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9 _-]*[A-Za-z0-9])?$/

export const UsernameSchema = z
  .string()
  .trim()
  .min(
    USERNAME_MIN_LENGTH,
    `Username must be at least ${USERNAME_MIN_LENGTH} characters`,
  )
  .max(
    USERNAME_MAX_LENGTH,
    `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
  )
  .regex(
    USERNAME_PATTERN,
    'Username may only contain letters, numbers, spaces, underscores, and hyphens, and must start/end with a letter or number',
  )
