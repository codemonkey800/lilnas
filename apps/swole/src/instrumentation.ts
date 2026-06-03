// Next.js auto-discovers `register` from src/instrumentation.ts and bundles
// it for both the Node.js and Edge runtimes. The boot body lives in
// ./instrumentation-node so better-sqlite3 + `process.exit`/`process.once`
// never enter the Edge bundle's static-analysis graph — a top-level runtime
// guard prevents execution but does not strip the AST.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { bootNode } = await import('./instrumentation-node')
  await bootNode()
}
