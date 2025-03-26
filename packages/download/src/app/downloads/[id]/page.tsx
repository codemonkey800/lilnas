import { DownloadById } from 'src/components/DownloadById'

export default async function DownloadByIdPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <DownloadById id={id} />
}
