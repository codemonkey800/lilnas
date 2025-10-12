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

// Audio volume settings
export const DEFAULT_MASTER_VOLUME = 0.7
export const DEFAULT_AMBIENT_VOLUME = 0.5
export const DEFAULT_PLAYER_VOLUME = 0.8
export const DEFAULT_UI_VOLUME = 1.0
export const DEFAULT_MONSTER_VOLUME = 0.9

// Spatial audio settings
export const AUDIO_REFERENCE_DISTANCE = 1 // Distance at which volume is at full
export const AUDIO_MAX_DISTANCE = 50 // Distance at which sound is inaudible
export const AUDIO_ROLLOFF_FACTOR = 1 // How quickly sound fades with distance

// Footstep timing
export const FOOTSTEP_WALK_INTERVAL = 0.5 // Seconds between steps when walking
export const FOOTSTEP_RUN_INTERVAL = 0.3 // Seconds between steps when running
