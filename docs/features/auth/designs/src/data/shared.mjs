// Sample data shared by the auth pages. Not a page, so the builder never loads
// it on its own; the page data files import what they need. Names, emails and
// hosts are invented, but the services are the real ones from
// apps/auth/src/app/service-meta.ts (icon names are the kit sprite's).

export const services = {
  files: { host: 'files.lilnas.io', name: 'Files', icon: 'folder' },
  radarr: { host: 'radarr.lilnas.io', name: 'Radarr', icon: 'film' },
  sonarr: { host: 'sonarr.lilnas.io', name: 'Sonarr', icon: 'tv' },
  sabnzbd: { host: 'sabnzbd.lilnas.io', name: 'SABnzbd', icon: 'inbox' },
  emby: { host: 'emby.lilnas.io', name: 'Emby', icon: 'play' },
  immich: { host: 'immich.lilnas.io', name: 'Immich', icon: 'monitor' },
  grafana: { host: 'grafana.lilnas.io', name: 'Grafana', icon: 'chart' },
  download: { host: 'download.lilnas.io', name: 'Download', icon: 'download' },
  dev: { host: 'dev.lilnas.io', name: 'Dev', icon: 'server' },
  tdrCode: { host: 'tdr-code.lilnas.io', name: 'TDR Code', icon: 'laptop' },
}

// The person looking at the gate screens.
export const you = {
  name: 'Jane Doe',
  email: 'jane.doe@example.com',
  initials: 'JD',
}

export const appName = 'auth'
