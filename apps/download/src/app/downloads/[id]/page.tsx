import { DownloadClient } from '@lilnas/utils/download/client'

import { DownloadById } from 'src/components/DownloadById'

export default async function DownloadByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const initialJob = await DownloadClient.localInstance.getVideoJob(id)

  return <DownloadById initialJob={initialJob} />
}
