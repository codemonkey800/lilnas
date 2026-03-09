import { api } from 'src/media/api.server'

import { StorageContent } from './storage-content'

export default async function StoragePage() {
  const data = await api.getStorageOverview()

  return <StorageContent data={data} />
}
