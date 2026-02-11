import { TemplateForm } from 'src/app/(app)/templates/template-form'

export const metadata = {
  title: 'New Template — Sync',
}

export default function NewTemplatePage() {
  return <TemplateForm mode="create" />
}
