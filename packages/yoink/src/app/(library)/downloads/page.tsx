import { api } from 'src/media/api.server'

import { DownloadsContent } from './downloads-content'

export default async function DownloadsPage() {
  const initialData = await api.getAllDownloads()

  return <DownloadsContent initialData={initialData} />
}
