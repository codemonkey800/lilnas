import { randomInt } from 'node:crypto'
import { access, constants, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { Inject, Injectable, Logger } from '@nestjs/common'

import { ImmichClient } from './immich.client'
import { ImmichError } from './immich.errors'
import type { ImmichLibrary, ImmichOptions } from './immich.types'
import { IMMICH_OPTIONS } from './immich.types'

const LIBRARY_NAME = 'iCloud'
const GENERATED_PASSWORD_LENGTH = 32
const TEMPORARY_PASSWORD_LENGTH = 20
const ALPHANUMERIC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
// No 0/O, 1/l/I: a person types this by hand.
const UNAMBIGUOUS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'

function randomString(alphabet: string, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)]
  return out
}

function trimTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, '')
}

/** Why the backend cannot read a person's folder, or undefined if it can. */
async function folderProblem(dir: string): Promise<string | undefined> {
  try {
    if (!(await stat(dir)).isDirectory()) return 'it is not a folder'
    await access(dir, constants.R_OK | constants.X_OK)
    return undefined
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'it does not exist'
    if (code === 'EACCES' || code === 'EPERM') return 'it is not readable'
    return `it could not be checked (${code ?? 'unknown error'})`
  }
}

export interface EnsuredImmichAccount {
  userId: string
  libraryId: string
  email: string
  createdByUs: boolean
}

@Injectable()
export class ImmichProvisioner {
  private readonly logger = new Logger(ImmichProvisioner.name)

  constructor(
    private readonly client: ImmichClient,
    @Inject(IMMICH_OPTIONS) private readonly options: ImmichOptions,
  ) {}

  /**
   * Make sure the person has an Immich user and one library on their folder,
   * then start a scan. Every step looks before it creates, so calling it
   * again after a crash at any point finishes the job without duplicates.
   *
   * `createdByUs` is true when this call created the user, or when the user
   * found by email has the id in `knownCreatedUserId` (a user an earlier call
   * created and the caller saved). `onUserCreated` is awaited right after the
   * user is created and before the library is: if the library step then
   * fails, the caller already holds the fact that the user is ours, which it
   * passes back as `knownCreatedUserId` on the retry. The generated password
   * is discarded, so without that fact nobody could ever sign in.
   *
   * The folder is checked here, on the backend's own mount, before anything
   * is created: Immich's `POST /libraries/:id/validate` needs an `all` API
   * key, which the production key deliberately lacks.
   */
  async ensure(input: {
    email: string
    slug: string
    onUserCreated?: (user: { userId: string; email: string }) => Promise<void>
    knownCreatedUserId?: string | null
  }): Promise<EnsuredImmichAccount> {
    const importPath = `${trimTrailingSlashes(this.options.importRoot)}/${input.slug}`
    const localPath = join(this.options.photosRoot, input.slug)
    const problem = await folderProblem(localPath)
    if (problem) {
      throw new ImmichError(
        'import_path_invalid',
        `Cannot use ${importPath}: ${problem}`,
      )
    }
    const wanted = input.email.trim().toLowerCase()

    const [users, libraries] = await Promise.all([
      this.client.listUsers(),
      this.client.listLibraries(),
    ])
    const existingUser = users.find(
      u => u.email.trim().toLowerCase() === wanted,
    )

    // Decide about the folder before creating anything: a library on the
    // same folder owned by someone else would show every photo twice.
    const onPath = libraries.filter(l =>
      l.importPaths.some(p => trimTrailingSlashes(p) === importPath),
    )
    const ownLibrary = existingUser
      ? onPath.find(l => l.ownerId === existingUser.id)
      : undefined
    if (!ownLibrary && onPath.length > 0) {
      throw new ImmichError(
        'import_path_taken',
        `An Immich library owned by another user already uses ${importPath}`,
      )
    }

    let user = existingUser
    let createdByUs: boolean
    if (user) {
      createdByUs =
        !!input.knownCreatedUserId && user.id === input.knownCreatedUserId
    } else {
      user = await this.client.createUser({
        email: input.email.trim(),
        name: input.email.trim(),
        // Discarded: the person gets a temporary password on request.
        password: randomString(ALPHANUMERIC, GENERATED_PASSWORD_LENGTH),
      })
      createdByUs = true
      this.logger.log({ userId: user.id }, 'Created Immich user')
      await input.onUserCreated?.({ userId: user.id, email: user.email })
    }

    const library: ImmichLibrary =
      ownLibrary ??
      (await this.client.createLibrary({
        ownerId: user.id,
        name: LIBRARY_NAME,
        importPath,
      }))
    if (!ownLibrary) {
      this.logger.log(
        { userId: user.id, libraryId: library.id },
        'Created Immich library',
      )
    }

    await this.client.scanLibrary(library.id)
    this.logger.log(
      { userId: user.id, libraryId: library.id },
      'Started Immich library scan',
    )

    return {
      userId: user.id,
      libraryId: library.id,
      email: user.email,
      createdByUs,
    }
  }

  /** Reset the user's password to a new random one and return it. */
  async newTemporaryPassword(userId: string): Promise<string> {
    const password = randomString(UNAMBIGUOUS, TEMPORARY_PASSWORD_LENGTH)
    await this.client.resetPassword(userId, password)
    this.logger.log({ userId }, 'Reset Immich password')
    return password
  }
}
