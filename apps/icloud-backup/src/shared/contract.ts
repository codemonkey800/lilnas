// The wire contract between the backend and the frontend. Both import from
// here; nothing in this file may depend on Nest, Node or React.
import { z } from 'zod'

export const BACKUP_STATES = [
  'queued_login',
  'need_password',
  'checking_password',
  'need_code',
  'checking_code',
  'previewing',
  'review_download',
  'queued_download',
  'indexing_wait',
  'downloading',
  'provisioning',
  'done',
  'needs_login',
  'paused_low_disk',
  'failed',
  'cancelled',
] as const

export const ERROR_CODES = [
  'wrong_password',
  'login_timeout',
  'interrupted_login',
  'apple_access_denied',
  'apple_indexing',
  'icloudpd_error',
  'immich_error',
  'internal',
] as const

export const BackupStateSchema = z.enum(BACKUP_STATES)
export type BackupState = z.infer<typeof BackupStateSchema>

export const ErrorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

/** A job in one of these states is finished; no more events follow it. */
export const TERMINAL_STATES = [
  'done',
  'needs_login',
  'paused_low_disk',
  'failed',
  'cancelled',
] as const satisfies readonly BackupState[]

export function isTerminalState(state: BackupState): boolean {
  return (TERMINAL_STATES as readonly BackupState[]).includes(state)
}

// --- views (server to client) ---

export const JobViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['first_backup', 'sync']),
  state: BackupStateSchema,
  // Shown on the form being retried.
  authError: z.enum(['wrong_password', 'wrong_code']).nullable(),
  // 1 = next; only in queued_login.
  queuePosition: z.number().int().nullable(),
  // Files a download would fetch; set in review_download.
  previewItems: z.number().int().nullable(),
  totalItems: z.number().int().nullable(),
  downloadedItems: z.number().int(),
  skippedItems: z.number().int(),
  downloadedBytes: z.number(),
  // Path relative to the person's folder.
  currentFile: z.string().nullable(),
  // Indexing retries so far.
  attempt: z.number().int(),
  maxAttempts: z.number().int(),
  // ISO timestamp; only in indexing_wait.
  retryAt: z.string().nullable(),
  errorCode: ErrorCodeSchema.nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type JobView = z.infer<typeof JobViewSchema>

export const BackupAccountViewSchema = z.object({
  appleId: z.string(),
  // True once a download has started.
  appleIdLocked: z.boolean(),
  // Linked to a folder and library that existed before.
  adopted: z.boolean(),
  lastBackupAt: z.string().nullable(),
  totalItems: z.number().int(),
  totalBytes: z.number(),
  immich: z
    .object({
      email: z.string(),
      createdByUs: z.boolean(),
      url: z.string(),
    })
    .nullable(),
})

export const BackupViewSchema = z.object({
  email: z.string(),
  isAdmin: z.boolean(),
  lowDiskSpace: z.boolean(),
  account: BackupAccountViewSchema.nullable(),
  // The active job, else the most recent one.
  job: JobViewSchema.nullable(),
})
export type BackupView = z.infer<typeof BackupViewSchema>

export const AdminAccountRowSchema = z.object({
  email: z.string(),
  appleId: z.string(),
  folder: z.string(),
  state: BackupStateSchema.nullable(),
  lastBackupAt: z.string().nullable(),
  totalItems: z.number().int(),
  totalBytes: z.number(),
  hasImmich: z.boolean(),
})
export type AdminAccountRow = z.infer<typeof AdminAccountRowSchema>

export const AdminPresetSchema = z.object({
  lilnasEmail: z.string(),
  folder: z.string(),
  immichLibraryId: z.string(),
  immichLibraryName: z.string(),
})
export type AdminPreset = z.infer<typeof AdminPresetSchema>

export const AdminLibraryOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  importPaths: z.array(z.string()),
})
export type AdminLibraryOption = z.infer<typeof AdminLibraryOptionSchema>

// --- requests (client to server) ---

const emailAddress = z.string().trim().toLowerCase().pipe(z.email())

// A folder name is one path segment under PHOTOS_ROOT: no separators, no NUL,
// and not a relative-path component.
const folderName = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^/\\\0]+$/, 'must not contain a path separator')
  .refine(name => name !== '.' && name !== '..', 'must not be . or ..')

export const PresetBodySchema = z.object({
  lilnasEmail: emailAddress,
  folder: folderName,
  immichLibraryId: z.string().trim().min(1),
})
export type PresetBody = z.infer<typeof PresetBodySchema>

/** An email address, trimmed and lower-cased. */
export const StartBackupBodySchema = z.object({ appleId: emailAddress })
export type StartBackupBody = z.infer<typeof StartBackupBodySchema>

/** Never trimmed: a password may begin or end with a space. */
export const PasswordBodySchema = z.object({
  password: z.string().min(1).max(256),
})
export type PasswordBody = z.infer<typeof PasswordBodySchema>

/** Exactly six digits. */
export const CodeBodySchema = z.object({ code: z.string().regex(/^\d{6}$/) })
export type CodeBody = z.infer<typeof CodeBodySchema>

// --- websocket (server to client only) ---

export const ServerMessageSchema = z.object({
  type: z.literal('backup'),
  data: BackupViewSchema,
})
export type ServerMessage = z.infer<typeof ServerMessageSchema>
