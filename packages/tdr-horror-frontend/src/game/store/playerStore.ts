import { create } from 'zustand'

interface PlayerState {
  stamina: number
  isExhausted: boolean
  drainStamina: (delta: number) => void
  recoverStamina: (delta: number) => void
  resetStamina: () => void
}

const MAX_STAMINA = 100

export const usePlayerStore = create<PlayerState>(set => ({
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
}))
