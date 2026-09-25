import { DownloadApiError } from '@lilnas/utils/download/client'
import type {
  BadFile,
  DownloadJob,
  ManualImportCandidate,
  Release,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { revalidatePath } from 'next/cache'

import {
  deleteMediaFiles,
  discardImport,
  flagBadFile,
  grabRelease,
  importFiles,
  listImportCandidates,
  replaceRelease,
  searchReleases,
  unflagBadFile,
} from 'src/app/actions/media-files'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}))

const mockGetClient = jest.mocked(getIdentifiedDownloadClient)
const mockRevalidate = jest.mocked(revalidatePath)

const MOVIE_ID = 'tmdb:438631'
const SHOW_ID = 'tvdb:121361'

const JOB: DownloadJob = {
  completedAt: null,
  createdAt: '2026-09-15T12:00:00.000Z',
  discordRequester: null,
  hiddenAttribution: false,
  id: 'job_1',
  linkedDiscord: null,
  media: {
    id: MOVIE_ID,
    title: 'Dune',
    tmdbId: 438631,
    type: DownloadType.Movie,
  },
  requester: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  status: DownloadJobStatus.Downloading,
  updatedAt: '2026-09-15T12:00:00.000Z',
}

const FLAG: BadFile = {
  createdAt: '2026-09-15T12:00:00.000Z',
  flaggedBy: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  id: 7,
  indexerId: 3,
  mediaId: MOVIE_ID,
  reason: "Video won't play",
  releaseGuid: 'guid-bad',
  releaseTitle: 'Dune.2021.720p.HDTV',
}

const RELEASE: Release = {
  downloadAllowed: true,
  flaggedBad: false,
  guid: 'guid-1',
  indexerId: 3,
  rejected: false,
  title: 'Dune.2021.1080p.WEB-DL',
}

const CANDIDATE: ManualImportCandidate = {
  importable: true,
  name: 'Dune.2021.1080p.WEB-DL.mkv',
  path: '/downloads/Dune.2021.1080p.WEB-DL/Dune.2021.1080p.WEB-DL.mkv',
  quality: { name: 'WEBDL-1080p', resolution: 1080 },
  rejections: [],
  size: 8_589_934_592,
}

/**
 * Every client method the module can reach, all as spies, so a test can assert
 * on the ones it expects *and* on the ones it must not have touched. That
 * second half is the point of the shape: "replace is one call" is only provable
 * by showing `deleteMediaFiles` and `grabRelease` were never called.
 */
function stubClient(overrides: Record<string, jest.Mock> = {}) {
  const client = {
    deleteMediaFiles: jest.fn(),
    discardImport: jest.fn(),
    flagBadFile: jest.fn(),
    grabRelease: jest.fn(),
    importFiles: jest.fn(),
    listImportCandidates: jest.fn(),
    listReleases: jest.fn(),
    replaceRelease: jest.fn(),
    unflagBadFile: jest.fn(),
    ...overrides,
  }

  mockGetClient.mockResolvedValue(
    client as unknown as Awaited<
      ReturnType<typeof getIdentifiedDownloadClient>
    >,
  )

  return client
}

/** What Next throws for a static-generation bailout, a redirect or a notFound. */
const BAILOUT = Object.assign(new Error('DYNAMIC_SERVER_USAGE'), {
  digest: 'DYNAMIC_SERVER_USAGE',
})

