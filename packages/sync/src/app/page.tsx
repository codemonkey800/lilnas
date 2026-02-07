import { getCounter } from './actions'
import { Counter } from './counter'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const counterValue = await getCounter()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 animate-fade-in">
      <h1 className="text-4xl font-bold tracking-tight">Sync</h1>
      <p className="text-lg text-text-secondary">Database Counter</p>
      <Counter initialValue={counterValue} />
    </main>
  )
}
