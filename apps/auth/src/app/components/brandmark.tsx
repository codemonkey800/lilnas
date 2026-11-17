import { Doorplate } from '@lilnas/ui'

// The signature at the top of every page: the pepe badge plus `auth.lilnas.io`
// (`Doorplate`). `href` makes it link somewhere other than the portal (e.g.
// back to `/` from the admin topbar). `label` is a small trailing word next
// to it (e.g. "admin" on the admin dashboard) — the Doorplate itself has no
// slot for one, so it sits beside it.
export type BrandmarkProps = {
  label?: string
  href?: string
}

export function Brandmark({ label, href }: BrandmarkProps) {
  const doorplate = <Doorplate app="auth" href={href ?? null} />

  if (!label) return doorplate

  return (
    <span className="inline-flex items-center gap-2">
      {doorplate}
      <span className="text-sm text-ink-3">{label}</span>
    </span>
  )
}
