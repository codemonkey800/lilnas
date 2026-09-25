import { getErrorMessage } from '@lilnas/utils/error'
import type { Logger } from '@nestjs/common'

/**
 * Maps a list of upstream resources, dropping (and logging) the ones the
 * mapper refuses rather than failing the whole listing.
 *
 * The mappers this backs - `toMovie`/`toShow` - throw when the resource has
 * no catalogue id, because a `Media` without one cannot be addressed: its
 * `mediaId()` key would be `tmdb:0`, which fails `MovieSchema`'s own
 * `z.number().int().positive()` and gets dropped by the frontend's
 * `safeParse()` with no error anywhere. Dropping it *here* is the same
 * outcome for that one record and a strictly better one for the request: the
 * remaining titles still render, and the drop is on record with the title
 * that caused it.
 *
 * Deliberately not used for single-resource lookups
 * (`lookupByTmdbId`/`lookupByTvdbId`): there the unmappable record *is* the
 * answer, so the throw has to reach the caller.
 */
export function mapCatalogueEntries<TResource, TMedia>(
  resources: readonly TResource[],
  map: (resource: TResource) => TMedia,
  { action, logger }: { action: string; logger: Logger },
): TMedia[] {
  const mapped: TMedia[] = []

  for (const resource of resources) {
    try {
      mapped.push(map(resource))
    } catch (err) {
      logger.warn(
        { action, error: getErrorMessage(err) },
        'Dropped an unmappable upstream record from the listing',
      )
    }
  }

  return mapped
}
