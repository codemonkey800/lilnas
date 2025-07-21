'use server'

import type { Container } from 'node-docker-api'
import { Docker } from 'node-docker-api'

const HOST_REGEX = /Host\(`([\S]+\.lilnas\.io)`\)/

const HOST_BLOCKLIST = new Set(['auth', 'edge'])

function isDefined<T>(value: T): value is NonNullable<typeof value> {
  return value != null
}

export async function getAppHosts() {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' })

  const containers = await docker.container.list()
  const runningContainers = containers
    .filter((container: Container) => container.data.State === 'running')
    .map((container: Container) => container.data)

  const hosts = runningContainers
    .flatMap(container =>
      Object.values(container.Labels).filter((label: string) =>
        HOST_REGEX.test(label),
      ),
    )
    .filter(isDefined)
    .map((host: string) => HOST_REGEX.exec(host)?.at(1))
    .filter(isDefined)
    .filter(
      (host: string) => !HOST_BLOCKLIST.has(host.replace('.lilnas.io', '')),
    )
    .sort((a: string, b: string) => a.localeCompare(b))

  return hosts
}
