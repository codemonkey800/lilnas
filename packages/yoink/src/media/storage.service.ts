import {
  type DiskSpaceResource as RadarrDiskSpaceResource,
  getApiV3Diskspace as getRadarrDiskspace,
  getApiV3Movie,
  type MovieResource,
} from '@lilnas/media/radarr-next'
import {
  type DiskSpaceResource as SonarrDiskSpaceResource,
  getApiV3Diskspace as getSonarrDiskspace,
  getApiV3Series,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { Injectable } from '@nestjs/common'

import { cached } from './cache'
import { getRadarrClient, getSonarrClient } from './clients'
import type {
  LargestItem,
  RootFolderStorage,
  StorageOverview,
} from './storage.types'

const LARGEST_ITEMS_LIMIT = 20

/**
 * Finds the most specific root folder path that is a prefix of the given item
 * path. Returns the matched path, or null if none match.
 */
function matchRootFolder(
  itemPath: string | null | undefined,
  rootPaths: string[],
): string | null {
  if (!itemPath) return null
  const normalized = itemPath.endsWith('/') ? itemPath : itemPath + '/'
  let bestMatch: string | null = null
  for (const root of rootPaths) {
    const normalizedRoot = root.endsWith('/') ? root : root + '/'
    if (
      normalized.startsWith(normalizedRoot) &&
      (bestMatch === null || normalizedRoot.length > bestMatch.length)
    ) {
      bestMatch = root
    }
  }
  return bestMatch
}

@Injectable()
export class StorageService {
  async getStorageOverview(): Promise<StorageOverview> {
    const radarrClient = getRadarrClient()
    const sonarrClient = getSonarrClient()

    const [radarrDiskResult, sonarrDiskResult, movies, series] =
      await Promise.all([
        getRadarrDiskspace({ client: radarrClient }),
        getSonarrDiskspace({ client: sonarrClient }),
        cached('radarr:movies', 60_000, () =>
          getApiV3Movie({ client: radarrClient }).then(
            r => (r.data ?? []) as MovieResource[],
          ),
        ),
        cached('sonarr:series', 60_000, () =>
          getApiV3Series({ client: sonarrClient }).then(
            r => (r.data ?? []) as SeriesResource[],
          ),
        ),
      ])

    const radarrDisks = (radarrDiskResult.data ??
      []) as RadarrDiskSpaceResource[]
    const sonarrDisks = (sonarrDiskResult.data ??
      []) as SonarrDiskSpaceResource[]

    // Deduplicate disk entries by path — Radarr and Sonarr often report the
    // same physical disk. Keep the entry with the largest totalSpace in case
    // values differ slightly between services.
    const diskMap = new Map<string, { freeSpace: number; totalSpace: number }>()

    for (const disk of [...radarrDisks, ...sonarrDisks]) {
      const path = disk.path
      if (!path) continue
      const existing = diskMap.get(path)
      const totalSpace = disk.totalSpace ?? 0
      const freeSpace = disk.freeSpace ?? 0
      if (!existing || totalSpace > existing.totalSpace) {
        diskMap.set(path, { freeSpace, totalSpace })
      }
    }

    const diskPaths = Array.from(diskMap.keys())

    // Build per-disk byte totals for movies and shows using path prefix matching.
    const moviesBytesMap = new Map<string, number>()
    const showsBytesMap = new Map<string, number>()
    for (const path of diskPaths) {
      moviesBytesMap.set(path, 0)
      showsBytesMap.set(path, 0)
    }

    for (const movie of movies) {
      const size = movie.sizeOnDisk ?? 0
      if (size <= 0) continue
      const matched = matchRootFolder(movie.path, diskPaths)
      if (matched) {
        moviesBytesMap.set(matched, (moviesBytesMap.get(matched) ?? 0) + size)
      }
    }

    for (const s of series) {
      const size = s.statistics?.sizeOnDisk ?? 0
      if (size <= 0) continue
      const matched = matchRootFolder(s.path, diskPaths)
      if (matched) {
        showsBytesMap.set(matched, (showsBytesMap.get(matched) ?? 0) + size)
      }
    }

    const rootFolders: RootFolderStorage[] = Array.from(diskMap.entries()).map(
      ([path, { freeSpace, totalSpace }]) => ({
        path,
        freeSpace,
        totalSpace,
        moviesBytes: moviesBytesMap.get(path) ?? 0,
        showsBytes: showsBytesMap.get(path) ?? 0,
      }),
    )

    // Build largest items list merged from movies and shows.
    const largestItems: LargestItem[] = [
      ...movies.map(
        (movie): LargestItem => ({
          title: movie.title ?? 'Unknown',
          sizeOnDisk: movie.sizeOnDisk ?? 0,
          quality: movie.movieFile?.quality?.quality?.name ?? null,
          mediaType: 'movie',
          href: `/movie/${movie.tmdbId}`,
          rootFolder: matchRootFolder(movie.path, diskPaths),
        }),
      ),
      ...series.map(
        (s): LargestItem => ({
          title: s.title ?? 'Unknown',
          sizeOnDisk: s.statistics?.sizeOnDisk ?? 0,
          quality: null,
          mediaType: 'show',
          href: `/show/${s.tvdbId}`,
          rootFolder: matchRootFolder(s.path, diskPaths),
        }),
      ),
    ]
      .filter(item => item.sizeOnDisk > 0)
      .sort((a, b) => b.sizeOnDisk - a.sizeOnDisk)
      .slice(0, LARGEST_ITEMS_LIMIT)

    return { rootFolders, largestItems }
  }
}
