import { notFound, redirect } from 'next/navigation'

import { getTemplate } from 'src/app/(app)/templates/queries'
import { TemplateForm } from 'src/app/(app)/templates/template-form'

interface EditTemplatePageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: EditTemplatePageProps) {
  const { id } = await params
  const template = await getTemplate(id)

  return {
    title: template ? `Edit ${template.name} — Sync` : 'Edit Template — Sync',
  }
}

export default async function EditTemplatePage({
  params,
}: EditTemplatePageProps) {
  const { id } = await params
  const template = await getTemplate(id)

  if (!template) {
    notFound()
  }

  // System templates cannot be edited
  if (template.isSystem) {
    redirect(`/templates/${id}`)
  }

  return <TemplateForm mode="edit" initialData={template} />
}
