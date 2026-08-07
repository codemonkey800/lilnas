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
    return <p className="caption">No services discovered yet.</p>
  }
  return (
    <div className="service-check-grid">
      {hosts.map(host => {
        const meta = getServiceMeta(host)
        return (
          <label key={host} className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.has(host)}
              onChange={event => onToggle(host, event.target.checked)}
              disabled={disabled}
            />
            <span className="service-tile__icon h-[26px] w-[26px]">
              <Icon name={meta.icon} />
            </span>
            <span className="small font-medium">{meta.name}</span>
          </label>
        )
      })}
    </div>
  )
}
