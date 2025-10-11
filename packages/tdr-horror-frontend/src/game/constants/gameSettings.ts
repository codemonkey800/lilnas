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
