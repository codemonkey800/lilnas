/*
 * Sample data for index.pug — the dev dashboard overview.
 *
 * Ten stacks, picked so every state the card can be in shows up at least
 * once:
 *
 *   running + healthy   download, theater, rocky-roads-dev, hop-road, url-shortener
 *   running + unhealthy fitness-pwa (also the two-routed-services stack)
 *   exited (code 1)     test-landing-page
 *   absent (reaped)     GoonCut
 *   busy                blabla
 *   env-missing         tdr-bot
 *
 * hop-road is listed twice on purpose: its docker-compose.yml is the prod-ish
 * stack (`lilnas.idle-reap.enabled=false`, so "exempt") and its
 * docker-compose.dev.yml is the `rocky-roads-dev` project. They share a
 * folder, not a project.
 *
 * A service is { name, container, status, health, uptime, cpu, mem, exit,
 * reap }. `mem` is MB. `reap` is the reaper's verdict for that container:
 * "in 1h 20m", "exempt", "unknown" (auth didn't answer), or null when it
 * isn't running and so isn't a reap trigger.
 */

const stacks = [
  {
    slug: 'download',
    name: 'download',
    group: 'apps',
    source: 'apps/download/deploy.dev.yml',
    state: 'healthy',
    routes: [{ host: 'download.dev.lilnas.io', gated: true }],
    services: [
      {
        name: 'download-dev',
        container: 'lilnas-download-dev',
        status: 'running',
        health: 'healthy',
        uptime: '3h 12m',
        cpu: 4.2,
        mem: 612,
        reap: 'in 1h 20m',
      },
    ],
  },
  {
    slug: 'tdr-bot',
    name: 'tdr-bot',
    group: 'apps',
    source: 'apps/tdr-bot/deploy.dev.yml',
    state: 'env-missing',
    routes: [{ host: 'tdr.dev.lilnas.io', gated: true }],
    services: [
      {
        name: 'tdr-bot-dev',
        container: 'lilnas-tdr-bot-dev',
        status: 'absent',
        health: 'none',
      },
    ],
    missingEnv: 'apps/tdr-bot/.env.prod.decrypted',
  },
  {
    slug: 'theater',
    name: 'theater',
    group: 'apps',
    source: 'apps/theater/deploy.dev.yml',
    state: 'healthy',
    routes: [{ host: 'theater.dev.lilnas.io', gated: true }],
    services: [
      {
        name: 'theater-dev',
        container: 'lilnas-theater-dev',
        status: 'running',
        health: 'healthy',
        uptime: '1h 05m',
        cpu: 12.8,
        mem: 884,
        reap: 'in 55m',
      },
    ],
  },
  {
    slug: 'fitness-pwa',
    name: 'fitness-pwa',
    group: 'dev',
    source: '~/dev/fitness-pwa/docker-compose.yml',
    state: 'unhealthy',
    routes: [
      { host: 'flexecute.dev.lilnas.io', gated: true },
      { host: 'api-flexecute.dev.lilnas.io', gated: false },
    ],
    services: [
      {
        name: 'web',
        container: 'fitness-pwa-web-1',
        status: 'running',
        health: 'healthy',
        uptime: '2h 41m',
        cpu: 0.6,
        mem: 142,
        reap: 'in 1h 52m',
      },
      {
        name: 'api',
        container: 'fitness-pwa-api-1',
        status: 'running',
        health: 'unhealthy',
        uptime: '2h 41m',
        cpu: 31.4,
        mem: 468,
        reap: 'in 1h 52m',
      },
      {
        name: 'db',
        container: 'fitness-pwa-db-1',
        status: 'running',
        health: 'healthy',
        uptime: '2h 41m',
        cpu: 0.9,
        mem: 96,
        reap: 'in 1h 52m',
      },
      {
        name: 'migrate',
        container: 'fitness-pwa-migrate-1',
        status: 'exited',
        health: 'none',
        exit: 0,
        uptime: null,
        reap: null,
      },
    ],
    note: {
      kind: 'unhealthy',
      text: 'fitness-pwa-api-1 has failed its healthcheck 3 times in a row.',
      detail: 'curl -f http://localhost:3001/health → exit 22',
    },
  },
  {
    slug: 'rocky-roads-dev',
    name: 'rocky-roads-dev',
    group: 'dev',
    source: '~/dev/hop-road/docker-compose.dev.yml',
    state: 'healthy',
    routes: [{ host: 'rocky-roads.dev.lilnas.io', gated: false }],
    services: [
      {
        name: 'web',
        container: 'rocky-roads-dev-web-1',
        status: 'running',
        health: 'healthy',
        uptime: '58m',
        cpu: 2.1,
        mem: 233,
        reap: 'in 1h 05m',
      },
      {
        name: 'db',
        container: 'rocky-roads-dev-db-1',
        status: 'running',
        health: 'healthy',
        uptime: '58m',
        cpu: 0.4,
        mem: 71,
        reap: 'in 1h 05m',
      },
    ],
  },
  {
    slug: 'hop-road',
    name: 'hop-road',
    group: 'dev',
    source: '~/dev/hop-road/docker-compose.yml',
    state: 'healthy',
    routes: [{ host: 'rocky-roads.lilnas.io', gated: true }],
    services: [
      {
        name: 'web',
        container: 'hop-road-web-1',
        status: 'running',
        health: 'healthy',
        uptime: '6d 4h',
        cpu: 1.3,
        mem: 188,
        reap: 'exempt',
      },
    ],
  },
  {
    slug: 'test-landing-page',
    name: 'test-landing-page',
    group: 'dev',
    source: '~/dev/test-landing-page/docker-compose.yml',
    state: 'exited',
    routes: [{ host: 'test-landing-page.dev.lilnas.io', gated: false }],
    services: [
      {
        name: 'web',
        container: 'test-landing-page-web-1',
        status: 'exited',
        health: 'none',
        exit: 1,
        finished: '14m ago',
        reap: null,
      },
    ],
    note: {
      kind: 'exited',
      text: 'test-landing-page-web-1 exited with code 1, 14m ago.',
      detail: 'Check its logs before bringing it back up.',
    },
  },
  {
    slug: 'gooncut',
    name: 'GoonCut',
    group: 'dev',
    source: '~/dev/GoonCut/docker-compose.yml',
    state: 'absent',
    routes: [{ host: 'gooncut.dev.lilnas.io', gated: true }],
    services: [
      {
        name: 'web',
        container: 'gooncut-web-1',
        status: 'absent',
        health: 'none',
      },
    ],
    note: {
      kind: 'absent',
      text: 'Reaped 1h 5m ago after 2h without a visit.',
      detail: 'Up brings it back; its volumes were kept.',
    },
  },
  {
    slug: 'blabla',
    name: 'blabla',
    group: 'dev',
    source: '~/dev/blabla/docker-compose.yml',
    state: 'busy',
    routes: [{ host: 'blabla.dev.lilnas.io', gated: false }],
    services: [
      {
        name: 'web',
        container: 'blabla-web-1',
        status: 'starting',
        health: 'none',
      },
    ],
    op: {
      name: 'up',
      elapsed: '14s',
      last: 'Container blabla-web-1  Starting',
    },
  },
  {
    slug: 'url-shortener',
    name: 'url-shortener',
    group: 'dev',
    source: '~/dev/url-shortener/docker-compose.yml',
    state: 'healthy',
    routes: [{ host: 'swurl.dev.lilnas.io', gated: true }],
    services: [
      {
        name: 'web',
        container: 'url-shortener-web-1',
        status: 'running',
        health: 'healthy',
        uptime: '27m',
        cpu: 0.3,
        mem: 118,
        reap: 'unknown',
      },
    ],
  },
]

const running = stacks.flatMap(s =>
  s.services.filter(svc => svc.status === 'running'),
)
const memMb = running.reduce((sum, svc) => sum + svc.mem, 0)

export default {
  stacks,
  host: {
    stacks: stacks.length,
    running: running.length,
    memory: `${(memMb / 1024).toFixed(1)} GB`,
    reaper: '2h idle',
    updated: '4s ago',
  },
}
