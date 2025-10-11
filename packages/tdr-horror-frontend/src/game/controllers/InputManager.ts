import { INPUT_KEYS } from 'src/game/constants/gameSettings'
import type { MouseDelta, MovementInput } from 'src/game/types/game.types'

/**
 * InputManager - Singleton class for handling all keyboard and mouse input
 * Manages input state, pointer lock, and provides a clean API for querying inputs
 */
export class InputManager {
  private static instance: InputManager | null = null

  // Input state
  private pressedKeys: Set<string> = new Set()
  private mouseDelta: MouseDelta = { x: 0, y: 0 }
  private isInitialized = false

  // Bound event handlers for proper cleanup
  private boundHandleKeyDown: (event: KeyboardEvent) => void
  private boundHandleKeyUp: (event: KeyboardEvent) => void
  private boundHandleMouseMove: (event: MouseEvent) => void
  private boundHandlePointerLockChange: () => void
  private boundHandleBlur: () => void

  private constructor() {
    // Bind event handlers
    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
    this.boundHandleKeyUp = this.handleKeyUp.bind(this)
    this.boundHandleMouseMove = this.handleMouseMove.bind(this)
    this.boundHandlePointerLockChange = this.handlePointerLockChange.bind(this)
    this.boundHandleBlur = this.handleBlur.bind(this)
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager()
    }
    return InputManager.instance
  }

  /**
   * Initialize event listeners
   */
  public init(): void {
    if (this.isInitialized) {
      return
    }

    // Keyboard events
    window.addEventListener('keydown', this.boundHandleKeyDown)
    window.addEventListener('keyup', this.boundHandleKeyUp)

    // Mouse events
    document.addEventListener('mousemove', this.boundHandleMouseMove)

    // Pointer lock events
    document.addEventListener(
      'pointerlockchange',
      this.boundHandlePointerLockChange,
    )

    // Window focus events
    window.addEventListener('blur', this.boundHandleBlur)

    this.isInitialized = true
  }

  /**
   * Clean up event listeners
   */
  public dispose(): void {
    if (!this.isInitialized) {
      return
    }

    window.removeEventListener('keydown', this.boundHandleKeyDown)
    window.removeEventListener('keyup', this.boundHandleKeyUp)
    document.removeEventListener('mousemove', this.boundHandleMouseMove)
    document.removeEventListener(
      'pointerlockchange',
      this.boundHandlePointerLockChange,
    )
    window.removeEventListener('blur', this.boundHandleBlur)

    this.resetState()
    this.isInitialized = false
  }

  /**
   * Handle keydown events
   */
  private handleKeyDown(event: KeyboardEvent): void {
    // Prevent default for game keys to avoid browser shortcuts
    if (
      event.key === INPUT_KEYS.PAUSE ||
      event.key === INPUT_KEYS.INVENTORY ||
      event.key === INPUT_KEYS.JUMP
    ) {
      event.preventDefault()
    }

    this.pressedKeys.add(event.key.toLowerCase())
  }

  /**
   * Handle keyup events
   */
  private handleKeyUp(event: KeyboardEvent): void {
    this.pressedKeys.delete(event.key.toLowerCase())
  }

  /**
   * Handle mouse move events
   */
  private handleMouseMove(event: MouseEvent): void {
    // Only track mouse movement when pointer is locked
    if (this.isPointerLocked()) {
      this.mouseDelta.x += event.movementX
      this.mouseDelta.y += event.movementY
    }
  }

  /**
   * Handle pointer lock change events
   */
  private handlePointerLockChange(): void {
    // Reset mouse delta when pointer lock changes
    this.mouseDelta.x = 0
    this.mouseDelta.y = 0
  }

  /**
   * Handle window blur (focus loss)
   */
  private handleBlur(): void {
    // Reset all input state to prevent stuck keys
    this.resetState()
  }

  /**
   * Check if a specific key is currently pressed
   */
  public isKeyPressed(key: string): boolean {
    return this.pressedKeys.has(key.toLowerCase())
  }

  /**
   * Check if any movement key is pressed
   */
  public isMovementKeyPressed(): boolean {
    return (
      this.isKeyPressed(INPUT_KEYS.MOVE_FORWARD) ||
      this.isKeyPressed(INPUT_KEYS.MOVE_BACKWARD) ||
      this.isKeyPressed(INPUT_KEYS.MOVE_LEFT) ||
      this.isKeyPressed(INPUT_KEYS.MOVE_RIGHT)
    )
  }

  /**
   * Get current movement input state
   */
  public getMovementInput(): MovementInput {
    return {
      forward: this.isKeyPressed(INPUT_KEYS.MOVE_FORWARD),
      backward: this.isKeyPressed(INPUT_KEYS.MOVE_BACKWARD),
      left: this.isKeyPressed(INPUT_KEYS.MOVE_LEFT),
      right: this.isKeyPressed(INPUT_KEYS.MOVE_RIGHT),
      jump: this.isKeyPressed(INPUT_KEYS.JUMP),
      run: this.isKeyPressed(INPUT_KEYS.RUN),
      crouch: this.isKeyPressed(INPUT_KEYS.CROUCH),
    }
  }

  /**
   * Get mouse delta since last reset
   */
  public getMouseDelta(): MouseDelta {
    return { ...this.mouseDelta }
  }

  /**
   * Reset mouse delta (should be called each frame after processing)
   */
  public resetMouseDelta(): void {
    this.mouseDelta.x = 0
    this.mouseDelta.y = 0
  }

  /**
   * Request pointer lock on the given element
   */
  public requestPointerLock(element: HTMLElement): void {
    if (!element) {
      return
    }

    element.requestPointerLock()
  }

  /**
   * Exit pointer lock
   */
  public exitPointerLock(): void {
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }
  }

  /**
   * Check if pointer is currently locked
   */
  public isPointerLocked(): boolean {
    return document.pointerLockElement !== null
  }

  /**
   * Reset all input state
   */
  public resetState(): void {
    this.pressedKeys.clear()
    this.mouseDelta.x = 0
    this.mouseDelta.y = 0
  }

  /**
   * Get all currently pressed keys (for debugging)
   */
  public getPressedKeys(): string[] {
    return Array.from(this.pressedKeys)
  }
}
