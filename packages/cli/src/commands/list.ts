import { Command, Flags } from '@oclif/core'

import {
  discoverAllServiceDetails,
  discoverAppServiceDetails,
  discoverInfraServiceDetails,
  type ServiceInfo,
  type ServiceMode,
  type ServiceType,
} from 'src/services/discovery.js'
import { formatStatus, getContainerStatuses } from 'src/services/docker.js'

interface DisplayRow {
  name: string
  status: string
  url: string
  port: string
  image: string
}

const COLUMNS: { key: keyof DisplayRow; header: string }[] = [
  { key: 'name', header: 'NAME' },
  { key: 'status', header: 'STATUS' },
  { key: 'url', header: 'URL' },
  { key: 'port', header: 'PORT' },
  { key: 'image', header: 'IMAGE' },
]

const SECTION_TITLES: Record<ServiceType, string> = {
  app: 'Apps',
  service: 'Services',
  tool: 'Tools',
}

const SECTION_ORDER: ServiceType[] = ['app', 'service', 'tool']

function buildUrl(domain: string | undefined, mode: ServiceMode): string {
  if (!domain) return '-'
  return mode === 'prod' ? `https://${domain}` : `http://${domain}`
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 3) + '...' : value
}

function renderTable(title: string, rows: DisplayRow[]): string {
  const maxImage = 30

  // Compute column widths from headers + data
  const widths = new Map<keyof DisplayRow, number>()
  for (const col of COLUMNS) {
    widths.set(
      col.key,
      Math.max(
        col.header.length,
        ...rows.map(r => {
          const val =
            col.key === 'image' ? truncate(r[col.key], maxImage) : r[col.key]
          return val.length
        }),
      ),
    )
  }

  const pad = (val: string, key: keyof DisplayRow) => {
    const w = widths.get(key)!
    const display = key === 'image' ? truncate(val, maxImage) : val
    return display.padEnd(w)
  }

  const headerLine = COLUMNS.map(c => pad(c.header, c.key)).join('  ')
  const separatorLine = COLUMNS.map(c => '-'.repeat(widths.get(c.key)!)).join(
    '  ',
  )
  const dataLines = rows.map(row =>
    COLUMNS.map(c => pad(row[c.key], c.key)).join('  '),
  )

  return [title, headerLine, separatorLine, ...dataLines].join('\n')
}

function groupByType(
  rows: { type: ServiceType; row: DisplayRow }[],
): Map<ServiceType, DisplayRow[]> {
  const groups = new Map<ServiceType, DisplayRow[]>()
  for (const { type, row } of rows) {
    const existing = groups.get(type) ?? []
    existing.push(row)
    groups.set(type, existing)
  }

  return groups
}

export default class List extends Command {
  static override aliases = ['ls']

  static override description =
    'List discovered services from deploy and infra compose files'

  static override flags = {
    apps: Flags.boolean({
      description: 'List only app services (from packages/*/deploy.yml)',
      exclusive: ['services'],
    }),
    json: Flags.boolean({
      description: 'Output as JSON',
    }),
    services: Flags.boolean({
      description: 'List only infra services (from infra/*.yml)',
      exclusive: ['apps'],
    }),
  }

  mode: ServiceMode = 'prod'

  async run(): Promise<void> {
    const { flags } = await this.parse(List)

    let serviceInfos: ServiceInfo[]

    if (flags.apps) {
      serviceInfos = discoverAppServiceDetails(this.mode)
    } else if (flags.services) {
      serviceInfos = discoverInfraServiceDetails(this.mode)
    } else {
      serviceInfos = discoverAllServiceDetails(this.mode)
    }

    const statuses = getContainerStatuses(this.mode)
    const traefikRunning = statuses.get('traefik')?.state === 'running'

    const rows = serviceInfos.map(info => {
      const container = statuses.get(info.name)
      const isRunning = container?.state === 'running'
      const showUrl = isRunning && traefikRunning

      return {
        type: info.type,
        row: {
          name: info.name,
          status: formatStatus(container),
          url: showUrl ? buildUrl(info.domain, this.mode) : '-',
          port: isRunning && info.port ? String(info.port) : '-',
          image: info.image ?? '-',
        },
      }
    })

    if (flags.json) {
      this.log(JSON.stringify(rows, null, 2))
      return
    }

    if (rows.length === 0) {
      this.log('No services found.')
      return
    }

    const groups = groupByType(rows)
    const tables = SECTION_ORDER.filter(type => groups.has(type)).map(type =>
      renderTable(SECTION_TITLES[type], groups.get(type)!),
    )

    this.log(tables.join('\n\n'))
  }
}
