export async function register() {
  // Production only: the dev portal shares the host's Docker socket and would
  // otherwise run a second watcher against the same container.
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NODE_ENV === 'production'
  ) {
    const { startBrowserIdleWatcher } = await import('src/utils/browser')
    startBrowserIdleWatcher()
  }
}
