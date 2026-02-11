import Link from 'next/link'

import { getTemplates } from 'src/app/(app)/templates/queries'

import { CreateCheckInForm } from './create-check-in-form'

export const metadata = {
  title: 'New Check-in — Sync',
}

export default async function NewCheckInPage() {
  const templates = await getTemplates()

  if (!templates) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-raised py-10 animate-fade-in">
        <p className="text-sm text-text-muted">
          Connect with a partner to create check-ins.
        </p>
        <Link
          href="/partner"
          className="text-sm font-medium text-primary-400 transition-colors duration-150 ease-smooth hover:text-primary-300"
        >
          Set up your partnership
        </Link>
      </div>
    )
  }

  return <CreateCheckInForm templates={templates} />
}
