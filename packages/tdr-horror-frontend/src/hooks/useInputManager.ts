import { useEffect, useMemo } from 'react'

import { InputManager } from 'src/game/controllers/InputManager'

/**
 * React hook for managing InputManager lifecycle
 * Returns the singleton InputManager instance and handles initialization/cleanup
 */
export function useInputManager() {
  // Get singleton instance immediately (not in useEffect)
  const inputManager = useMemo(() => InputManager.getInstance(), [])

  useEffect(() => {
    // Initialize event listeners
    inputManager.init()

    // Cleanup on unmount
    return () => {
      inputManager.dispose()
    }
  }, [inputManager])

  return inputManager
}
