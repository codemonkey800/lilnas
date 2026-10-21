import fs from 'fs'
import os from 'os'
import path from 'path'

import { RegistryService } from 'src/registry/registry.service'
import { Stack } from 'src/registry/registry.types'

const GATED = 'traefik.http.routers.r.middlewares=lilnas-auth'

function routed(host: string, extra: string[] = []): string[] {
  return [
    'traefik.enable=true',
    `traefik.http.routers.r.rule=Host(\`${host}\`)`,
    'traefik.http.routers.r.entrypoints=websecure',
    'traefik.http.routers.r.tls=true',
    ...extra,
  ]
}

// JSON is valid YAML, so fixtures serialize as a flow-style services map.
function compose(services: Record<string, unknown>, extra = ''): string {
  return `${extra}services: ${JSON.stringify(services)}\n`
}

describe('RegistryService', () => {
  let root: string
  let repo: string
  let devRoot: string

  function write(file: string, content: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }

  function lilnas(app: string, content: string) {
    write(path.join(repo, 'apps', app, 'deploy.dev.yml'), content)
  }

  function dev(project: string, file: string, content: string) {
    write(path.join(devRoot, project, file), content)
  }

  function service(options: { cacheTtlMs?: number } = {}) {
    return new RegistryService({
      lilnasRepo: repo,
      devProjectsRoot: devRoot,
      defaultMaxIdleHours: 2,
      cacheTtlMs: 10_000,
      ...options,
    })
  }

  async function only(): Promise<Stack> {
    const stacks = await service().list()
    if (stacks.length !== 1)
      throw new Error(`expected 1 stack, got ${stacks.length}`)
    return stacks[0]!
  }

  async function byId(id: string): Promise<Stack> {
    const stack = await service().get(id)
    if (!stack) throw new Error(`stack ${id} not found`)
    return stack
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-registry-'))
    repo = path.join(root, 'lilnas')
    devRoot = path.join(root, 'dev')
    fs.mkdirSync(path.join(repo, 'apps'), { recursive: true })
    fs.mkdirSync(devRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  describe('lilnas apps', () => {
    it('lists apps with a .dev.lilnas.io route and skips *.localhost-only ones', async () => {
      lilnas(
        'web',
        compose({ 'web-dev': { labels: routed('web.dev.lilnas.io') } }),
      )
      lilnas('local', compose({ local: { labels: routed('local.localhost') } }))

      const stacks = await service().list()

      expect(stacks.map(s => s.id)).toEqual(['lilnas:web'])
      expect(stacks[0]!).toMatchObject({
        source: 'lilnas',
        name: 'web',
        projectName: 'lilnas-dev',
        projectDir: path.join(repo, 'apps', 'web'),
        composeFile: path.join(repo, 'apps', 'web', 'deploy.dev.yml'),
        composeArgs: [
          '-p',
          'lilnas-dev',
          '-f',
          path.join(repo, 'apps', 'web', 'deploy.dev.yml'),
        ],
      })
    })

    it('resolves merge keys and reports {path, required} env files, one missing', async () => {
      lilnas(
        'bot',
        `
x-db: &db
  POSTGRES_DB: bot
x-svc: &svc
  restart: unless-stopped
  env_file:
    - path: .env.prod.decrypted
      required: true
    - path: .env.dev
      required: false
services:
  bot-dev:
    <<: *svc
    container_name: lilnas-bot-dev
    environment:
      <<: *db
    labels:
      - traefik.http.routers.dev-bot.rule=Host(\`bot.dev.lilnas.io\`)
      - traefik.http.routers.dev-bot.middlewares=lilnas-auth
      - traefik.http.services.dev-bot.loadbalancer.server.port=8080
`,
      )
      write(path.join(repo, 'apps', 'bot', '.env.dev'), 'A=1\n')

      const stack = await byId('lilnas:bot')

      // The env_file list only exists on the service through the merge key.
      expect(stack.envFiles).toEqual([
        {
          path: path.join(repo, 'apps', 'bot', '.env.prod.decrypted'),
          required: true,
          exists: false,
        },
        {
          path: path.join(repo, 'apps', 'bot', '.env.dev'),
          required: false,
          exists: true,
        },
      ])
      expect(stack.services[0]!.routes).toEqual([
        {
          router: 'dev-bot',
          host: 'bot.dev.lilnas.io',
          url: 'https://bot.dev.lilnas.io',
          gated: true,
          port: 8080,
        },
      ])
    })

    it('accepts env_file as a string or list of strings, de-duplicated', async () => {
      lilnas(
        'envs',
        compose({
          a: { env_file: '.env', labels: routed('envs.dev.lilnas.io') },
          b: { env_file: ['.env', '../shared.env'] },
        }),
      )

      const stack = await byId('lilnas:envs')

      expect(stack.envFiles.map(f => f.path)).toEqual([
        path.join(repo, 'apps', 'envs', '.env'),
        path.join(repo, 'apps', 'shared.env'),
      ])
      expect(stack.envFiles.every(f => f.required && !f.exists)).toBe(true)
    })

    it('captures a PathPrefix router alongside the main router', async () => {
      lilnas(
        'rt',
        compose({
          'rt-dev': {
            labels: [
              'traefik.http.routers.dev-rt.rule=Host(`rt.dev.lilnas.io`)',
              'traefik.http.routers.dev-rt.middlewares=lilnas-auth@docker',
              'traefik.http.routers.dev-rt-ws.rule=Host(`rt.dev.lilnas.io`) && PathPrefix(`/socket.io`)',
              'traefik.http.routers.dev-rt-ws.service=dev-rt',
              'traefik.http.services.dev-rt.loadbalancer.server.port=8080',
            ],
          },
        }),
      )

      const { routes } = (await byId('lilnas:rt')).services[0]!

      expect(routes).toEqual([
        expect.objectContaining({ router: 'dev-rt', gated: true, port: 8080 }),
        {
          router: 'dev-rt-ws',
          host: 'rt.dev.lilnas.io',
          pathPrefix: '/socket.io',
          url: 'https://rt.dev.lilnas.io/socket.io',
          gated: false,
          port: 8080,
        },
      ])
    })
  })

  describe('~/dev projects', () => {
    it('yields one stack per compose file with the right names', async () => {
      const prod = compose({
        'rocky-roads': {
          networks: ['default', 'lilnas-proxy'],
          labels: routed('rocky-roads.lilnas.io', [
            'lilnas.idle-reap.enabled=false',
          ]),
        },
      })
      dev('Hop-Road', 'docker-compose.yml', prod)
      dev(
        'Hop-Road',
        'docker-compose.dev.yml',
        compose(
          {
            app: {
              networks: ['lilnas-proxy'],
              labels: routed('rocky-roads.dev.lilnas.io'),
            },
          },
          'name: rocky-roads-dev\n',
        ),
      )

      const stacks = await service().list()

      expect(stacks.map(s => s.id)).toEqual([
        'dev:Hop-Road:docker-compose.yml',
        'dev:Hop-Road:docker-compose.dev.yml',
      ])
      expect(stacks.map(s => [s.name, s.projectName])).toEqual([
        ['Hop-Road', 'hop-road'],
        ['Hop-Road (dev)', 'rocky-roads-dev'],
      ])
      expect(stacks[0]!.composeArgs).toEqual([
        '-f',
        path.join(devRoot, 'Hop-Road', 'docker-compose.yml'),
      ])
      expect(stacks[0]!.projectDir).toBe(path.join(devRoot, 'Hop-Road'))
    })

    it('does not suffix a lone *.dev.yml file', async () => {
      dev(
        'solo',
        'compose.dev.yml',
        compose({ app: { networks: ['lilnas-proxy'] } }),
      )

      expect((await service().list()).map(s => s.name)).toEqual(['solo'])
    })

    it('reads map-form labels and networks', async () => {
      dev(
        'mapped',
        'compose.yaml',
        `
services:
  web:
    networks:
      default: {}
      lilnas-proxy:
        aliases: [mapped]
    labels:
      traefik.http.routers.mapped.rule: Host(\`mapped.dev.lilnas.io\`)
      traefik.http.routers.mapped.middlewares: lilnas-auth
      traefik.http.services.mapped.loadbalancer.server.port: 3000
      lilnas.idle-reap.max-idle-hours: 6
`,
      )

      const stack = await only()
      const web = stack.services[0]!

      expect(web.routes).toEqual([
        {
          router: 'mapped',
          host: 'mapped.dev.lilnas.io',
          url: 'https://mapped.dev.lilnas.io',
          gated: true,
          port: 3000,
        },
      ])
      expect(web.idleReap).toEqual({
        enabled: true,
        maxIdleHours: 6,
        reason: 'auto',
      })
    })

    it('excludes projects without a lilnas-proxy network', async () => {
      dev(
        'private',
        'docker-compose.yml',
        compose({ app: { networks: ['default'] } }),
      )
      dev('nonet', 'docker-compose.yml', compose({ app: { image: 'x' } }))

      expect(await service().list()).toEqual([])
    })

    it('marks public routes ungated and gated ones gated', async () => {
      dev(
        'mixed',
        'docker-compose.yml',
        compose({
          pub: {
            networks: ['lilnas-proxy'],
            labels: routed('pub.lilnas.io'),
          },
          priv: {
            networks: ['lilnas-proxy'],
            labels: routed('priv.lilnas.io', [GATED]),
          },
        }),
      )

      const stack = await only()

      expect(
        stack.services.map(s => [
          s.name,
          s.routes[0]!.gated,
          s.idleReap.reason,
        ]),
      ).toEqual([
        ['pub', false, 'none'],
        ['priv', true, 'none'],
      ])
    })

    it('computes idle-reap from labels, route hosts and defaults', async () => {
      dev(
        'reap',
        'docker-compose.yml',
        compose({
          off: {
            networks: ['lilnas-proxy'],
            labels: routed('off.dev.lilnas.io', [
              'lilnas.idle-reap.enabled=false',
            ]),
          },
          on: {
            networks: ['lilnas-proxy'],
            labels: routed('on.lilnas.io', ['lilnas.idle-reap.enabled=true']),
          },
          auto: {
            networks: ['lilnas-proxy'],
            labels: routed('auto.dev.lilnas.io'),
          },
          custom: {
            networks: ['lilnas-proxy'],
            labels: routed('custom.dev.lilnas.io', [
              'lilnas.idle-reap.max-idle-hours=12',
            ]),
          },
          none: { networks: ['lilnas-proxy'] },
        }),
      )

      const stack = await only()
      const reap = Object.fromEntries(
        stack.services.map(s => [s.name, s.idleReap]),
      )

      expect(reap.off).toEqual({
        enabled: false,
        maxIdleHours: 2,
        reason: 'label',
      })
      expect(reap.on).toEqual({
        enabled: true,
        maxIdleHours: 2,
        reason: 'label',
      })
      expect(reap.auto).toEqual({
        enabled: true,
        maxIdleHours: 2,
        reason: 'auto',
      })
      expect(reap.custom).toEqual({
        enabled: true,
        maxIdleHours: 12,
        reason: 'auto',
      })
      expect(reap.none).toEqual({
        enabled: false,
        maxIdleHours: 2,
        reason: 'none',
      })
    })

    it('uses container_name when set, else <project>-<service>-1', async () => {
      dev(
        'names',
        'docker-compose.yml',
        compose({
          named: { container_name: 'custom-box', networks: ['lilnas-proxy'] },
          plain: { networks: ['lilnas-proxy'] },
        }),
      )

      const registry = service()
      const stack = (await registry.list())[0]!

      expect(stack.services.map(s => s.containerName)).toEqual([
        'custom-box',
        'names-plain-1',
      ])
      expect(await registry.findByContainerName('names-plain-1')).toEqual({
        stack,
        service: stack.services[1]!,
      })
      expect(await registry.findByContainerName('nope')).toBeUndefined()
    })

    it('warns when a route shadows a production name', async () => {
      dev(
        'shadow',
        'docker-compose.yml',
        compose({
          app: {
            networks: ['lilnas-proxy'],
            labels: routed('grafana.lilnas.io'),
          },
        }),
      )
      dev(
        'fine',
        'docker-compose.yml',
        compose({
          app: {
            networks: ['lilnas-proxy'],
            labels: routed('grafana.dev.lilnas.io'),
          },
        }),
      )

      const registry = service()

      expect(
        (await registry.get('dev:shadow:docker-compose.yml'))?.warnings,
      ).toEqual(['route grafana.lilnas.io shadows a production name'])
      expect(
        (await registry.get('dev:fine:docker-compose.yml'))?.warnings,
      ).toEqual([])
    })

    it('lists only loopback-bound published ports, as written', async () => {
      dev(
        'ports',
        'docker-compose.yml',
        compose({
          app: {
            networks: ['lilnas-proxy'],
            ports: [
              '127.0.0.1:8090:8080',
              '9000:9000',
              '0.0.0.0:9001:9001',
              { host_ip: '127.0.0.1', published: 7000, target: 80 },
            ],
          },
        }),
      )

      const stack = await only()

      expect(stack.services[0]!.loopbackPorts).toEqual([
        '127.0.0.1:8090:8080',
        '127.0.0.1:7000:80',
      ])
    })

    it('leaves compose interpolation verbatim', async () => {
      dev(
        'interp',
        'docker-compose.yml',
        compose({
          app: {
            networks: ['lilnas-proxy'],
            labels: routed('${APP_HOST:-interp.lilnas.io}'),
          },
        }),
      )

      const stack = await only()

      expect(stack.services[0]!.routes[0]!.host).toBe(
        '${APP_HOST:-interp.lilnas.io}',
      )
    })
  })

  it('skips unreadable or invalid YAML with a warning and never throws', async () => {
    dev('broken', 'docker-compose.yml', 'services:\n  app: [unclosed\n  : :\n')
    dev('empty', 'docker-compose.yml', '')
    dev(
      'ok',
      'docker-compose.yml',
      compose({ app: { networks: ['lilnas-proxy'] } }),
    )
    lilnas('bad', 'services: {a: [')

    const registry = service()
    const warnings: string[] = []
    jest
      .spyOn(
        (registry as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(message => {
        warnings.push(message)
      })

    const stacks = await registry.list()

    expect(stacks.map(s => s.id)).toEqual(['dev:ok:docker-compose.yml'])
    expect(warnings).toHaveLength(2)
    expect(warnings.some(w => w.includes('broken'))).toBe(true)
    expect(warnings.some(w => w.includes('bad'))).toBe(true)
  })

  it('caches the scan for the TTL and rescans afterwards', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    try {
      const registry = service({ cacheTtlMs: 10_000 })
      expect(await registry.list()).toEqual([])

      dev(
        'late',
        'docker-compose.yml',
        compose({ app: { networks: ['lilnas-proxy'] } }),
      )
      expect(await registry.list()).toEqual([])

      jest.setSystemTime(Date.now() + 10_001)
      expect((await registry.list()).map(s => s.name)).toEqual(['late'])
    } finally {
      jest.useRealTimers()
    }
  })

  const realDev = '/home/jeremy/dev'
  const maybeIt = fs.existsSync(realDev) ? it : it.skip
  maybeIt(
    'discovers download, tdr-bot and theater in this checkout',
    async () => {
      const checkout = path.resolve(__dirname, '../../../../..')
      const registry = new RegistryService({
        lilnasRepo: checkout,
        devProjectsRoot: realDev,
      })

      const ids = (await registry.list()).map(s => s.id)

      expect(ids).toEqual(
        expect.arrayContaining([
          'lilnas:download',
          'lilnas:tdr-bot',
          'lilnas:theater',
        ]),
      )
    },
  )
})
