import Link from 'next/link'
import { HiPlus } from 'react-icons/hi2'

import { Button } from 'src/components/ui/button'

import { getTemplates } from './queries'
import { TemplateList } from './template-list'

export const metadata = {
  title: 'Templates — Sync',
}

export default async function TemplatesPage() {
  const templates = await getTemplates()

  return (
    <div className="flex flex-col gap-6 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-text md:text-3xl">
          Templates
        </h1>

        {templates && (
          <Link href="/templates/new">
            <Button size="sm">
              <HiPlus className="h-4 w-4" />
              New Template
            </Button>
          </Link>
        )}
      </div>

      {/* Content */}
      {templates ? (
        <TemplateList templates={templates} />
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-raised py-10">
          <p className="text-sm text-text-muted">
            Connect with a partner to create and manage templates.
          </p>
          <Link
            href="/partner"
            className="text-sm font-medium text-primary-400 transition-colors duration-150 ease-smooth hover:text-primary-300"
          >
            Set up your partnership
          </Link>
        </div>
      )}
    </div>
  )
}