describe('identity', () => {
  it.each([
    [
      'grabRelease',
      () => grabRelease(MOVIE_ID, { guid: 'g', indexerId: 1 }),
      'grabRelease',
    ],
    [
      'replaceRelease',
      () => replaceRelease(MOVIE_ID, { guid: 'g', indexerId: 1 }),
      'replaceRelease',
    ],
    ['flagBadFile', () => flagBadFile(MOVIE_ID, { guid: 'g' }), 'flagBadFile'],
    ['unflagBadFile', () => unflagBadFile(MOVIE_ID, 7), 'unflagBadFile'],
    ['deleteMediaFiles', () => deleteMediaFiles(MOVIE_ID), 'deleteMediaFiles'],
    ['searchReleases', () => searchReleases(MOVIE_ID), 'listReleases'],
    [
      'listImportCandidates',
      () => listImportCandidates(MOVIE_ID, {}),
      'listImportCandidates',
    ],
    [
      'importFiles',
      () => importFiles(MOVIE_ID, { paths: ['/downloads/a.mkv'] }),
      'importFiles',
    ],
    ['discardImport', () => discardImport(MOVIE_ID, {}), 'discardImport'],
  ])(
    // ⚠️ The single most important server-side rule in the app: a plain
    // `DownloadClient.localInstance` drops `X-Forwarded-User` and persists every
    // web-originated mutation as an unattributed service call. `flagBadFile` and
    // `unflagBadFile` additionally answer 401 without it.
    '%s goes through getIdentifiedDownloadClient',
    async (_name, call, method) => {
      stubClient({ [method]: jest.fn().mockResolvedValue({ badFile: FLAG }) })

      await call()

      expect(mockGetClient).toHaveBeenCalledTimes(1)
    },
  )
})

describe('grabRelease', () => {
  it('passes the pick through and hands back the job', async () => {
    const client = stubClient({ grabRelease: jest.fn().mockResolvedValue(JOB) })

    const result = await grabRelease(MOVIE_ID, {
      guid: 'guid-1',
      indexerId: 3,
    })

    expect(client.grabRelease).toHaveBeenCalledWith(MOVIE_ID, {
      guid: 'guid-1',
      indexerId: 3,
    })
    expect(result).toEqual({ job: JOB })
  })

  it('carries a show scope straight through', async () => {
    const client = stubClient({ grabRelease: jest.fn().mockResolvedValue(JOB) })

    await grabRelease(SHOW_ID, {
      episodeId: 4823,
      guid: 'guid-1',
      indexerId: 3,
      seasonNumber: 2,
    })

    expect(client.grabRelease).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
      guid: 'guid-1',
      indexerId: 3,
      seasonNumber: 2,
    })
  })

  it('revalidates the detail route the media key names', async () => {
    stubClient({ grabRelease: jest.fn().mockResolvedValue(JOB) })

    await grabRelease(MOVIE_ID, { guid: 'guid-1', indexerId: 3 })

    expect(mockRevalidate).toHaveBeenCalledWith('/movies/438631')
  })

  it('names the flagged-bad refusal on a 409 rather than saying "try again"', async () => {
    // The UI disables a flagged row and says why, so reaching this means a flag
    // landed from another tab between the search and the click. The message has
    // to name the same cause the disabled row named.
    stubClient({
      grabRelease: jest
        .fn()
        .mockRejectedValue(
          new DownloadApiError(409, 'Conflict', { message: 'flagged' }),
        ),
    })

    const result = await grabRelease(MOVIE_ID, {
      guid: 'guid-bad',
      indexerId: 3,
    })

    expect(result).toEqual({
      error: 'That release is reported as a bad file — pick another one',
    })
  })

  it('falls back to the generic failure for anything else', async () => {
    stubClient({
      grabRelease: jest.fn().mockRejectedValue(new Error('socket hang up')),
    })

    const result = await grabRelease(MOVIE_ID, { guid: 'g', indexerId: 3 })

    expect(result).toEqual({
      error: 'Could not start that download — try again',
    })
  })

  it('does not revalidate a failed grab', async () => {
    stubClient({
      grabRelease: jest.fn().mockRejectedValue(new Error('nope')),
    })

    await grabRelease(MOVIE_ID, { guid: 'g', indexerId: 3 })

    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework bailout instead of swallowing it', async () => {
    // Swallowing a value carrying a string `digest` turns "render this route
    // dynamically" into a user-facing error message and breaks the build's
    // dynamic-rendering detection.
    stubClient({ grabRelease: jest.fn().mockRejectedValue(BAILOUT) })

    await expect(
      grabRelease(MOVIE_ID, { guid: 'g', indexerId: 3 }),
    ).rejects.toBe(BAILOUT)
  })
})

