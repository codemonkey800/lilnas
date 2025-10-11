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
