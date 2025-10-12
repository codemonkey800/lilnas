import { create } from 'zustand'

import type {
  GameStateEnum,
  PlayerInfo,
  Vector3Like,
} from 'src/game/types/game.types'

interface GameStore {
  // Core game state
  gameState: GameStateEnum
  setGameState: (state: GameStateEnum) => void

  // World state
  cabinLocation: Vector3Like
  setCabinLocation: (position: Vector3Like) => void

  monsterPosition: Vector3Like | null
  setMonsterPosition: (position: Vector3Like | null) => void

  // Multiplayer state (up to 8 players)
  players: Record<string, PlayerInfo>
  localPlayerId: string
  updatePlayer: (playerId: string, updates: Partial<PlayerInfo>) => void
  removePlayer: (playerId: string) => void

  // Win condition check
  checkWinCondition: () => boolean
}

export const useGameStore = create<GameStore>((set, get) => ({
  // Initial game state
  gameState: 'playing',
  setGameState: (gameState: GameStateEnum) => set({ gameState }),

  // Initial world state - cabin at origin (placeholder)
  cabinLocation: { x: 0, y: 0, z: 0 },
  setCabinLocation: (position: Vector3Like) => set({ cabinLocation: position }),

  monsterPosition: null,
  setMonsterPosition: (position: Vector3Like | null) =>
    set({ monsterPosition: position }),

  // Initial player state - single local player
  players: {
    local: {
      id: 'local',
      name: 'Player',
      position: { x: 0, y: 1.7, z: 0 },
      isAlive: true,
      isAtCabin: false,
      isFlashlightOn: true,
      movementState: 'idle',
    },
  },
  localPlayerId: 'local',

  updatePlayer: (playerId: string, updates: Partial<PlayerInfo>) =>
    set(state => ({
      players: {
        ...state.players,
        [playerId]: {
          ...state.players[playerId],
          ...updates,
        },
      },
    })),

  removePlayer: (playerId: string) =>
    set(state => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [playerId]: _, ...remainingPlayers } = state.players
      return { players: remainingPlayers }
    }),

  checkWinCondition: () => {
    const { players } = get()
    const alivePlayers = Object.values(players).filter(p => p.isAlive)

    // Win if all alive players have reached the cabin
    return alivePlayers.length > 0 && alivePlayers.every(p => p.isAtCabin)
  },
}))
