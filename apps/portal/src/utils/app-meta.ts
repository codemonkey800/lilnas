import type { IconName, StatusDotTone } from '@lilnas/ui'

import type { BrowserState } from 'src/utils/browser'

/** The remote browser's tile opens the power page instead of the app. */
export const BROWSER_HOST = 'browser.lilnas.io'
export const BROWSER_PAGE = '/browser'

const DEFAULT_ICON: IconName = 'globe'

// Keyed by subdomain. Anything not listed gets the generic globe.
const APP_ICONS: Record<string, IconName> = {
  'auth-admin': 'shield',
  browser: 'globe',
  dashcam: 'film',
  design: 'layers',
  dev: 'terminal',
  download: 'download',
  emby: 'play',
  equations: 'file',
  files: 'folder',
  grafana: 'chart',
  immich: 'monitor',
  'nexus-code': 'terminal',
  'nexus-code-work': 'terminal',
  prometheus: 'activity',
  radarr: 'film',
  sabnzbd: 'inbox',
  sonarr: 'tv',
  storage: 'server',
  'storage-admin': 'server',
  tdr: 'users',
  'tdr-code': 'terminal',
  theater: 'tv',
  traefik: 'layers',
  turbo: 'activity',
  'work-docs': 'file',
  yacht: 'server',
}

export function getSubdomain(host: string): string {
  return host.replace(/\.lilnas\.io$/, '')
}

export function getAppIcon(host: string): IconName {
  return APP_ICONS[getSubdomain(host)] ?? DEFAULT_ICON
}

export interface TileStatus {
  tone: StatusDotTone
  label: string
}

/** The word and dot tone beside the browser tile. */
export const BROWSER_TILE_STATUS: Record<BrowserState, TileStatus> = {
  missing: { tone: 'bad', label: 'Not installed' },
  stopped: { tone: 'idle', label: 'Off' },
  starting: { tone: 'warn', label: 'Starting' },
  running: { tone: 'ok', label: 'On' },
}
