// Copy and sample data for home.pug. Hosts are what getAppHosts() returns,
// sorted: running containers' Traefik hosts, minus auth and edge. Only the
// browser tile carries a status; the portal learns nothing else about an app
// beyond "it is running".

export const apps = [
  { name: 'auth-admin', icon: 'shield' },
  {
    name: 'browser',
    icon: 'globe',
    href: 'browser.html',
    status: { tone: 'idle', label: 'Off' },
  },
  { name: 'dashcam', icon: 'film' },
  { name: 'dev', icon: 'terminal' },
  { name: 'download', icon: 'download' },
  { name: 'grafana', icon: 'chart' },
  { name: 'immich', icon: 'folder' },
  { name: 'tdr', icon: 'discord' },
  { name: 'theater', icon: 'tv' },
]

export const empty = {
  title: 'No apps are running',
  body: "Start one on the server and it'll show up here.",
  action: 'Reload',
}

export const failure = {
  lead: "Couldn't list the containers.",
  detail: "Docker didn't answer.",
  code: 'ENOENT /var/run/docker.sock',
  action: 'Retry',
}

export const states = [
  { key: 'normal', label: 'Normal', caption: '9 apps, staggered in' },
  {
    key: 'empty',
    label: 'Empty',
    caption: 'Docker answered with nothing running',
  },
  { key: 'error', label: 'Error', caption: "Docker didn't answer" },
]
