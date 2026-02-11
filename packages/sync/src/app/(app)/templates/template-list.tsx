'use client'

import Link from 'next/link'
import { HiPlus } from 'react-icons/hi2'

import { TemplateCard } from './template-card'
import type { TemplateListItem } from './types'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TemplateListProps {
  templates: TemplateListItem[]
}

// ---------------------------------------------------------------------------
// TemplateList
// ---------------------------------------------------------------------------

export function TemplateList({ templates }: TemplateListProps) {
  const systemTemplates = templates.filter(t => t.isSystem)
  const customTemplates = templates.filter(t => !t.isSystem)

  return (
    <div className="flex flex-col gap-8">
      {/* System templates */}
      {systemTemplates.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-text">
            Default Templates
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {systemTemplates.map(t => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        </section>
      )}

      {/* Custom templates */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-text">Your Templates</h2>

        {customTemplates.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {customTemplates.map(t => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-raised py-10">
            <p className="text-sm text-text-muted">
              No custom templates yet.
            </p>
            <Link
              href="/templates/new"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-400 transition-colors duration-150 ease-smooth hover:text-primary-300"
            >
              <HiPlus className="h-4 w-4" />
              Create your first template
            </Link>
          </div>
        )}
      </section>
    </div>
  )
}
