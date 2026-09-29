import type {
  TierQualityItem,
  TierQualityProfile,
} from 'src/media/quality-tiers'

/**
 * `/qualityprofile/schema` as Radarr 6.4 / Sonarr 4.0 return it, trimmed to
 * the fields the tier builder reads (each quality's `source`/`resolution`
 * dropped). `items` run worst -> best in each app's own order, which differs
 * between the two. Factories, so a test can mutate its copy freely.
 */

function leaf(id: number, name: string): TierQualityItem {
  return { quality: { id, name }, items: [], allowed: false }
}

function group(
  id: number,
  name: string,
  members: TierQualityItem[],
): TierQualityItem {
  return { id, name, items: members, allowed: false }
}

const SCHEMA_DEFAULTS: TierQualityProfile = {
  name: '',
  upgradeAllowed: false,
  cutoff: 0,
  minFormatScore: 0,
  cutoffFormatScore: 0,
  formatItems: [],
}

function web(
  res: '480p' | '720p' | '1080p' | '2160p',
  groupId: number,
  webRipId: number,
  webDlId: number,
): TierQualityItem {
  return group(groupId, `WEB ${res}`, [
    leaf(webRipId, `WEBRip-${res}`),
    leaf(webDlId, `WEBDL-${res}`),
  ])
}

export function radarrSchema(): TierQualityProfile {
  return {
    ...SCHEMA_DEFAULTS,
    minUpgradeFormatScore: 1,
    language: { id: -2, name: 'Original' },
    items: [
      leaf(0, 'Unknown'),
      leaf(24, 'WORKPRINT'),
      leaf(25, 'CAM'),
      leaf(26, 'TELESYNC'),
      leaf(27, 'TELECINE'),
      leaf(29, 'REGIONAL'),
      leaf(28, 'DVDSCR'),
      leaf(1, 'SDTV'),
      leaf(2, 'DVD'),
      leaf(23, 'DVD-R'),
      web('480p', 1000, 12, 8),
      leaf(20, 'Bluray-480p'),
      leaf(21, 'Bluray-576p'),
      leaf(4, 'HDTV-720p'),
      web('720p', 1001, 14, 5),
      leaf(6, 'Bluray-720p'),
      leaf(9, 'HDTV-1080p'),
      web('1080p', 1002, 15, 3),
      leaf(7, 'Bluray-1080p'),
      leaf(30, 'Remux-1080p'),
      leaf(16, 'HDTV-2160p'),
      web('2160p', 1003, 17, 18),
      leaf(19, 'Bluray-2160p'),
      leaf(31, 'Remux-2160p'),
      leaf(22, 'BR-DISK'),
      leaf(10, 'Raw-HD'),
    ],
  }
}

export function sonarrSchema(): TierQualityProfile {
  return {
    ...SCHEMA_DEFAULTS,
    minUpgradeFormatScore: 1,
    items: [
      leaf(0, 'Unknown'),
      leaf(1, 'SDTV'),
      web('480p', 1000, 12, 8),
      leaf(2, 'DVD'),
      leaf(13, 'Bluray-480p'),
      leaf(22, 'Bluray-576p'),
      leaf(4, 'HDTV-720p'),
      leaf(9, 'HDTV-1080p'),
      leaf(10, 'Raw-HD'),
      web('720p', 1001, 14, 5),
      leaf(6, 'Bluray-720p'),
      web('1080p', 1002, 15, 3),
      leaf(7, 'Bluray-1080p'),
      leaf(20, 'Bluray-1080p Remux'),
      leaf(16, 'HDTV-2160p'),
      web('2160p', 1003, 17, 18),
      leaf(19, 'Bluray-2160p'),
      leaf(21, 'Bluray-2160p Remux'),
    ],
  }
}

/** Every quality id in a profile, group members included, sorted. */
export function allQualityIds(profile: TierQualityProfile): number[] {
  return (profile.items ?? [])
    .flatMap(item =>
      item.items?.length
        ? item.items.map(m => m.quality?.id)
        : [item.quality?.id],
    )
    .filter((id): id is number => id != null)
    .sort((a, b) => a - b)
}

/** The allowed top-level items' ids (group id or quality id), in order. */
export function allowedTopLevelIds(profile: TierQualityProfile): number[] {
  return (profile.items ?? [])
    .filter(item => item.allowed)
    .map(item => (item.items?.length ? item.id : item.quality?.id))
    .filter((id): id is number => id != null)
}