describe('replaceRelease', () => {
  it('is ONE call — never a delete followed by a grab', async () => {
    // ⚠️ The whole reason `POST …/releases/replace` exists. The backend deletes
    // and grabs as a single action, so a failure cannot leave the title with a
    // deleted file and no replacement. A client-side two-step would reopen
    // exactly the window the endpoint was built to close.
    const client = stubClient({
      replaceRelease: jest.fn().mockResolvedValue(JOB),
    })

    const result = await replaceRelease(MOVIE_ID, {
      guid: 'guid-2',
      indexerId: 4,
    })

    expect(client.replaceRelease).toHaveBeenCalledTimes(1)
    expect(client.replaceRelease).toHaveBeenCalledWith(MOVIE_ID, {
      guid: 'guid-2',
      indexerId: 4,
    })
    expect(client.deleteMediaFiles).not.toHaveBeenCalled()
    expect(client.grabRelease).not.toHaveBeenCalled()
    expect(result).toEqual({ job: JOB })
  })

  it('names the flagged-bad refusal on a 409', async () => {
    stubClient({
      replaceRelease: jest
        .fn()
        .mockRejectedValue(
          new DownloadApiError(409, 'Conflict', { message: 'flagged' }),
        ),
    })

    expect(
      await replaceRelease(MOVIE_ID, { guid: 'guid-bad', indexerId: 3 }),
    ).toEqual({
      error: 'That release is reported as a bad file — pick another one',
    })
  })

  it('has its own failure copy, because a failed replace is not a failed grab', async () => {
    stubClient({
      replaceRelease: jest.fn().mockRejectedValue(new Error('boom')),
    })

    expect(await replaceRelease(MOVIE_ID, { guid: 'g', indexerId: 3 })).toEqual(
      { error: 'Could not replace that file — try again' },
    )
  })

  it('re-throws a framework bailout', async () => {
    stubClient({ replaceRelease: jest.fn().mockRejectedValue(BAILOUT) })

    await expect(
      replaceRelease(MOVIE_ID, { guid: 'g', indexerId: 3 }),
    ).rejects.toBe(BAILOUT)
  })
})

describe('flagBadFile', () => {
  it('sends the denormalized copies the flag stays readable by', async () => {
    const client = stubClient({
      flagBadFile: jest.fn().mockResolvedValue({ badFile: FLAG }),
    })

    await flagBadFile(MOVIE_ID, {
      guid: 'guid-bad',
      indexerId: 3,
      reason: "Video won't play",
      title: 'Dune.2021.720p.HDTV',
    })

    expect(client.flagBadFile).toHaveBeenCalledWith(MOVIE_ID, {
      guid: 'guid-bad',
      indexerId: 3,
      reason: "Video won't play",
      title: 'Dune.2021.720p.HDTV',
    })
  })

  it('treats a repeat flag as success, because the endpoint is idempotent', async () => {
    // `POST …/bad-files` is idempotent on `(mediaId, releaseGuid)` and answers
    // a re-flag with the ORIGINAL row rather than erroring. Both calls are
    // therefore successes carrying the same `badFile`, and neither is an error.
    const client = stubClient({
      flagBadFile: jest.fn().mockResolvedValue({ badFile: FLAG }),
    })

    const first = await flagBadFile(MOVIE_ID, { guid: 'guid-bad' })
    const second = await flagBadFile(MOVIE_ID, { guid: 'guid-bad' })

    expect(client.flagBadFile).toHaveBeenCalledTimes(2)
    expect(first).toEqual({ badFile: FLAG })
    expect(second).toEqual({ badFile: FLAG })
    expect(second).not.toHaveProperty('error')
  })

  it('reports a real failure without inventing an "already reported" branch', async () => {
    stubClient({
      flagBadFile: jest.fn().mockRejectedValue(new Error('offline')),
    })

    expect(await flagBadFile(MOVIE_ID, { guid: 'g' })).toEqual({
      error: 'Could not send that report — try again',
    })
  })
})

