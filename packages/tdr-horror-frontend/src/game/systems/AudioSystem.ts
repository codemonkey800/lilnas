/**
 * Audio System
 *
 * Singleton class that manages all audio in the game using Three.js audio capabilities.
 * Supports both 2D audio (UI, ambient) and 3D spatial audio (footsteps, monster sounds).
 *
 * Features:
 * - AudioListener attached to camera for first-person perspective
 * - Audio caching to avoid reloading
 * - Volume management per category
 * - Spatial audio with distance-based attenuation
 * - Graceful handling of missing audio files
 *
 * @example
 * ```tsx
 * const audioSystem = AudioSystem.getInstance()
 * audioSystem.init(camera)
 *
 * // Load audio files
 * await audioSystem.loadSound('footstep', 'player', '/sounds/player/footstep_walk.mp3', true)
 *
 * // Play with spatial positioning
 * audioSystem.play('footstep', { position: { x: 0, y: 0, z: 5 } })
 * ```
 */
import * as THREE from 'three'

import {
  AUDIO_MAX_DISTANCE,
  AUDIO_REFERENCE_DISTANCE,
  AUDIO_ROLLOFF_FACTOR,
} from 'src/game/constants/gameSettings'
import { useAudioStore } from 'src/game/store/audioStore'
import type {
  PlaySoundOptions,
  SoundCategory,
  Vector3Like,
} from 'src/game/types/game.types'

interface SoundMetadata {
  category: SoundCategory
  is3D: boolean
  buffer: AudioBuffer | null
}

export class AudioSystem {
  private static instance: AudioSystem | null = null

  private audioListener: THREE.AudioListener | null = null
  private audioLoader: THREE.AudioLoader
  private audioCache: Map<string, SoundMetadata> = new Map()
  private activeSounds: Map<
    string,
    THREE.Audio<GainNode> | THREE.PositionalAudio
  > = new Map()
  private initialized: boolean = false

  private constructor() {
    this.audioLoader = new THREE.AudioLoader()
  }

  /**
   * Get the singleton instance of AudioSystem
   */
  static getInstance(): AudioSystem {
    if (!AudioSystem.instance) {
      AudioSystem.instance = new AudioSystem()
    }
    return AudioSystem.instance
  }

  /**
   * Initialize the audio system with a camera
   * This attaches an AudioListener to the camera for first-person audio perspective
   *
   * @param camera - The Three.js camera to attach the AudioListener to
   */
  init(camera: THREE.Camera): void {
    if (this.initialized) {
      console.warn('AudioSystem already initialized')
      return
    }

    this.audioListener = new THREE.AudioListener()
    camera.add(this.audioListener)
    this.initialized = true

    console.log('AudioSystem initialized')
  }

  /**
   * Check if the audio system is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Load an audio file and cache it
   *
   * @param name - Unique identifier for this sound
   * @param category - Sound category (ambient, player, ui, monster)
   * @param url - Path to the audio file (relative to public/)
   * @param is3D - Whether this sound should use spatial audio (PositionalAudio)
   * @returns Promise that resolves when audio is loaded
   */
  async loadSound(
    name: string,
    category: SoundCategory,
    url: string,
    is3D: boolean = false,
  ): Promise<void> {
    if (!this.initialized || !this.audioListener) {
      console.error('AudioSystem not initialized. Call init() first.')
      return
    }

    // Check if already cached
    if (this.audioCache.has(name)) {
      console.warn(`Sound "${name}" already loaded`)
      return
    }

    return new Promise((resolve, reject) => {
      this.audioLoader.load(
        url,
        buffer => {
          this.audioCache.set(name, {
            category,
            is3D,
            buffer,
          })
          console.log(`Loaded sound: ${name} (${category}, 3D: ${is3D})`)
          resolve()
        },
        undefined,
        error => {
          console.error(`Failed to load sound "${name}" from ${url}:`, error)
          // Cache with null buffer so we don't try to load again
          this.audioCache.set(name, {
            category,
            is3D,
            buffer: null,
          })
          reject(error)
        },
      )
    })
  }

