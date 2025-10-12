/**
 * Player Store
 *
 * Manages local player-specific state including stamina management and exhaustion tracking.
 * This store handles mechanics that are specific to the local player's character state,
 * separate from the multiplayer-aware game store.
 *
 * Key Features:
 * - Stamina tracking (0-100 range)
 * - Exhaustion state management
 * - Stamina drain/recovery mechanics
 * - Helper methods for common stamina checks
 *
 * @example
 * ```tsx
 * const { stamina, canRun, drainStamina } = usePlayerStore()
 *
 * if (canRun()) {
 *   drainStamina(STAMINA_DRAIN_RATE * deltaTime)
 * }
 * ```
 */
import { create } from 'zustand'

import { MAX_STAMINA } from 'src/game/constants/gameSettings'

/**
 * Player store state interface
 * Manages local player-specific state like stamina and exhaustion
 */
export interface PlayerState {
  // State
  /** Current stamina level (0-100) */
  stamina: number
  /** Whether the player is exhausted (stamina depleted) */
  isExhausted: boolean

  // Actions
  /** Decrease stamina by delta amount (clamped to 0) */
  drainStamina: (delta: number) => void
  /** Increase stamina by delta amount (clamped to MAX_STAMINA) */
  recoverStamina: (delta: number) => void
  /** Reset stamina to maximum value */
  resetStamina: () => void
  /** Set stamina to a specific value (useful for debugging) */
  setStamina: (value: number) => void

  // Computed/Helper methods
  /** Get current stamina as a percentage (0-100) */
  getStaminaPercent: () => number
  /** Check if player can run (has stamina and not exhausted) */
  canRun: () => boolean
  /** Check if stamina is below threshold (default: 30) */
  isLowStamina: (threshold?: number) => boolean
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  stamina: MAX_STAMINA,
  isExhausted: false,

  drainStamina: (delta: number) =>
    set(state => {
      const newStamina = Math.max(0, state.stamina - delta)
      return {
        stamina: newStamina,
        isExhausted: newStamina === 0,
      }
    }),

  recoverStamina: (delta: number) =>
    set(state => {
      const newStamina = Math.min(MAX_STAMINA, state.stamina + delta)
      return {
        stamina: newStamina,
        isExhausted: newStamina === 0,
      }
    }),

  resetStamina: () =>
    set({
      stamina: MAX_STAMINA,
      isExhausted: false,
    }),

  setStamina: (value: number) =>
    set(() => {
      const clampedValue = Math.max(0, Math.min(MAX_STAMINA, value))
      return {
        stamina: clampedValue,
        isExhausted: clampedValue === 0,
      }
    }),

  // Computed/Helper methods
  getStaminaPercent: () => {
    return get().stamina
  },

  canRun: () => {
    const state = get()
    return state.stamina > 0 && !state.isExhausted
  },

  isLowStamina: (threshold: number = 30) => {
    return get().stamina < threshold
  },
}))