describe('unflagBadFile', () => {
  it('addresses the flag by row id, not by guid', async () => {
    const client = stubClient({
      unflagBadFile: jest.fn().mockResolvedValue({ badFile: FLAG }),
    })

    expect(await unflagBadFile(MOVIE_ID, 7)).toEqual({ badFile: FLAG })
    expect(client.unflagBadFile).toHaveBeenCalledWith(MOVIE_ID, 7)
  })

  it('answers with its own failure copy', async () => {
    stubClient({
      unflagBadFile: jest.fn().mockRejectedValue(new Error('offline')),
    })

    expect(await unflagBadFile(MOVIE_ID, 7)).toEqual({
      error: 'Could not undo that report — try again',
    })
  })
})

describe('deleteMediaFiles', () => {
  it('deletes the whole title when the query is empty', async () => {
    const client = stubClient({
      deleteMediaFiles: jest
        .fn()
        .mockResolvedValue({ deletedCount: 24, mediaId: SHOW_ID }),
    })

    expect(await deleteMediaFiles(SHOW_ID)).toEqual({ deletedCount: 24 })
    expect(client.deleteMediaFiles).toHaveBeenCalledWith(SHOW_ID, {})
  })

  it('passes a season scope through untouched', async () => {
    const client = stubClient({
      deleteMediaFiles: jest
        .fn()
        .mockResolvedValue({ deletedCount: 7, mediaId: SHOW_ID }),
    })

    await deleteMediaFiles(SHOW_ID, { seasonNumber: 2 })

    expect(client.deleteMediaFiles).toHaveBeenCalledWith(SHOW_ID, {
      seasonNumber: 2,
    })
  })

  it('passes an episode scope through untouched', async () => {
    const client = stubClient({
      deleteMediaFiles: jest
        .fn()
        .mockResolvedValue({ deletedCount: 1, mediaId: SHOW_ID }),
    })

    await deleteMediaFiles(SHOW_ID, { episodeId: 4823 })

    expect(client.deleteMediaFiles).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
    })
  })

  it('treats deleting zero files as a success', async () => {
    // The caller asked for a state, and that state already held.
    stubClient({
      deleteMediaFiles: jest
        .fn()
        .mockResolvedValue({ deletedCount: 0, mediaId: MOVIE_ID }),
    })

    expect(await deleteMediaFiles(MOVIE_ID)).toEqual({ deletedCount: 0 })
  })

  it('revalidates the show route for a tvdb key', async () => {
    stubClient({
      deleteMediaFiles: jest
        .fn()
        .mockResolvedValue({ deletedCount: 1, mediaId: SHOW_ID }),
    })

    await deleteMediaFiles(SHOW_ID, { episodeId: 4823 })

    expect(mockRevalidate).toHaveBeenCalledWith('/shows/121361')
  })

  it('still deletes when the key names no route this app renders', async () => {
    const client = stubClient({
      deleteMediaFiles: jest
        .fn()
        .mockResolvedValue({ deletedCount: 1, mediaId: 'imdb:tt0111161' }),
    })

    expect(await deleteMediaFiles('imdb:tt0111161')).toEqual({
      deletedCount: 1,
    })
    expect(client.deleteMediaFiles).toHaveBeenCalled()
    expect(mockRevalidate).not.toHaveBeenCalled()
  })
})

describe('searchReleases', () => {
  it('unwraps the release list', async () => {
    const client = stubClient({
      listReleases: jest.fn().mockResolvedValue({ releases: [RELEASE] }),
    })

    expect(await searchReleases(MOVIE_ID)).toEqual({ releases: [RELEASE] })
    expect(client.listReleases).toHaveBeenCalledWith(MOVIE_ID, {})
  })

  it('scopes the search for a show', async () => {
    const client = stubClient({
      listReleases: jest.fn().mockResolvedValue({ releases: [] }),
    })

    await searchReleases(SHOW_ID, { episodeId: 4823, seasonNumber: 2 })

    expect(client.listReleases).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
      seasonNumber: 2,
    })
  })

  it('revalidates nothing — it changes nothing on this side', async () => {
    stubClient({
      listReleases: jest.fn().mockResolvedValue({ releases: [RELEASE] }),
    })

    await searchReleases(MOVIE_ID)

    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('answers with copy rather than throwing when no indexer replies', async () => {
    stubClient({
      listReleases: jest.fn().mockRejectedValue(new Error('gateway timeout')),
    })

    expect(await searchReleases(MOVIE_ID)).toEqual({
      error: 'No indexer answered — try again in a minute',
    })
  })
})

