import { TemplateForm } from '../template-form'

export const metadata = {
  title: 'New Template — Sync',
}

export default function NewTemplatePage() {
  return <TemplateForm mode="create" />
}
