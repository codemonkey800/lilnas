// Input related types
export interface MouseDelta {
  x: number
  y: number
}

export interface MovementInput {
  forward: boolean
  backward: boolean
  left: boolean
  right: boolean
  jump: boolean
  run: boolean
  crouch: boolean
}

// Player state types
export interface PlayerState {
  stamina: number
  isExhausted: boolean
}

// Tree collision types
export interface TreePosition {
  x: number
  z: number
  scaleHeight: number
  scaleWidth: number
}

// Game store types
export type GameStateEnum = 'menu' | 'playing' | 'paused' | 'gameover'

export type MovementStateEnum =
  | 'idle'
  | 'walking'
  | 'running'
  | 'crouching'
  | 'hiding'

export interface Vector3Like {
  x: number
  y: number
  z: number
}

export interface PlayerInfo {
  id: string
  name: string
  position: Vector3Like
  isAlive: boolean
  isAtCabin: boolean
  isFlashlightOn: boolean
  movementState: MovementStateEnum
}

// Audio system types
export type SoundCategory = 'ambient' | 'player' | 'ui' | 'monster'

export interface AudioSettings {
  masterVolume: number
  categoryVolumes: Record<SoundCategory, number>
  isMuted: boolean
}

export interface PlaySoundOptions {
  volume?: number
  loop?: boolean
  position?: Vector3Like
  refDistance?: number
  maxDistance?: number
}
