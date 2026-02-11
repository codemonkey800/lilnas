import { notFound } from 'next/navigation'

import { getTemplate } from 'src/app/(app)/templates/queries'

import { TemplateDetail } from './template-detail'

interface TemplateDetailPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: TemplateDetailPageProps) {
  const { id } = await params
  const template = await getTemplate(id)

  return {
    title: template ? `${template.name} — Sync` : 'Template — Sync',
  }
}

export default async function TemplateDetailPage({
  params,
}: TemplateDetailPageProps) {
  const { id } = await params
  const template = await getTemplate(id)

  if (!template) {
    notFound()
  }

  return <TemplateDetail template={template} />
}
