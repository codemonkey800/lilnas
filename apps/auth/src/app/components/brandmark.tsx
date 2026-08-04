import Link from 'next/link'

// Ported from the design mockups' `.brandmark` markup (badge + wordmark),
// used at the top of every page. `label` renders a small trailing word next
// to the wordmark (e.g. "admin" on the merged admin dashboard); `href` makes
// the whole mark a link (e.g. back to `/` from the admin topbar) — plain
// text otherwise.
export type BrandmarkProps = {
  label?: string
  href?: string
}

export function Brandmark({ label, href }: BrandmarkProps) {
  const content = (
    <>
      <span className="brandmark__badge">
        {/* Plain <img>, not next/image — a local public/ asset with no
            remote-optimization benefit, matching home-client.tsx's own
            precedent for the same reason. */}
        <img src="/sad-pepe.svg" alt="" />
      </span>
      <span className="brandmark__word">
        lilnas<span>.io</span>
        {label ? <span className="ml-1">{label}</span> : null}
      </span>
    </>
  )

  if (href) {
    return (
      <Link href={href} className="brandmark">
        {content}
      </Link>
    )
  }

  return <div className="brandmark">{content}</div>
}
