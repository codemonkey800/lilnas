// Byte-identical helper previously duplicated in radarr.service.ts:70-74 and
// sonarr.service.ts:57-61 - both convert a release-date-shaped string into a
// year, tolerating an absent or unparseable input.
export function releaseYearFromDate(
  dateStr: string | undefined,
): number | undefined {
  if (!dateStr) return undefined
  const year = new Date(dateStr).getUTCFullYear()
  return Number.isNaN(year) ? undefined : year
}
