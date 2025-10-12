// Key mappings for game controls
export const INPUT_KEYS = {
  MOVE_FORWARD: 'w',
  MOVE_BACKWARD: 's',
  MOVE_LEFT: 'a',
  MOVE_RIGHT: 'd',
  RUN: 'Shift',
  JUMP: ' ', // Space key
  CROUCH: 'Control',
  PAUSE: 'Escape',
  INVENTORY: 'Tab',
} as const

// Mouse and input settings
export const MOUSE_SENSITIVITY = 0.002 // Radians per pixel
export const POINTER_LOCK_ENABLED = true

// Movement settings
export const WALK_SPEED = 5 // Units per second
export const RUN_SPEED = 8 // Units per second
export const PLAYER_HEIGHT = 1.7 // Eye level above ground

// Stamina settings
export const MAX_STAMINA = 100
export const STAMINA_DRAIN_RATE = 20 // Per second when running
export const STAMINA_RECOVERY_RATE = 10 // Per second when not running

// Head bob settings
export const HEAD_BOB_AMPLITUDE = 0.06 // Vertical oscillation amount
export const HEAD_BOB_FREQUENCY = 10 // Oscillations per second when walking
