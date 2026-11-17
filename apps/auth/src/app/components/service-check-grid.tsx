import { Checkbox } from '@lilnas/ui'

import { Icon } from 'src/app/components/icons'
import { getServiceMeta } from 'src/app/service-meta'

export function ServiceCheckGrid({
  hosts,
  selected,
  onToggle,
  disabled,
}: {
  hosts: string[]
  selected: Set<string>
  onToggle: (host: string, checked: boolean) => void
  disabled: boolean
}) {
  if (hosts.length === 0) {
    return <p className="text-cap text-ink-3">No services discovered yet.</p>
  }
  return (
    // The column count follows the container's width: one column in a phone
    // sized dialog, two in the 420px one, up to five in the wide one.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
      {hosts.map(host => {
        const meta = getServiceMeta(host)
        return (
          <Checkbox
            key={host}
            checked={selected.has(host)}
            onCheckedChange={checked => onToggle(host, checked)}
            disabled={disabled}
            className="w-full min-w-0 rounded-md border border-line px-2.5 py-2 hover:border-line-loud has-data-checked:border-accent-dim has-data-checked:bg-accent-ghost"
            label={
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-[26px] shrink-0 place-items-center rounded-md bg-accent-ghost text-accent-hi">
                  <Icon name={meta.icon} />
                </span>
                <span className="truncate font-medium text-ink">
                  {meta.name}
                </span>
              </span>
            }
          />
        )
      })}
    </div>
  )
}
