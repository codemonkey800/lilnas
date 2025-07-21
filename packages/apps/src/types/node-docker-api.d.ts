declare module 'node-docker-api' {
  interface DockerOptions {
    socketPath?: string
    host?: string
    port?: number
    protocol?: string
    version?: string
  }

  interface ContainerData {
    Id: string
    Names: string[]
    Image: string
    ImageID: string
    Command: string
    Created: number
    State:
      | 'running'
      | 'stopped'
      | 'paused'
      | 'restarting'
      | 'removing'
      | 'exited'
      | 'dead'
    Status: string
    Ports: Array<{
      IP?: string
      PrivatePort: number
      PublicPort?: number
      Type: string
    }>
    Labels: Record<string, string>
    SizeRw?: number
    SizeRootFs?: number
    HostConfig: {
      NetworkMode?: string
    }
    NetworkSettings?: {
      Networks?: Record<string, unknown>
    }
    Mounts?: Array<{
      Type: string
      Source: string
      Destination: string
      Mode?: string
      RW?: boolean
      Propagation?: string
    }>
  }

  interface Container {
    data: ContainerData
    id: string
  }

  interface ContainerManager {
    list(options?: {
      all?: boolean
      limit?: number
      size?: boolean
      filters?: Record<string, string[]>
    }): Promise<Container[]>
    get(id: string): Container
    create(options: unknown): Promise<Container>
  }

  export class Docker {
    container: ContainerManager

    constructor(options?: DockerOptions)
  }
}
