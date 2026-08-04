import type { IconName } from './components/icons'

// Deliberately keyed by THIS deployment's real Traefik-discovered hosts
// (confirmed via `Host(...)` labels across infra/*.yml and
// apps/*/deploy.yml), not the design mockups' own example service list
// (Prowlarr/Overseerr/Jellyfin/Home Assistant don't exist in this
// deployment). Anything not listed here — including a host that later
// leaves the registry, or `login.lilnas.io`/`auth.lilnas.io` themselves —
// falls back to the raw hostname + a generic globe icon via
// getServiceMeta() below, rather than a build-time error.
export type ServiceMeta = {
  name: string
  description: string
  icon: IconName
}

export const SERVICE_META: Record<string, ServiceMeta> = {
  'files.lilnas.io': {
    name: 'Files',
    description: 'File manager & sync',
    icon: 'folder',
  },
  'radarr.lilnas.io': {
    name: 'Radarr',
    description: 'Movie library manager',
    icon: 'film',
  },
  'sonarr.lilnas.io': {
    name: 'Sonarr',
    description: 'TV library manager',
    icon: 'tv',
  },
  'sabnzbd.lilnas.io': {
    name: 'SABnzbd',
    description: 'Usenet download queue',
    icon: 'inbox',
  },
  'emby.lilnas.io': {
    name: 'Emby',
    description: 'Media streaming',
    icon: 'play',
  },
  'immich.lilnas.io': {
    name: 'Immich',
    description: 'Photo library & backup',
    icon: 'monitor',
  },
  'grafana.lilnas.io': {
    name: 'Grafana',
    description: 'Monitoring dashboards',
    icon: 'chart',
  },
  'prometheus.lilnas.io': {
    name: 'Prometheus',
    description: 'Metrics collection',
    icon: 'server',
  },
  'portal.lilnas.io': {
    name: 'Portal',
    description: 'App dashboard',
    icon: 'home',
  },
  'download.lilnas.io': {
    name: 'Download',
    description: 'Video & media downloader',
    icon: 'arrowRight',
  },
  'dashcam.lilnas.io': {
    name: 'Dashcam',
    description: 'Dashcam video viewer',
    icon: 'laptop',
  },
  'equations.lilnas.io': {
    name: 'Equations',
    description: 'LaTeX equation rendering',
    icon: 'monitor',
  },
  'swole.lilnas.io': {
    name: 'Swole',
    description: 'Workout tracker',
    icon: 'chart',
  },
  'tdr.lilnas.io': {
    name: 'TDR Bot',
    description: 'Discord bot & admin',
    icon: 'mail',
  },
  'tdr-code.lilnas.io': {
    name: 'TDR Code',
    description: 'AI coding agent',
    icon: 'laptop',
  },
  'design.lilnas.io': {
    name: 'Design',
    description: 'Collaborative design tool',
    icon: 'monitor',
  },
  'yacht.lilnas.io': {
    name: 'Yacht',
    description: 'Container management',
    icon: 'server',
  },
  'storage.lilnas.io': {
    name: 'Storage',
    description: 'Object storage (MinIO)',
    icon: 'server',
  },
  'storage-admin.lilnas.io': {
    name: 'Storage Admin',
    description: 'MinIO admin console',
    icon: 'key',
  },
  'turbo.lilnas.io': {
    name: 'Turbo Cache',
    description: 'Remote build cache',
    icon: 'refresh',
  },
  'nexus-code.lilnas.io': {
    name: 'Nexus Code',
    description: 'AI coding agent',
    icon: 'laptop',
  },
  'nexus-code-mbp.lilnas.io': {
    name: 'Nexus Code (MBP)',
    description: 'AI coding agent',
    icon: 'laptop',
  },
  'traefik.lilnas.io': {
    name: 'Traefik',
    description: 'Reverse proxy dashboard',
    icon: 'server',
  },
}

export function getServiceMeta(host: string): ServiceMeta {
  return SERVICE_META[host] ?? { name: host, description: host, icon: 'globe' }
}
