/*
 * Sample data for stack-detail.pug — one stack, fitness-pwa, chosen because it
 * is the busiest one on the overview: two routes (one of them open), four
 * services, one failing its healthcheck, one that ran once and exited 0.
 *
 * It matches the fitness-pwa card in index.mjs field for field.
 */

export default {
  stack: {
    name: 'fitness-pwa',
    project: 'fitness-pwa',
    source: '~/dev/fitness-pwa/docker-compose.yml',
    state: 'unhealthy',
    routes: [
      { host: 'flexecute.dev.lilnas.io', gated: true },
      { host: 'api-flexecute.dev.lilnas.io', gated: false },
    ],
  },

  services: [
    {
      container: 'fitness-pwa-web-1',
      service: 'web',
      image: 'node:24-alpine',
      status: 'running',
      health: 'healthy',
      started: '2h 41m ago',
      exit: null,
      cpu: '0.6%',
      mem: '142 MB',
      port: '127.0.0.1:8090',
    },
    {
      container: 'fitness-pwa-api-1',
      service: 'api',
      image: 'node:24-alpine',
      status: 'running',
      health: 'unhealthy',
      started: '2h 41m ago',
      exit: null,
      cpu: '31.4%',
      mem: '468 MB',
      port: '127.0.0.1:8091',
    },
    {
      container: 'fitness-pwa-db-1',
      service: 'db',
      image: 'postgres:17-alpine',
      status: 'running',
      health: 'healthy',
      started: '2h 41m ago',
      exit: null,
      cpu: '0.9%',
      mem: '96 MB',
      port: '127.0.0.1:5433',
    },
    {
      container: 'fitness-pwa-migrate-1',
      service: 'migrate',
      image: 'node:24-alpine',
      status: 'exited',
      health: 'none',
      started: '2h 41m ago',
      exit: 0,
      cpu: null,
      mem: null,
      port: null,
    },
  ],

  envFiles: [
    { path: '.env', present: true, required: true },
    { path: '.env.local', present: false, required: false },
  ],

  reaper: {
    lastVisit: '12m ago',
    lastVisitHost: 'flexecute.dev.lilnas.io',
    activeUsers: 2,
    windowHours: 2,
    maxIdle: '2h',
    maxIdleSource: 'default',
    idlePct: 10,
    reapsAt: '16:48',
    reapsIn: '1h 48m',
    basis:
      'Latest visit across the stack’s 2 routes, from the auth service. The reaper stops and removes all 4 containers together and keeps networks and volumes.',
  },

  // Two snapshots of the operation log: one that has finished, one mid-stream.
  operations: {
    done: {
      title: 'restart api',
      started: '16:02:11',
      who: 'Jeremy',
      status: 'done',
      exit: 0,
      took: '4.1s',
      command:
        'docker compose -p fitness-pwa -f /home/jeremy/dev/fitness-pwa/docker-compose.yml restart api',
      lines: [
        { t: 'out', text: 'Container fitness-pwa-api-1  Restarting' },
        { t: 'out', text: 'Container fitness-pwa-api-1  Started' },
      ],
    },
    running: {
      title: 'recreate web',
      started: '16:09:40',
      who: 'Jeremy',
      status: 'running',
      command:
        'docker compose -p fitness-pwa -f /home/jeremy/dev/fitness-pwa/docker-compose.yml up -d --force-recreate web',
      lines: [
        { t: 'out', text: 'Container fitness-pwa-db-1  Running' },
        { t: 'out', text: 'Container fitness-pwa-web-1  Recreate' },
        { t: 'out', text: 'Container fitness-pwa-web-1  Recreated' },
        { t: 'out', text: 'Container fitness-pwa-web-1  Starting' },
      ],
    },
  },

  containers: [
    'fitness-pwa-web-1',
    'fitness-pwa-api-1',
    'fitness-pwa-db-1',
    'fitness-pwa-migrate-1',
  ],
  tails: [100, 500, 2000],

  logs: [
    { ts: '16:09:02.114', t: 'out', text: 'GET /health 200 3ms' },
    { ts: '16:09:12.118', t: 'out', text: 'GET /health 200 2ms' },
    { ts: '16:09:14.640', t: 'out', text: 'POST /workouts 201 41ms' },
    {
      ts: '16:09:22.121',
      t: 'err',
      text: 'Error: connect ETIMEDOUT 172.19.0.4:5432',
    },
    {
      ts: '16:09:22.121',
      t: 'err',
      indent: true,
      text: 'at TCPConnectWrap.afterConnect (node:net:1637:16)',
    },
    { ts: '16:09:22.122', t: 'err', text: 'GET /health 503 5001ms' },
    {
      ts: '16:09:32.127',
      t: 'out',
      text: 'retrying database connection (attempt 2/5)',
    },
    {
      ts: '16:09:37.130',
      t: 'err',
      text: 'Error: connect ETIMEDOUT 172.19.0.4:5432',
    },
    { ts: '16:09:37.131', t: 'err', text: 'GET /health 503 5002ms' },
    {
      ts: '16:09:42.135',
      t: 'out',
      text: 'retrying database connection (attempt 3/5)',
    },
    { ts: '16:09:44.902', t: 'out', text: 'GET /exercises?q=squat 200 18ms' },
    {
      ts: '16:09:47.140',
      t: 'err',
      text: 'Error: connect ETIMEDOUT 172.19.0.4:5432',
    },
  ],
}
