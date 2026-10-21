import type { JSX } from 'react'

import { Panel, PanelHead } from 'src/components/detail/panel'
import { Chip, type ChipTone } from 'src/components/ui/chip'
import { Dot } from 'src/components/ui/status'
import { formatAgo, formatBytes, UNKNOWN_VALUE } from 'src/lib/format'
import { serviceName } from 'src/lib/stack-display'
import type { ServiceView } from 'src/stacks/stacks.types'

function stateLook(svc: ServiceView): { label: string; tone: ChipTone } {
  const c = svc.container
  if (!c) return { label: 'not created', tone: 'mute' }
  switch (c.state) {
    case 'running':
      return { label: 'running', tone: 'ok' }
    case 'exited':
      return { label: 'exited', tone: c.exitCode ? 'bad' : 'mute' }
    case 'created':
    case 'restarting':
      return { label: 'starting', tone: 'warn' }
    case 'dead':
      return { label: 'dead', tone: 'bad' }
    default:
      return { label: c.state, tone: 'mute' }
  }
}

function StateText({ service }: { service: ServiceView }): JSX.Element {
  const { label, tone } = stateLook(service)
  return <Chip label={label} tone={tone} />
}

function HealthText({ service }: { service: ServiceView }): JSX.Element {
  const c = service.container
  if (c?.state !== 'running' || !c.health) {
    return <span className="font-mono text-mono-sm text-ink-4">—</span>
  }
  const tone =
    c.health === 'unhealthy' ? 'bad' : c.health === 'starting' ? 'warn' : 'ok'
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-mono-sm">
      <Dot tone={tone} />
      <span className={c.health === 'unhealthy' ? 'text-bad' : 'text-ink-2'}>
        {c.health}
      </span>
    </span>
  )
}

function exitText(svc: ServiceView): string {
  const c = svc.container
  return c?.state === 'exited' && c.exitCode !== undefined
    ? String(c.exitCode)
    : UNKNOWN_VALUE
}

const startedText = (svc: ServiceView, now: number) =>
  formatAgo(svc.container?.startedAt, now)

const cpuText = (svc: ServiceView) =>
  svc.stats ? `${svc.stats.cpuPercent.toFixed(1)}%` : UNKNOWN_VALUE

const memText = (svc: ServiceView) =>
  svc.stats ? formatBytes(svc.stats.memoryBytes) : UNKNOWN_VALUE

const portsText = (svc: ServiceView) =>
  svc.loopbackPorts.length > 0 ? svc.loopbackPorts.join(' ') : UNKNOWN_VALUE

const imageText = (svc: ServiceView) => svc.container?.image ?? UNKNOWN_VALUE

const exitTone = (svc: ServiceView) =>
  svc.container?.exitCode ? 'text-bad' : 'text-ink-3'

function ServicesTable({
  services,
  now,
}: {
  services: ServiceView[]
  now: number
}): JSX.Element {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full border-collapse [&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-3 [&_td]:align-middle [&_td]:text-sm [&_tbody_tr]:transition-colors [&_tbody_tr]:duration-[120ms] [&_tbody_tr]:ease-uv [&_tbody_tr:hover]:bg-surface-2 [&_tbody_tr:last-child_td]:border-b-0 [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-mono [&_th]:text-label [&_th]:font-medium [&_th]:tracking-[0.11em] [&_th]:text-ink-4 [&_th]:uppercase">
        <thead>
          <tr>
            <th>Container</th>
            <th>Image</th>
            <th>State</th>
            <th>Health</th>
            <th>Started</th>
            <th className="text-right">Exit</th>
            <th className="text-right">CPU</th>
            <th className="text-right">Mem</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {services.map(svc => (
            <tr key={svc.name}>
              <td>
                <div className="font-mono text-mono text-ink">
                  {serviceName(svc)}
                </div>
                <div className="font-mono text-mono-sm text-ink-4">
                  {svc.name}
                </div>
              </td>
              <td className="font-mono text-mono-sm text-ink-3">
                {imageText(svc)}
              </td>
              <td>
                <StateText service={svc} />
              </td>
              <td>
                <HealthText service={svc} />
              </td>
              <td className="font-mono text-mono-sm whitespace-nowrap text-ink-3">
                {startedText(svc, now)}
              </td>
              <td
                className={`text-right font-mono text-mono-sm tabular-nums ${exitTone(svc)}`}
              >
                {exitText(svc)}
              </td>
              <td className="text-right font-mono text-mono-sm text-ink-2 tabular-nums">
                {cpuText(svc)}
              </td>
              <td className="text-right font-mono text-mono-sm whitespace-nowrap text-ink-2 tabular-nums">
                {memText(svc)}
              </td>
              <td className="font-mono text-mono-sm whitespace-nowrap text-ink-2">
                {portsText(svc)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Mobile: one card per container, since nine columns don't fit in 390px. */
function ServicesCards({
  services,
  now,
}: {
  services: ServiceView[]
  now: number
}): JSX.Element {
  return (
    <ul className="flex flex-col md:hidden">
      {services.map(svc => (
        <li
          className="flex flex-col gap-2.5 px-4 py-3.5 [&+&]:border-t [&+&]:border-line-soft"
          key={svc.name}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-mono break-all text-ink">
                {serviceName(svc)}
              </div>
              <div className="font-mono text-mono-sm text-ink-4">
                {svc.name} · {imageText(svc)}
              </div>
            </div>
            <StateText service={svc} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-mono-sm">
            {(
              [
                ['health', <HealthText key="h" service={svc} />],
                ['started', startedText(svc, now)],
                ['exit', exitText(svc)],
                ['cpu', cpuText(svc)],
                ['mem', memText(svc)],
                ['port', portsText(svc)],
              ] as const
            ).map(([label, value]) => (
              <div
                className="flex items-baseline justify-between gap-2"
                key={label}
              >
                <dt className="text-ink-4">{label}</dt>
                <dd className="min-w-0 text-ink-2 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  )
}

/** Every container of the stack: a table on desktop, cards on mobile. */
export function ServicesPanel({
  services,
  now,
}: {
  services: ServiceView[]
  now: number
}): JSX.Element {
  return (
    <Panel aria-label="Services">
      <PanelHead
        caption={`${services.length} ${services.length === 1 ? 'container' : 'containers'}`}
        title="Services"
      />
      <ServicesTable now={now} services={services} />
      <ServicesCards now={now} services={services} />
    </Panel>
  )
}
