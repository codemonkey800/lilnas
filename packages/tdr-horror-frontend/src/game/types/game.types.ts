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
