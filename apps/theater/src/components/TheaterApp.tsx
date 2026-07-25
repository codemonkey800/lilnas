'use client'

import { useCallback, useState } from 'react'

import { CharacterSelect } from './CharacterSelect/CharacterSelect'
import { Landing } from './Landing'
import { SceneView } from './Scene/SceneView'
import { SessionProvider, useSession } from './SessionContext'

function TheaterAppContent() {
  const { status, logout } = useSession()
  const [characterId, setCharacterId] = useState<string | null>(null)

  // Clears the selection as part of the logout action itself, so a same-tab
  // logout-then-login-again doesn't skip straight past character select.
  const handleLogout = useCallback(() => {
    setCharacterId(null)
    void logout()
  }, [logout])

  if (status === 'loading') {
    return (
      <div className="flex flex-auto items-center justify-center">
        <p className="text-white/60">Loading…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Landing />
  }

  if (!characterId) {
    return <CharacterSelect onSelect={setCharacterId} onLogout={handleLogout} />
  }

  return <SceneView characterId={characterId} />
}

export function TheaterApp() {
  return (
    <SessionProvider>
      <TheaterAppContent />
    </SessionProvider>
  )
}
