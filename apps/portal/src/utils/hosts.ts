'use server'

import fs from 'fs/promises'
import type { Container } from 'node-docker-api'
import { Docker } from 'node-docker-api'
import path from 'path'

const HOST_REGEX = /Host\(`([\S]+\.lilnas\.io)`\)/

const HOST_BLOCKLIST = new Set(['auth', 'edge'])

function isDefined<T>(value: T): value is NonNullable<typeof value> {
  return value != null
}

function extractHostsFromLabels(labels: string[]): string[] {
  return labels
    .filter((label: string) => HOST_REGEX.test(label))
    .map((label: string) => HOST_REGEX.exec(label)?.at(1))
    .filter(isDefined)
    .filter(
      (host: string) => !HOST_BLOCKLIST.has(host.replace('.lilnas.io', '')),
    )
}

async function getHostsFromDocker(): Promise<string[]> {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' })

  const containers = await docker.container.list()
  const runningContainers = containers
    .filter((container: Container) => container.data.State === 'running')
    .map((container: Container) => container.data)

  return runningContainers.flatMap(container =>
    extractHostsFromLabels(Object.values(container.Labels)),
  )
}

async function getHostsFromFiles(): Promise<string[]> {
  const { parse } = await import('yaml')

  const root = path.resolve(process.cwd(), '../..')

  const appsDir = path.join(root, 'apps')
  const appEntries = await fs.readdir(appsDir, { withFileTypes: true })
  const appDeployFiles = appEntries
    .filter(e => e.isDirectory())
    .map(e => path.join(appsDir, e.name, 'deploy.yml'))

  const infraDir = path.join(root, 'infra')
  const infraEntries = await fs.readdir(infraDir, { withFileTypes: true })
  const infraFiles = infraEntries
    .filter(
      e =>
        e.isFile() && e.name.endsWith('.yml') && !e.name.endsWith('.dev.yml'),
    )
    .map(e => path.join(infraDir, e.name))

  const allFiles = [...appDeployFiles, ...infraFiles]

  const labelArrays = await Promise.all(
    allFiles.map(async filePath => {
      try {
        const content = await fs.readFile(filePath, 'utf-8')
        const doc = parse(content) as {
          services?: Record<string, { labels?: string[] }>
        }
        return Object.values(doc?.services ?? {}).flatMap(
          service => service?.labels ?? [],
        )
      } catch {
        return []
      }
    }),
  )

  return extractHostsFromLabels(labelArrays.flat())
}

export async function getAppHosts() {
  const hosts =
    process.env.NODE_ENV === 'development'
      ? await getHostsFromFiles()
      : await getHostsFromDocker()

  return [...new Set(hosts)].sort((a, b) => a.localeCompare(b))
}
