/**
 * Audio Store
 *
 * Manages audio settings including volume controls for master and individual
 * sound categories. Settings are persisted to localStorage for consistency
 * across sessions.
 *
 * Key Features:
 * - Master volume control
 * - Per-category volume controls (ambient, player, ui, monster)
 * - Mute toggle
 * - Settings persistence via localStorage
 *
 * @example
 * ```tsx
 * const { masterVolume, setMasterVolume, isMuted, toggleMute } = useAudioStore()
 *
 * // Set master volume to 50%
 * setMasterVolume(0.5)
 *
 * // Toggle mute
 * toggleMute()
 * ```
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_AMBIENT_VOLUME,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_MONSTER_VOLUME,
  DEFAULT_PLAYER_VOLUME,
  DEFAULT_UI_VOLUME,
} from 'src/game/constants/gameSettings'
import type { SoundCategory } from 'src/game/types/game.types'

/**
 * Audio store state interface
 * Manages audio settings and volume controls
 */
export interface AudioState {
  // State
  /** Master volume (0-1), affects all sounds */
  masterVolume: number
  /** Volume for each sound category (0-1) */
  categoryVolumes: Record<SoundCategory, number>
  /** Whether all audio is muted */
  isMuted: boolean

  // Actions
  /** Set master volume (0-1) */
  setMasterVolume: (volume: number) => void
  /** Set volume for a specific category (0-1) */
  setCategoryVolume: (category: SoundCategory, volume: number) => void
  /** Toggle mute on/off */
  toggleMute: () => void
  /** Set mute state explicitly */
  setMuted: (muted: boolean) => void
  /** Reset all volumes to defaults */
  resetToDefaults: () => void

  // Computed/Helper methods
  /** Get effective volume for a category (master * category * !muted) */
  getEffectiveVolume: (category: SoundCategory) => number
}

const defaultCategoryVolumes: Record<SoundCategory, number> = {
  ambient: DEFAULT_AMBIENT_VOLUME,
  player: DEFAULT_PLAYER_VOLUME,
  ui: DEFAULT_UI_VOLUME,
  monster: DEFAULT_MONSTER_VOLUME,
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set, get) => ({
      masterVolume: DEFAULT_MASTER_VOLUME,
      categoryVolumes: defaultCategoryVolumes,
      isMuted: false,

      setMasterVolume: (volume: number) =>
        set({
          masterVolume: Math.max(0, Math.min(1, volume)),
        }),

      setCategoryVolume: (category: SoundCategory, volume: number) =>
        set(state => ({
          categoryVolumes: {
            ...state.categoryVolumes,
            [category]: Math.max(0, Math.min(1, volume)),
          },
        })),

      toggleMute: () =>
        set(state => ({
          isMuted: !state.isMuted,
        })),

      setMuted: (muted: boolean) =>
        set({
          isMuted: muted,
        }),

      resetToDefaults: () =>
        set({
          masterVolume: DEFAULT_MASTER_VOLUME,
          categoryVolumes: defaultCategoryVolumes,
          isMuted: false,
        }),

      // Computed/Helper methods
      getEffectiveVolume: (category: SoundCategory) => {
        const state = get()
        if (state.isMuted) return 0
        return state.masterVolume * state.categoryVolumes[category]
      },
    }),
    {
      name: 'tdr-horror-audio-settings',
      version: 1,
    },
  ),
)
