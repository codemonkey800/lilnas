/**
 * An upstream (Radarr/Sonarr) timestamp -> a `z.iso.datetime()`-valid
 * string, or `undefined` when there is no real moment to report.
 *
 * Both *arr apps serialise .NET `DateTime`s, and an unset one is
 * `DateTime.MinValue` rather than null - a `/series/lookup` hit that isn't
 * in the library comes back `added: '0001-01-01T07:53:00Z'`. That parses
 * fine and would pass the wire schema, so it is dropped here explicitly
 * rather than rendered as "added in year 1". Never substitutes "now" for a
 * missing value: an absent `addedAt` is a fact the UI can show honestly.
 */
export function toUpstreamIsoDateTime(
  value: string | null | undefined,
): string | undefined {
  if (!value) {
    return undefined
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1) {
    return undefined
  }

  return date.toISOString()
}
