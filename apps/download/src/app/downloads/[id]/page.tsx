import { DownloadById } from 'src/components/DownloadById'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'

export default async function DownloadByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const client = await getIdentifiedDownloadClient()
  const initialJob = await client.getJob(id)

  return <DownloadById initialJob={initialJob} />
}
