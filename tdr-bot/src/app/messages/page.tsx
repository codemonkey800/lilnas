import dynamic from 'next/dynamic'

const DynamicMessagesWithNoSSR = dynamic(
  () => import('src/components/Messages/Messages').then((mod) => mod.Messages),
  { ssr: false },
)

export default function MessagesPage() {
  return <DynamicMessagesWithNoSSR />
}
