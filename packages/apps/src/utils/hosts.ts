'use server'

import { Docker } from 'node-docker-api'

interface ContainerData {
  State: 'running' | 'stopped'
  Labels: Record<string, string>
}

const HOST_REGEX = /Host\(`([\S]+\.lilnas\.io)`\)/

const HOST_BLOCKLIST = new Set(['auth', 'edge'])

function isDefined<T>(value: T): value is NonNullable<typeof value> {
  return value != null
}

export async function getAppHosts() {
  const docker = new Docker({ socketPath: '/var/run/docker.sock' })

  const containers = await docker.container.list()
  const runningContainers = containers
    .filter(
      container =>
        (container.data as Record<string, unknown>).State === 'running',
    )
    .map(container => container.data as ContainerData)

  const hosts = runningContainers
    .flatMap(container =>
      Object.values(container.Labels).filter(label => HOST_REGEX.test(label)),
    )
    .filter(isDefined)
    .map(host => HOST_REGEX.exec(host)?.at(1))
    .filter(isDefined)
    .filter(host => !HOST_BLOCKLIST.has(host.replace('.lilnas.io', '')))
    .sort((a, b) => a.localeCompare(b))

  return hosts
}