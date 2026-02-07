import { getCounter } from './actions'
import { Counter } from './counter'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const counterValue = await getCounter()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gray-950 text-white">
      <h1 className="text-4xl font-bold">Sync</h1>
      <p className="text-lg text-gray-400">Database Counter</p>
      <Counter initialValue={counterValue} />
    </main>
  )
}
