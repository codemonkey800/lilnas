import { z } from 'zod'

/**
 * Shared search query input validation schema used by both Radarr and Sonarr services.
 */
export const SearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters')
    .max(200, 'Search query must be less than 200 characters'),
})

/**
 * Shared optional search query schema for library filtering.
 */
export const OptionalSearchQuerySchema = z.object({
  query: z
    .string()
    .trim()
    .min(2, 'Search query must be at least 2 characters')
    .max(200, 'Search query must be less than 200 characters')
    .optional(),
})

/**
 * Shared system status schema — Radarr and Sonarr return identical fields.
 */
export const SystemStatusSchema = z.object({
  appName: z.string(),
  version: z.string(),
  buildTime: z.string().datetime(),
  isDebug: z.boolean(),
  isProduction: z.boolean(),
  isAdmin: z.boolean(),
  isUserInteractive: z.boolean(),
  startupPath: z.string(),
  appData: z.string(),
  osName: z.string(),
  osVersion: z.string(),
  isMonoRuntime: z.boolean(),
  isMono: z.boolean(),
  isLinux: z.boolean(),
  isOsx: z.boolean(),
  isWindows: z.boolean(),
  branch: z.string(),
  authentication: z.string(),
  sqliteVersion: z.string(),
  migrationVersion: z.number().int().nonnegative(),
  urlBase: z.string().optional(),
  runtimeVersion: z.string(),
  runtimeName: z.string(),
  startTime: z.string().datetime(),
  packageVersion: z.string().optional(),
  packageAuthor: z.string().optional(),
  packageUpdateMechanism: z.string().optional(),
})

/**
 * Shared quality profile schema — identical structure in both Radarr and Sonarr.
 */
export const QualityProfileSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  upgradeAllowed: z.boolean(),
  cutoff: z.number().int(),
  items: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        quality: z
          .object({
            id: z.number().int(),
            name: z.string(),
            source: z.string(),
            resolution: z.number().int(),
            modifier: z.string(),
          })
          .optional(),
        items: z.array(z.unknown()).optional(),
        allowed: z.boolean(),
      }),
    )
    .optional(),
  minFormatScore: z.number().int(),
  cutoffFormatScore: z.number().int(),
  formatItems: z
    .array(
      z.object({
        format: z.object({
          id: z.number().int(),
          name: z.string(),
        }),
        score: z.number().int(),
      }),
    )
    .optional(),
  language: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
})

/**
 * Shared root folder schema — identical structure in both Radarr and Sonarr.
 */
export const RootFolderSchema = z.object({
  id: z.number().int(),
  path: z.string(),
  accessible: z.boolean(),
  freeSpace: z.number().int(),
  totalSpace: z.number().int(),
  unmappedFolders: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
    }),
  ),
})

export type SearchQueryInput = z.infer<typeof SearchQuerySchema>
export type OptionalSearchQueryInput = z.infer<typeof OptionalSearchQuerySchema>
