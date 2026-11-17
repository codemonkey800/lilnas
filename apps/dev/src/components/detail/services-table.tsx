import { Badge, type BadgeTone, type Column, DataList } from '@lilnas/ui'
import type { JSX } from 'react'

import { formatAgo, formatBytes, UNKNOWN_VALUE } from 'src/lib/format'
import { serviceName } from 'src/lib/stack-display'
import type { ServiceView } from 'src/stacks/stacks.types'

function stateLook(svc: ServiceView): { label: string; tone: BadgeTone } {
  const c = svc.container
  if (!c) return { label: 'Not created', tone: 'mute' }
  switch (c.state) {
    case 'running':
      return c.health === 'unhealthy'
        ? { label: 'Unhealthy', tone: 'warn' }
        : { label: 'Running', tone: 'ok' }
    case 'exited':
      return { label: 'Exited', tone: c.exitCode ? 'bad' : 'mute' }
    case 'created':
    case 'restarting':
      return { label: 'Starting', tone: 'warn' }
    case 'dead':
      return { label: 'Dead', tone: 'bad' }
    default:
      return { label: c.state, tone: 'mute' }
  }
}

function exitText(svc: ServiceView): string {
  const c = svc.container
  return c?.state === 'exited' && c.exitCode !== undefined
    ? String(c.exitCode)
    : UNKNOWN_VALUE
}

const cpuText = (svc: ServiceView) =>
  svc.stats ? `${svc.stats.cpuPercent.toFixed(1)}%` : UNKNOWN_VALUE

const memText = (svc: ServiceView) =>
  svc.stats ? formatBytes(svc.stats.memoryBytes) : UNKNOWN_VALUE

const portsText = (svc: ServiceView) =>
  svc.loopbackPorts.length > 0 ? svc.loopbackPorts.join(' ') : UNKNOWN_VALUE

const imageText = (svc: ServiceView) => svc.container?.image ?? UNKNOWN_VALUE

function healthText(svc: ServiceView): JSX.Element | string {
  const c = svc.container
  if (c?.state !== 'running' || !c.health) return UNKNOWN_VALUE
  return (
    <span className={c.health === 'unhealthy' ? 'text-bad' : undefined}>
      {c.health}
    </span>
  )
}

/** The columns, defined once: a table from `md` up, one card per container below. */
function columns(now: number): Column<ServiceView>[] {
  return [
    {
      key: 'container',
      header: 'Container',
      mono: true,
      primary: true,
      render: svc => (
        <>
          <span className="text-ink">{serviceName(svc)}</span>
          <span className="block text-mono-sm text-ink-3">{svc.name}</span>
        </>
      ),
    },
    { key: 'image', header: 'Image', mono: true, render: imageText },
    {
      key: 'state',
      header: 'State',
      render: svc => {
        const { label, tone } = stateLook(svc)
        return <Badge tone={tone}>{label}</Badge>
      },
    },
    { key: 'health', header: 'Health', render: healthText },
    {
      key: 'started',
      header: 'Started',
      render: svc => formatAgo(svc.container?.startedAt, now),
    },
    {
      key: 'exit',
      header: 'Exit',
      align: 'right',
      render: svc => (
        <span className={svc.container?.exitCode ? 'text-bad' : undefined}>
          {exitText(svc)}
        </span>
      ),
    },
    { key: 'cpu', header: 'CPU', align: 'right', render: cpuText },
    { key: 'mem', header: 'Mem', align: 'right', render: memText },
    { key: 'published', header: 'Published', mono: true, render: portsText },
  ]
}

/** Every container of the stack: one `DataList`, so the two layouts can't drift. */
export function ServicesPanel({
  services,
  now,
}: {
  services: ServiceView[]
  now: number
}): JSX.Element {
  return (
    <section aria-label="Services">
      <div className="mb-3 flex flex-col gap-0.5">
        <h2 className="text-h3">Services</h2>
        <p className="text-cap text-ink-3">
          {services.length} {services.length === 1 ? 'container' : 'containers'}
        </p>
      </div>
      <DataList
        caption="Services"
        columns={columns(now)}
        rowKey={svc => svc.name}
        rows={services}
      />
    </section>
  )
}
