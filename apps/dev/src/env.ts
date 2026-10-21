export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT', // default 8081
  NODE_ENV: 'NODE_ENV',
  LILNAS_REPO: 'LILNAS_REPO', // default /home/jeremy/lilnas
  DEV_PROJECTS_ROOT: 'DEV_PROJECTS_ROOT', // default /home/jeremy/dev
  AUTH_URL: 'AUTH_URL', // default http://auth:8081
  DEFAULT_MAX_IDLE_HOURS: 'DEFAULT_MAX_IDLE_HOURS', // default 2
  DOCKER_SOCKET: 'DOCKER_SOCKET', // default /var/run/docker.sock
  DOCKER_BIN: 'DOCKER_BIN', // default docker
} as const
