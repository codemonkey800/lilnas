/**
 * useAudioSystem Hook
 *
 * React hook that provides access to the AudioSystem singleton.
 * Follows the same pattern as useInputManager for consistency.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const audioSystem = useAudioSystem()
 *
 *   useEffect(() => {
 *     if (audioSystem?.isInitialized()) {
 *       audioSystem.play('menu_click')
 *     }
 *   }, [audioSystem])
 *
 *   return <div>...</div>
 * }
 * ```
 */
import { useMemo } from 'react'

import { AudioSystem } from 'src/game/systems/AudioSystem'

/**
 * Hook to access the AudioSystem singleton
 * Returns the same instance across all components
 */
export function useAudioSystem(): AudioSystem {
  return useMemo(() => AudioSystem.getInstance(), [])
}
