import http from 'http'

const SOCKET_PATH = '/var/run/docker.sock'

export interface ContainerState {
  Status:
    | 'created'
    | 'running'
    | 'paused'
    | 'restarting'
    | 'removing'
    | 'exited'
    | 'dead'
  Running: boolean
  StartedAt: string
  FinishedAt: string
}

interface ContainerInspect {
  State: ContainerState
}

interface ContainerStats {
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>
}

interface EngineResponse {
  statusCode: number
  body: string
}

export class DockerEngineError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message)
  }
}

function request(method: 'GET' | 'POST', path: string) {
  return new Promise<EngineResponse>((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET_PATH, method, path }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (body += chunk))
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
    })

    req.on('error', reject)
    req.end()
  })
}

async function expectOk(
  method: 'GET' | 'POST',
  path: string,
): Promise<EngineResponse> {
  const res = await request(method, path)

  // 304 is the engine's "already started" / "already stopped".
  if (res.statusCode >= 400) {
    let message = res.body
    try {
      message = (JSON.parse(res.body) as { message: string }).message
    } catch {
      // Keep the raw body.
    }
    throw new DockerEngineError(res.statusCode, message)
  }

  return res
}

/**
 * Returns the container's state, or null when no container has that name.
 */
export async function inspectContainer(
  name: string,
): Promise<ContainerState | null> {
  try {
    const res = await expectOk(
      'GET',
      `/containers/${encodeURIComponent(name)}/json`,
    )
    return (JSON.parse(res.body) as ContainerInspect).State
  } catch (error) {
    if (error instanceof DockerEngineError && error.statusCode === 404) {
      return null
    }
    throw error
  }
}

export async function startContainer(name: string) {
  await expectOk('POST', `/containers/${encodeURIComponent(name)}/start`)
}

export async function stopContainer(name: string) {
  await expectOk('POST', `/containers/${encodeURIComponent(name)}/stop?t=15`)
}

/**
 * Total bytes received + sent across the container's network interfaces
 * since it started.
 */
export async function getContainerNetworkBytes(name: string) {
  const res = await expectOk(
    'GET',
    `/containers/${encodeURIComponent(name)}/stats?stream=false&one-shot=true`,
  )
  const { networks = {} } = JSON.parse(res.body) as ContainerStats

  return Object.values(networks).reduce(
    (total, net) => total + net.rx_bytes + net.tx_bytes,
    0,
  )
}