describe('listImportCandidates', () => {
  it('unwraps the candidate list', async () => {
    const client = stubClient({
      listImportCandidates: jest
        .fn()
        .mockResolvedValue({ candidates: [CANDIDATE] }),
    })

    expect(await listImportCandidates(MOVIE_ID, {})).toEqual({
      candidates: [CANDIDATE],
    })
    expect(client.listImportCandidates).toHaveBeenCalledWith(MOVIE_ID, {})
  })

  it('carries a show scope straight through', async () => {
    const client = stubClient({
      listImportCandidates: jest.fn().mockResolvedValue({ candidates: [] }),
    })

    await listImportCandidates(SHOW_ID, { episodeId: 4823, seasonNumber: 2 })

    expect(client.listImportCandidates).toHaveBeenCalledWith(SHOW_ID, {
      episodeId: 4823,
      seasonNumber: 2,
    })
  })

  it('revalidates nothing — it is a read', async () => {
    // The dialog calls this on open. Revalidating here would re-render the page
    // underneath the dialog that just asked for the list.
    stubClient({
      listImportCandidates: jest
        .fn()
        .mockResolvedValue({ candidates: [CANDIDATE] }),
    })

    await listImportCandidates(MOVIE_ID, {})

    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('answers with copy rather than throwing when the read fails', async () => {
    stubClient({
      listImportCandidates: jest
        .fn()
        .mockRejectedValue(new Error('gateway timeout')),
    })

    expect(await listImportCandidates(MOVIE_ID, {})).toEqual({
      error: 'Could not read what is waiting to import — try again',
    })
  })

  it('keeps the generic copy on a 404, and still revalidates nothing', async () => {
    // Unlike the two mutations, a missing queue row here just means there is
    // nothing to show — no stale page to fix, so no special copy and no
    // revalidation.
    stubClient({
      listImportCandidates: jest
        .fn()
        .mockRejectedValue(
          new DownloadApiError(404, 'Not Found', { message: 'no queue item' }),
        ),
    })

    expect(await listImportCandidates(MOVIE_ID, {})).toEqual({
      error: 'Could not read what is waiting to import — try again',
    })
    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework bailout instead of swallowing it', async () => {
    stubClient({
      listImportCandidates: jest.fn().mockRejectedValue(BAILOUT),
    })

    await expect(listImportCandidates(MOVIE_ID, {})).rejects.toBe(BAILOUT)
  })
})

describe('importFiles', () => {
  it('commits the ticked paths and hands back how many landed', async () => {
    const client = stubClient({
      importFiles: jest.fn().mockResolvedValue({ importedCount: 2 }),
    })

    const result = await importFiles(SHOW_ID, {
      paths: ['/downloads/s02e01.mkv', '/downloads/s02e02.mkv'],
      seasonNumber: 2,
    })

    expect(client.importFiles).toHaveBeenCalledWith(SHOW_ID, {
      paths: ['/downloads/s02e01.mkv', '/downloads/s02e02.mkv'],
      seasonNumber: 2,
    })
    expect(result).toEqual({ importedCount: 2 })
  })

  it('revalidates the detail route the media key names', async () => {
    stubClient({
      importFiles: jest.fn().mockResolvedValue({ importedCount: 1 }),
    })

    await importFiles(MOVIE_ID, { paths: ['/downloads/dune.mkv'] })

    expect(mockRevalidate).toHaveBeenCalledWith('/movies/438631')
  })

  it('says nothing is waiting on a 404 — and STILL revalidates', async () => {
    // ⚠️ The queue row is gone: another tab imported it, or the arr retried and
    // succeeded on its own. The page is stale by definition, so this failure
    // branch is the one that has to refresh it, or the user keeps staring at a
    // "needs attention" job upstream already resolved.
    stubClient({
      importFiles: jest
        .fn()
        .mockRejectedValue(
          new DownloadApiError(404, 'Not Found', { message: 'no queue item' }),
        ),
    })

    expect(
      await importFiles(MOVIE_ID, { paths: ['/downloads/dune.mkv'] }),
    ).toEqual({ error: 'Nothing is waiting to be imported any more' })
    expect(mockRevalidate).toHaveBeenCalledWith('/movies/438631')
  })

  it('falls back to the generic failure for anything else', async () => {
    stubClient({
      importFiles: jest.fn().mockRejectedValue(new Error('socket hang up')),
    })

    expect(
      await importFiles(MOVIE_ID, { paths: ['/downloads/dune.mkv'] }),
    ).toEqual({ error: 'Could not start the import — try again' })
  })

  it('does not revalidate a generic failure', async () => {
    stubClient({
      importFiles: jest.fn().mockRejectedValue(new Error('nope')),
    })

    await importFiles(MOVIE_ID, { paths: ['/downloads/dune.mkv'] })

    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework bailout instead of swallowing it', async () => {
    stubClient({ importFiles: jest.fn().mockRejectedValue(BAILOUT) })

    await expect(
      importFiles(MOVIE_ID, { paths: ['/downloads/dune.mkv'] }),
    ).rejects.toBe(BAILOUT)
  })
})

describe('discardImport', () => {
  it('discards the scope and hands back how many went', async () => {
    const client = stubClient({
      discardImport: jest.fn().mockResolvedValue({ discardedCount: 3 }),
    })

    const result = await discardImport(SHOW_ID, { seasonNumber: 2 })

    expect(client.discardImport).toHaveBeenCalledWith(SHOW_ID, {
      seasonNumber: 2,
    })
    expect(result).toEqual({ discardedCount: 3 })
  })

  it('treats discarding zero as a success', async () => {
    // Same rule as deleting zero files: the caller asked for a state, and that
    // state already held.
    stubClient({
      discardImport: jest.fn().mockResolvedValue({ discardedCount: 0 }),
    })

    expect(await discardImport(MOVIE_ID, {})).toEqual({ discardedCount: 0 })
  })

  it('revalidates the detail route the media key names', async () => {
    stubClient({
      discardImport: jest.fn().mockResolvedValue({ discardedCount: 1 }),
    })

    await discardImport(SHOW_ID, { episodeId: 4823 })

    expect(mockRevalidate).toHaveBeenCalledWith('/shows/121361')
  })

  it('says nothing is waiting on a 404 — and STILL revalidates', async () => {
    stubClient({
      discardImport: jest
        .fn()
        .mockRejectedValue(
          new DownloadApiError(404, 'Not Found', { message: 'no queue item' }),
        ),
    })

    expect(await discardImport(MOVIE_ID, {})).toEqual({
      error: 'Nothing is waiting to be imported any more',
    })
    expect(mockRevalidate).toHaveBeenCalledWith('/movies/438631')
  })

  it('has its own failure copy, because a failed discard is not a failed import', async () => {
    stubClient({
      discardImport: jest.fn().mockRejectedValue(new Error('offline')),
    })

    expect(await discardImport(MOVIE_ID, {})).toEqual({
      error: 'Could not discard that download — try again',
    })
  })

  it('does not revalidate a generic failure', async () => {
    stubClient({
      discardImport: jest.fn().mockRejectedValue(new Error('offline')),
    })

    await discardImport(MOVIE_ID, {})

    expect(mockRevalidate).not.toHaveBeenCalled()
  })

  it('re-throws a framework bailout instead of swallowing it', async () => {
    stubClient({ discardImport: jest.fn().mockRejectedValue(BAILOUT) })

    await expect(discardImport(MOVIE_ID, {})).rejects.toBe(BAILOUT)
  })
})
