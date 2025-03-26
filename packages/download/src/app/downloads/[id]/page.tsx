import { DownloadClient } from '@lilnas/utils/download/client'

import { DownloadById } from 'src/components/DownloadById'

export default async function DownloadByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  async function getVideoJob() {
    'use server'

    const client = DownloadClient.localInstance
    return client.getVideoJob(id)
  }

  const initialJob = await getVideoJob()

  return <DownloadById initialJob={initialJob} getVideoJob={getVideoJob} />
}
