import { z } from 'zod'

export const ImmichUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
})
export type ImmichUser = z.infer<typeof ImmichUserSchema>

export const ImmichLibrarySchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  importPaths: z.array(z.string()),
})
export type ImmichLibrary = z.infer<typeof ImmichLibrarySchema>

export const ValidateLibraryResponseSchema = z.object({
  importPaths: z.array(
    z.object({
      importPath: z.string(),
      isValid: z.boolean(),
      message: z.string().nullish(),
    }),
  ),
})

export interface ImmichOptions {
  /** Server origin without `/api`, e.g. `http://immich:2283`. */
  baseUrl: string
  apiKey: string
  /** Where the people's folders are mounted inside the Immich container. */
  importRoot: string
  /** Per-request timeout. Defaults to 10 s. */
  timeoutMs?: number
}

export const IMMICH_OPTIONS = Symbol('IMMICH_OPTIONS')
