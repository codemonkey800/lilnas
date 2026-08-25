import { DownloadType, Media } from '@lilnas/utils/download/types'

import { mediaIdSuffix } from 'src/db/media-id'
import type { MediaKey } from 'src/media/media-resolver.service'

/**
 * A stand-in for `MediaResolverService` that answers from a fixture map,
 * falling back to a minimal well-formed `Media` for any key it doesn't know
 * about. Every service that renders a job now depends on the resolver, so
 * this keeps their specs about the service under test rather than about
 * Radarr/Sonarr mocking.
 */
export function createFakeMediaResolver(
  fixtures: Map<string, Media> = new Map(),
) {
  return {
    fixtures,
    invalidate: jest.fn(),
    resolve: jest.fn((keys: readonly MediaKey[]) =>
      Promise.resolve({
        // Widened rather than inferred as `never[]` so a test that needs to
        // simulate an outage can `mockResolvedValue` a populated list.
        degradedSources: [] as DownloadType[],
        media: new Map(
          keys.map(key => [
            key.mediaId,
            fixtures.get(key.mediaId) ?? defaultMedia(key),
          ]),
        ),
      }),
    ),
  }
}

function defaultMedia(key: MediaKey): Media {
  const suffix = Number(mediaIdSuffix(key.mediaId)) || 1

  switch (key.type) {
    case DownloadType.Movie:
      return {
        id: key.mediaId,
        title: 'A Movie',
        tmdbId: suffix,
        type: DownloadType.Movie,
      }
    case DownloadType.Show:
      return {
        id: key.mediaId,
        title: 'A Show',
        tvdbId: suffix,
        type: DownloadType.Show,
      }
    case DownloadType.Video:
      return {
        id: key.mediaId,
        sourceUrl: 'https://example.com/video',
        title: 'A video',
        type: DownloadType.Video,
      }
  }
}

/**
 * Lets a pending fire-and-forget broadcast chain settle. `broadcastJobEvent`
 * resolves media before it broadcasts, so the WS assertions need one turn of
 * the macrotask queue rather than just an `await`.
 */
export function flushAsync(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}
