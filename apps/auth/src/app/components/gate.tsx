import { Avatar, Doorplate, Icon, StatusDot } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ReactNode } from 'react'

import { getServiceMeta } from 'src/app/service-meta'

// The furniture of the centred-card screens (login, pending, blocked): a
// full-height column with the doorplate top-left, then one card centred in
// the rest. Login is the front door and carries the mark in its card
// instead, so it opts out of the doorplate.
export function GateScreen({
  children,
  doorplate = true,
}: {
  children: ReactNode
  doorplate?: boolean
}) {
  return (
    <div className="flex min-h-screen flex-col">
      {doorplate ? (
        <header className="px-4 py-4 sm:px-6">
          <Doorplate app="auth" />
        </header>
      ) : null}
      <main className="flex flex-1 items-center justify-center px-4 pt-4 pb-20 sm:px-6 sm:pt-6 sm:pb-24">
        {children}
      </main>
    </div>
  )
}

// `narrow` is login's 380px card; the others are 420px.
export function GateCard({
  children,
  narrow = false,
}: {
  children: ReactNode
  narrow?: boolean
}) {
  return (
    <div
      className={cns(
        'flex w-full flex-col gap-5 rounded-lg border border-line bg-surface p-5 sm:p-6',
        narrow ? 'max-w-[380px]' : 'max-w-[420px]',
      )}
    >
      {children}
    </div>
  )
}

// A heading and the line under it, centred. `role="status"` + a polite live
// region so a pending page's in-place change (waiting → declined) is spoken.
export function GateHeading({
  title,
  body,
  live = false,
  className,
}: {
  title: string
  body?: string
  live?: boolean
  className?: string
}) {
  return (
    <div
      className={cns('flex flex-col gap-1.5 text-center', className)}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <h1 className="text-h1">{title}</h1>
      {body ? <p className="text-body text-ink-3">{body}</p> : null}
    </div>
  )
}

export type StatusRingKind = 'waiting' | 'declined' | 'blocked'

const STATUS_RING_LABELS: Record<StatusRingKind, string> = {
  waiting: 'Waiting',
  declined: 'Declined',
  blocked: 'Blocked',
}

// The hero on pending and blocked: a 64px ring. 'waiting' is a large live
// accent dot (the system is working on it); 'declined' and 'blocked' are an x.
export function StatusRing({ kind }: { kind: StatusRingKind }) {
  const waiting = kind === 'waiting'

  return (
    <span
      className={cns(
        'mx-auto grid size-16 shrink-0 place-items-center rounded-full border',
        waiting
          ? 'border-line bg-surface-2'
          : 'border-transparent bg-bad-ghost text-bad',
      )}
      role="img"
      aria-label={STATUS_RING_LABELS[kind]}
    >
      {waiting ? (
        <span className="grid scale-[2] place-items-center">
          <StatusDot tone="accent" pulse />
        </span>
      ) : (
        <Icon name="x" size={24} />
      )}
    </span>
  )
}

// Who is signed in: avatar (accent, because it is you), name, email in mono.
export function IdentityRow({
  name,
  email,
  initials,
}: {
  name: string
  email: string
  initials: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg-sunk p-3 text-left">
      <Avatar initials={initials} size={32} self />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate font-mono text-mono-sm text-ink-3">
          {email}
        </span>
      </span>
    </div>
  )
}

// Where they were headed: the service's icon, name and host in mono.
export function TargetPill({ host }: { host: string }) {
  const meta = getServiceMeta(host)

  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg-sunk p-3 text-left">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-accent-ghost text-accent-hi">
        <Icon name={meta.icon} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{meta.name}</span>
        <span className="truncate font-mono text-mono-sm text-ink-3">
          {host}
        </span>
      </span>
    </div>
  )
}
