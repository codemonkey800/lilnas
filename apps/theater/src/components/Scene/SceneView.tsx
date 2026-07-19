'use client'

import dynamic from 'next/dynamic'

const Scene = dynamic(() => import('./Scene').then(mod => mod.Scene), {
  ssr: false,
  loading: () => <p>Loading…</p>,
})

export function SceneView() {
  return <Scene />
}
