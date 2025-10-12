import { folder, useControls } from 'leva'

export interface DebugControls {
  // Player Settings
  walkSpeed: number
  runSpeed: number
  staminaDrainRate: number
  staminaRecoveryRate: number

  // Environment
  fogDensity: number
  ambientLightIntensity: number
  flashlightIntensity: number
  flashlightDistance: number
  mouseSensitivity: number

  // Debug
  showCollisionBoxes: boolean
  showStats: boolean
  godMode: boolean
}

/**
 * Custom hook for debug controls using Leva
 * Provides real-time tweaking of game parameters for development
 */
export function useDebugControls(): DebugControls {
  return useControls({
    'Player Settings': folder({
      walkSpeed: {
        value: 5,
        min: 1,
        max: 20,
        step: 0.5,
        label: 'Walk Speed',
      },
      runSpeed: {
        value: 8,
        min: 5,
        max: 30,
        step: 0.5,
        label: 'Run Speed',
      },
      staminaDrainRate: {
        value: 20,
        min: 5,
        max: 50,
        step: 1,
        label: 'Stamina Drain Rate',
      },
      staminaRecoveryRate: {
        value: 10,
        min: 5,
        max: 30,
        step: 1,
        label: 'Stamina Recovery Rate',
      },
    }),
    Environment: folder({
      fogDensity: {
        value: 0.008,
        min: 0,
        max: 0.05,
        step: 0.001,
        label: 'Fog Density',
      },
      ambientLightIntensity: {
        value: 0.15,
        min: 0,
        max: 1,
        step: 0.05,
        label: 'Ambient Light',
      },
      flashlightIntensity: {
        value: 25,
        min: 0,
        max: 100,
        step: 1,
        label: 'Flashlight Intensity',
      },
      flashlightDistance: {
        value: 80,
        min: 10,
        max: 200,
        step: 5,
        label: 'Flashlight Distance',
      },
      mouseSensitivity: {
        value: 0.002,
        min: 0.0001,
        max: 0.01,
        step: 0.0001,
        label: 'Mouse Sensitivity',
      },
    }),
    Debug: folder({
      showCollisionBoxes: {
        value: false,
        label: 'Show Collision Boxes',
      },
      showStats: {
        value: true,
        label: 'Show FPS Stats',
      },
      godMode: {
        value: false,
        label: 'God Mode',
      },
    }),
  }) as DebugControls
}
