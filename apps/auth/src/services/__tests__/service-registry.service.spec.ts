import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scanServiceRegistry } from 'src/services/service-registry.service'

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, content, 'utf-8')
}

// Real fixture directories on disk (not mocked fs) — scanServiceRegistry's
// own contract is "reads these two directories," and the plan's test
// scenarios are themselves phrased as "a fixture compose file" throughout,
// so exercising the actual fs.readdir/fs.readFile calls end to end is what
// proves the YAML-parsing and directory-walking logic, not just the
// correlation logic downstream of it. Mirrors
// apps/tdr-code/src/logging/log-sources.service.spec.ts's established
// mkdtemp-per-test convention.
describe('scanServiceRegistry', () => {
  let tmpDir: string
  let appsDir: string
  let infraDir: string

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'service-registry-spec-'),
    )
    appsDir = path.join(tmpDir, 'apps')
    infraDir = path.join(tmpDir, 'infra')
    await fs.promises.mkdir(appsDir, { recursive: true })
    await fs.promises.mkdir(infraDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  })

  it('a fixture compose file with a Host(...) rule yields that hostname', async () => {
    await writeFile(
      path.join(appsDir, 'dashcam', 'deploy.yml'),
      [
        'services:',
        '  dashcam:',
        '    labels:',
        '      - traefik.enable=true',
        '      - traefik.http.routers.dashcam.rule=Host(`dashcam.lilnas.io`)',
        '      - traefik.http.services.dashcam.loadbalancer.server.port=8080',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([{ host: 'dashcam.lilnas.io', gatedBy: 'none' }])
  })

  it('a router carrying middlewares=lilnas-auth is reported as gated by the new middleware', async () => {
    await writeFile(
      path.join(appsDir, 'yacht', 'deploy.yml'),
      [
        'services:',
        '  yacht:',
        '    labels:',
        '      - traefik.enable=true',
        '      - traefik.http.routers.yacht.rule=Host(`yacht.lilnas.io`)',
        '      - traefik.http.routers.yacht.middlewares=lilnas-auth',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([
      { host: 'yacht.lilnas.io', gatedBy: 'lilnas-auth' },
    ])
  })

  it('a router carrying middlewares=forward-auth is reported as still on the old one', async () => {
    await writeFile(
      path.join(appsDir, 'portal', 'deploy.yml'),
      [
        'services:',
        '  portal:',
        '    labels:',
        '      - traefik.enable=true',
        '      - traefik.http.routers.portal.rule=Host(`portal.lilnas.io`)',
        '      - traefik.http.routers.portal.middlewares=forward-auth',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([
      { host: 'portal.lilnas.io', gatedBy: 'forward-auth' },
    ])
  })

  it('a router with no middlewares label at all is reported as none (e.g. this app is own UI-only router today)', async () => {
    await writeFile(
      path.join(appsDir, 'lilnas-auth', 'deploy.yml'),
      [
        'services:',
        '  lilnas-auth:',
        '    labels:',
        '      - traefik.enable=true',
        '      - traefik.http.routers.lilnas-auth.rule=Host(`login.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([{ host: 'login.lilnas.io', gatedBy: 'none' }])
  })

  it('covers the swole + swole-metrics-deny shape (apps/swole/deploy.yml): a host with two routers appears exactly once, classified by its auth-relevant router', async () => {
    await writeFile(
      path.join(appsDir, 'swole', 'deploy.yml'),
      [
        'services:',
        '  swole:',
        '    labels:',
        '      - traefik.enable=true',
        '      - traefik.http.routers.swole.rule=Host(`swole.lilnas.io`)',
        '      - traefik.http.routers.swole.middlewares=forward-auth',
        '      - traefik.http.routers.swole-metrics-deny.rule=Host(`swole.lilnas.io`) && PathPrefix(`/metrics`)',
        '      - traefik.http.routers.swole-metrics-deny.middlewares=swole-metrics-deny',
        '      - traefik.http.middlewares.swole-metrics-deny.ipallowlist.sourcerange=127.0.0.1/32',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([
      { host: 'swole.lilnas.io', gatedBy: 'forward-auth' },
    ])
  })

  it('a comma-separated middlewares value is split and each entry considered independently', async () => {
    await writeFile(
      path.join(appsDir, 'files', 'deploy.yml'),
      [
        'services:',
        '  files:',
        '    labels:',
        '      - traefik.http.routers.files.rule=Host(`files.lilnas.io`)',
        '      - traefik.http.routers.files.middlewares=servicestls,lilnas-auth',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([
      { host: 'files.lilnas.io', gatedBy: 'lilnas-auth' },
    ])
  })

  it("covers #22: map-form labels (Compose's object syntax, `labels: {key: value}`) are parsed the same as list-form", async () => {
    await writeFile(
      path.join(appsDir, 'map-form-service', 'deploy.yml'),
      [
        'services:',
        '  map-form-service:',
        '    labels:',
        '      traefik.enable: "true"',
        '      traefik.http.routers.map-form-service.rule: "Host(`map-form.lilnas.io`)"',
        '      traefik.http.routers.map-form-service.middlewares: "lilnas-auth"',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([
      { host: 'map-form.lilnas.io', gatedBy: 'lilnas-auth' },
    ])
  })

  it('excludes *.dev.lilnas.io hosts when includeDevHosts is false (production)', async () => {
    await writeFile(
      path.join(appsDir, 'exposed-thing', 'deploy.yml'),
      [
        'services:',
        '  exposed-thing:',
        '    labels:',
        '      - traefik.http.routers.exposed-thing.rule=Host(`myproject.dev.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([])
  })

  it('includes *.dev.lilnas.io hosts when includeDevHosts is true (development)', async () => {
    await writeFile(
      path.join(appsDir, 'exposed-thing', 'deploy.yml'),
      [
        'services:',
        '  exposed-thing:',
        '    labels:',
        '      - traefik.http.routers.exposed-thing.rule=Host(`myproject.dev.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: true,
    })

    expect(result).toEqual([
      { host: 'myproject.dev.lilnas.io', gatedBy: 'none' },
    ])
  })

  it('covers the blocklisted hosts portal already filters (auth, edge) staying filtered here too', async () => {
    await writeFile(
      path.join(infraDir, 'proxy.yml'),
      [
        'services:',
        '  traefik-forward-auth:',
        '    labels:',
        '      - traefik.http.routers.auth.rule=Host(`auth.lilnas.io`)',
        '      - traefik.http.routers.auth.middlewares=forward-auth',
        '      - traefik.http.routers.edge.rule=Host(`edge.lilnas.io`)',
        '      - traefik.http.routers.dashcam.rule=Host(`dashcam.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([{ host: 'dashcam.lilnas.io', gatedBy: 'none' }])
  })

  it('reads production infra/*.yml files but skips infra/*.dev.yml files', async () => {
    await writeFile(
      path.join(infraDir, 'monitoring.yml'),
      [
        'services:',
        '  grafana:',
        '    labels:',
        '      - traefik.http.routers.grafana.rule=Host(`grafana.lilnas.io`)',
        '      - traefik.http.routers.grafana.middlewares=forward-auth',
      ].join('\n'),
    )
    await writeFile(
      path.join(infraDir, 'monitoring.dev.yml'),
      [
        'services:',
        '  grafana:',
        '    labels:',
        '      - traefik.http.routers.grafana-dev.rule=Host(`grafana.localhost`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: true,
    })

    // grafana.localhost never matches HOST_REGEX (.lilnas.io only) even
    // though the dev file itself was not filtered by name — confirms BOTH
    // guards (file-name suffix AND host-suffix) are real, independent
    // checks, not one accidentally standing in for the other.
    expect(result).toEqual([
      { host: 'grafana.lilnas.io', gatedBy: 'forward-auth' },
    ])
  })

  it('an unparseable compose file is skipped without failing the whole scan', async () => {
    await writeFile(
      path.join(appsDir, 'broken', 'deploy.yml'),
      'this is: not: valid: yaml: [[[',
    )
    await writeFile(
      path.join(appsDir, 'dashcam', 'deploy.yml'),
      [
        'services:',
        '  dashcam:',
        '    labels:',
        '      - traefik.http.routers.dashcam.rule=Host(`dashcam.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([{ host: 'dashcam.lilnas.io', gatedBy: 'none' }])
  })

  it('an app directory with no deploy.yml at all is skipped without failing the whole scan', async () => {
    await fs.promises.mkdir(path.join(appsDir, 'no-deploy-file'), {
      recursive: true,
    })
    await writeFile(
      path.join(appsDir, 'dashcam', 'deploy.yml'),
      [
        'services:',
        '  dashcam:',
        '    labels:',
        '      - traefik.http.routers.dashcam.rule=Host(`dashcam.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result).toEqual([{ host: 'dashcam.lilnas.io', gatedBy: 'none' }])
  })

  it('covers the bind mount being entirely missing: degrades to an empty registry, logs a warning per missing directory, and does not throw', async () => {
    const missingAppsDir = path.join(tmpDir, 'does-not-exist-apps')
    const missingInfraDir = path.join(tmpDir, 'does-not-exist-infra')
    const warnings: Array<{ dir: string; err: unknown }> = []

    const result = await scanServiceRegistry(missingAppsDir, missingInfraDir, {
      includeDevHosts: false,
      onWarn: (dir, err) => warnings.push({ dir, err }),
    })

    expect(result).toEqual([])
    expect(warnings).toHaveLength(2)
    expect(warnings.map(w => w.dir).sort()).toEqual(
      [missingAppsDir, missingInfraDir].sort(),
    )
  })

  it('one directory missing and the other present: the present one still contributes its hosts', async () => {
    const missingAppsDir = path.join(tmpDir, 'does-not-exist-apps')
    await writeFile(
      path.join(infraDir, 'monitoring.yml'),
      [
        'services:',
        '  grafana:',
        '    labels:',
        '      - traefik.http.routers.grafana.rule=Host(`grafana.lilnas.io`)',
      ].join('\n'),
    )
    const warnings: string[] = []

    const result = await scanServiceRegistry(missingAppsDir, infraDir, {
      includeDevHosts: false,
      onWarn: dir => warnings.push(dir),
    })

    expect(result).toEqual([{ host: 'grafana.lilnas.io', gatedBy: 'none' }])
    expect(warnings).toEqual([missingAppsDir])
  })

  it('sorts entries alphabetically by host, deterministically regardless of file order', async () => {
    await writeFile(
      path.join(appsDir, 'zzz-service', 'deploy.yml'),
      [
        'services:',
        '  zzz:',
        '    labels:',
        '      - traefik.http.routers.zzz.rule=Host(`zzz.lilnas.io`)',
      ].join('\n'),
    )
    await writeFile(
      path.join(appsDir, 'aaa-service', 'deploy.yml'),
      [
        'services:',
        '  aaa:',
        '    labels:',
        '      - traefik.http.routers.aaa.rule=Host(`aaa.lilnas.io`)',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    expect(result.map(r => r.host)).toEqual(['aaa.lilnas.io', 'zzz.lilnas.io'])
  })

  it('covers the full repo shape end to end: all 9 currently-protected hosts appear, correctly attributed, alongside unprotected ones', async () => {
    await writeFile(
      path.join(appsDir, 'swole', 'deploy.yml'),
      [
        'services:',
        '  swole:',
        '    labels:',
        '      - traefik.http.routers.swole.rule=Host(`swole.lilnas.io`)',
        '      - traefik.http.routers.swole.middlewares=forward-auth',
        '      - traefik.http.routers.swole-metrics-deny.rule=Host(`swole.lilnas.io`) && PathPrefix(`/metrics`)',
        '      - traefik.http.routers.swole-metrics-deny.middlewares=swole-metrics-deny',
      ].join('\n'),
    )
    await writeFile(
      path.join(appsDir, 'tdr-bot', 'deploy.yml'),
      [
        'services:',
        '  tdr-bot:',
        '    labels:',
        '      - traefik.http.routers.tdr.rule=Host(`tdr.lilnas.io`)',
        '      - traefik.http.routers.tdr.middlewares=forward-auth',
      ].join('\n'),
    )
    await writeFile(
      path.join(appsDir, 'portal', 'deploy.yml'),
      [
        'services:',
        '  portal:',
        '    labels:',
        '      - traefik.http.routers.portal.rule=Host(`portal.lilnas.io`)',
        '      - traefik.http.routers.portal.middlewares=forward-auth',
      ].join('\n'),
    )
    await writeFile(
      path.join(appsDir, 'dashcam', 'deploy.yml'),
      [
        'services:',
        '  dashcam:',
        '    labels:',
        '      - traefik.http.routers.dashcam.rule=Host(`dashcam.lilnas.io`)',
      ].join('\n'),
    )
    await writeFile(
      path.join(infraDir, 'files.yml'),
      [
        'services:',
        '  files:',
        '    labels:',
        '      - traefik.http.routers.files.rule=Host(`files.lilnas.io`)',
        '      - traefik.http.routers.files.middlewares=forward-auth',
      ].join('\n'),
    )
    await writeFile(
      path.join(infraDir, 'monitoring.yml'),
      [
        'services:',
        '  yacht:',
        '    labels:',
        '      - traefik.http.routers.yacht.rule=Host(`yacht.lilnas.io`)',
        '      - traefik.http.routers.yacht.middlewares=forward-auth',
        '  prometheus:',
        '    labels:',
        '      - traefik.http.routers.prometheus.rule=Host(`prometheus.lilnas.io`)',
        '      - traefik.http.routers.prometheus.middlewares=forward-auth',
        '  grafana:',
        '    labels:',
        '      - traefik.http.routers.grafana.rule=Host(`grafana.lilnas.io`)',
        '      - traefik.http.routers.grafana.middlewares=forward-auth',
      ].join('\n'),
    )
    await writeFile(
      path.join(infraDir, 'proxy.yml'),
      [
        'services:',
        '  traefik:',
        '    labels:',
        '      - traefik.http.routers.traefik.rule=Host(`traefik.lilnas.io`)',
        '      - traefik.http.routers.traefik.middlewares=forward-auth',
        '  traefik-forward-auth:',
        '    labels:',
        // auth.lilnas.io is blocklisted (matches portal precedent) — present
        // here to prove it is EXCLUDED from the result below, not to prove
        // it is one of the "9".
        '      - traefik.http.routers.auth.rule=Host(`auth.lilnas.io`)',
        '      - traefik.http.routers.auth.middlewares=forward-auth',
      ].join('\n'),
    )

    const result = await scanServiceRegistry(appsDir, infraDir, {
      includeDevHosts: false,
    })

    const protectedHosts = result.filter(r => r.gatedBy === 'forward-auth')
    expect(protectedHosts.map(r => r.host).sort()).toEqual(
      [
        'swole.lilnas.io',
        'tdr.lilnas.io',
        'portal.lilnas.io',
        'files.lilnas.io',
        'yacht.lilnas.io',
        'prometheus.lilnas.io',
        'grafana.lilnas.io',
        'traefik.lilnas.io',
      ].sort(),
    )
    // auth.lilnas.io is blocklisted — the 9th real forward-auth host in the
    // live repo is intentionally excluded from THIS admin UI, per the
    // ported portal blocklist.
    expect(result.some(r => r.host === 'auth.lilnas.io')).toBe(false)
    expect(result.some(r => r.host === 'dashcam.lilnas.io')).toBe(true)
  })
})