  /**
   * Play a sound with optional parameters
   *
   * @param name - Name of the sound to play (must be loaded first)
   * @param options - Play options (volume, loop, position, etc.)
   * @returns The Audio or PositionalAudio instance, or null if failed
   */
  play(
    name: string,
    options: PlaySoundOptions = {},
  ): THREE.Audio<GainNode> | THREE.PositionalAudio | null {
    if (!this.initialized || !this.audioListener) {
      console.error('AudioSystem not initialized')
      return null
    }

    const metadata = this.audioCache.get(name)
    if (!metadata) {
      console.warn(`Sound "${name}" not loaded. Call loadSound() first.`)
      return null
    }

    if (!metadata.buffer) {
      console.warn(`Sound "${name}" failed to load previously`)
      return null
    }

    // Get effective volume from store
    const effectiveVolume = useAudioStore
      .getState()
      .getEffectiveVolume(metadata.category)
    const finalVolume = (options.volume ?? 1.0) * effectiveVolume

    // Create audio instance
    let audio: THREE.Audio<GainNode> | THREE.PositionalAudio

    if (metadata.is3D && options.position) {
      const positionalAudio = new THREE.PositionalAudio(this.audioListener)
      positionalAudio.setRefDistance(
        options.refDistance ?? AUDIO_REFERENCE_DISTANCE,
      )
      positionalAudio.setMaxDistance(options.maxDistance ?? AUDIO_MAX_DISTANCE)
      positionalAudio.setRolloffFactor(AUDIO_ROLLOFF_FACTOR)

      // Set position
      positionalAudio.position.set(
        options.position.x,
        options.position.y,
        options.position.z,
      )
      audio = positionalAudio
    } else {
      audio = new THREE.Audio<GainNode>(this.audioListener)
    }

    audio.setBuffer(metadata.buffer)
    audio.setLoop(options.loop ?? false)
    audio.setVolume(finalVolume)
    audio.play()

    // Track active sound
    const soundId = `${name}_${Date.now()}`
    this.activeSounds.set(soundId, audio)

    // Remove from active sounds when finished (if not looping)
    if (!options.loop) {
      audio.onEnded = () => {
        this.activeSounds.delete(soundId)
      }
    }

    return audio
  }

  /**
   * Stop a specific sound by name
   * Stops all instances of this sound that are currently playing
   *
   * @param name - Name of the sound to stop
   */
  stop(name: string): void {
    for (const [soundId, audio] of this.activeSounds.entries()) {
      if (soundId.startsWith(name)) {
        audio.stop()
        this.activeSounds.delete(soundId)
      }
    }
  }

  /**
   * Stop all currently playing sounds
   */
  stopAll(): void {
    for (const [soundId, audio] of this.activeSounds.entries()) {
      audio.stop()
      this.activeSounds.delete(soundId)
    }
  }

  /**
   * Pause a specific sound by name
   *
   * @param name - Name of the sound to pause
   */
  pause(name: string): void {
    for (const [soundId, audio] of this.activeSounds.entries()) {
      if (soundId.startsWith(name)) {
        audio.pause()
      }
    }
  }

  /**
   * Update volume of all active sounds based on current store settings
   * Call this when volume settings change
   */
  updateVolumes(): void {
    for (const [soundId, audio] of this.activeSounds.entries()) {
      const soundName = soundId.split('_')[0]
      const metadata = this.audioCache.get(soundName)

      if (metadata) {
        const effectiveVolume = useAudioStore
          .getState()
          .getEffectiveVolume(metadata.category)
        audio.setVolume(effectiveVolume)
      }
    }
  }

  /**
   * Helper method: Play footstep sound
   *
   * @param position - Position of the footstep in 3D space
   * @param isRunning - Whether the player is running (affects sound choice)
   */
  playFootstep(position: Vector3Like, isRunning: boolean = false): void {
    const soundName = isRunning ? 'footstep_run' : 'footstep_walk'
    this.play(soundName, {
      position,
      volume: isRunning ? 0.8 : 0.6,
    })
  }

  /**
   * Helper method: Play breathing sound based on stamina intensity
   *
   * @param intensity - Breathing intensity (0-1), where 1 is heavy breathing
   */
  playBreathing(intensity: number = 0.5): void {
    const soundName = intensity > 0.7 ? 'breathing_heavy' : 'breathing_normal'
    this.play(soundName, {
      volume: 0.5 + intensity * 0.5,
      loop: true,
    })
  }

  /**
   * Helper method: Stop breathing sounds
   */
  stopBreathing(): void {
    this.stop('breathing_heavy')
    this.stop('breathing_normal')
  }

  /**
   * Get debug info about the audio system
   */
  getDebugInfo(): {
    initialized: boolean
    cachedSounds: number
    activeSounds: number
    soundList: string[]
  } {
    return {
      initialized: this.initialized,
      cachedSounds: this.audioCache.size,
      activeSounds: this.activeSounds.size,
      soundList: Array.from(this.audioCache.keys()),
    }
  }

  /**
   * Clean up resources (call when unmounting)
   */
  dispose(): void {
    this.stopAll()
    this.audioCache.clear()
    this.initialized = false
    this.audioListener = null
    console.log('AudioSystem disposed')
  }
}
