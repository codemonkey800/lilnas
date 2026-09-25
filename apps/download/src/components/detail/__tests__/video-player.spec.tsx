import '@testing-library/jest-dom'

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { VideoPlayerProps } from 'src/components/detail/video-player'
import {
  EXIT_FULLSCREEN_LABEL,
  FULLSCREEN_LABEL,
  MUTE_LABEL,
  PAUSE_LABEL,
  PLAY_LABEL,
  SEEK_LABEL,
  UNMUTE_LABEL,
  VIDEO_PLAYER_LABEL,
  VideoPlayer,
} from 'src/components/detail/video-player'
import { SEEK_STEP_SECONDS } from 'src/components/detail/video-player-state'
import { UNKNOWN_VALUE } from 'src/lib/format'

const SRC = 'https://storage.lilnas.io/videos/abc123.mp4'
const POSTER = 'https://storage.lilnas.io/videos/abc123.jpg'
const TITLE = 'Sourdough starter, day one to seven'

/** 14:02, the mockup's duration. */
const DURATION = 842

type FakeMediaState = {
  currentTime: number
  duration: number
  muted: boolean
  paused: boolean
  volume: number
}

const MEDIA_KEYS = [
  'currentTime',
  'duration',
  'muted',
  'paused',
  'volume',
] as const

/**
 * ⚠️ jsdom implements no media playback whatsoever: `duration` is `NaN`
 * forever, `currentTime` never moves, `play()` is a stub that raises a
 * "not implemented" jsdomError, and nothing ever fires a media event. So the
 * element is given real, writable properties per instance (instance-level, so
 * they disappear with the element rather than needing a prototype restore),
 * and the tests fire the events a browser would have fired.
 *
 * This is the seam the logic was split out for: everything *decided* from
 * these values is unit-tested in `video-player-state.spec.ts` against plain
 * objects. What is tested here is only the wiring — that a keypress reaches
 * the element, and that the bar repaints from the element's own events.
 */
function fakeMedia(video: HTMLVideoElement, initial: Partial<FakeMediaState>) {
  const state: FakeMediaState = {
    currentTime: 0,
    duration: DURATION,
    muted: false,
    paused: true,
    volume: 1,
  }

  // Assigned rather than spread: a spread of `{ paused: undefined }` would
  // *overwrite* the default with `undefined`, which is exactly the shape
  // `renderPlayer` hands over for a field the test did not name.
  for (const key of MEDIA_KEYS) {
    const value = initial[key]

    if (value !== undefined) {
      Object.assign(state, { [key]: value })
    }
  }

  for (const key of MEDIA_KEYS) {
    Object.defineProperty(video, key, {
      configurable: true,
      get: () => state[key],
      set: (value: FakeMediaState[typeof key]) => {
        Object.assign(state, { [key]: value })
      },
    })
  }

  const play = jest.fn(() => {
    state.paused = false

    return Promise.resolve()
  })
  const pause = jest.fn(() => {
    state.paused = true
  })

  video.play = play
  video.pause = pause

  return { pause, play, state }
}

type PlayerHarness = {
  frame: HTMLElement
  media: ReturnType<typeof fakeMedia>
  /** Fires the event a browser would have fired, so the bar re-reads. */
  emit: (type: string) => void
  video: HTMLVideoElement
}

function renderPlayer(
  props: Partial<VideoPlayerProps> & Partial<FakeMediaState> = {},
): PlayerHarness {
  const { currentTime, duration, muted, paused, volume, ...playerProps } = props

  const { container } = render(
    <VideoPlayer poster={POSTER} src={SRC} title={TITLE} {...playerProps} />,
  )

  const video = container.querySelector('video')

  if (!video) {
    throw new Error('the player rendered no <video>')
  }

  const media = fakeMedia(video, {
    currentTime,
    duration,
    muted,
    paused,
    volume,
  })

  const emit = (type: string): void => {
    act(() => {
      fireEvent(video, new Event(type))
    })
  }

  // The element now has metadata, exactly as it would after `preload`.
  emit('loadedmetadata')

  return {
    frame: screen.getByRole('region'),
    emit,
    media,
    video,
  }
}

function playButton(): HTMLElement {
  return screen.getByRole('button', { name: PLAY_LABEL })
}

function seekBar(): HTMLInputElement {
  return screen.getByRole('slider', { name: SEEK_LABEL }) as HTMLInputElement
}

/** Installs a fullscreen document property that a real jsdom has no idea about. */
function setFullscreenElement(
  element: Element | null,
  property = 'fullscreenElement',
): void {
  Object.defineProperty(document, property, {
    configurable: true,
    value: element,
  })
}

const DOCUMENT_PATCHES = [
  'fullscreenElement',
  'webkitFullscreenElement',
  'exitFullscreen',
]

afterEach(() => {
  for (const property of DOCUMENT_PATCHES) {
    if (Object.prototype.hasOwnProperty.call(document, property)) {
      Reflect.deleteProperty(document, property)
    }
  }
})

describe('VideoPlayer', () => {
  describe('the frame', () => {
    it('renders a video that does not autoplay and shows the poster first', () => {
      const { video } = renderPlayer()

      expect(video).toHaveAttribute('src', SRC)
      expect(video).toHaveAttribute('poster', POSTER)
      expect(video).toHaveAttribute('preload', 'metadata')
      expect(video).not.toHaveAttribute('autoplay')
      // The browser's own controls are suppressed — the bar below is the UI.
      expect(video).not.toHaveAttribute('controls')
    })

    it('keeps the poster aspect ratio so the page does not reflow', () => {
      const { frame } = renderPlayer()

      expect(frame.getAttribute('class')).toContain('aspect-video')
    })

    it('names the player region after the video', () => {
      renderPlayer()

      expect(
        screen.getByRole('region', {
          name: `${TITLE} — ${VIDEO_PLAYER_LABEL}`,
        }),
      ).toBeInTheDocument()
    })

    it('falls back to a bare name when there is no title', () => {
      renderPlayer({ title: undefined })

      expect(
        screen.getByRole('region', { name: VIDEO_PLAYER_LABEL }),
      ).toBeInTheDocument()
    })

    it('renders without a poster', () => {
      const { video } = renderPlayer({ poster: null })

      expect(video).not.toHaveAttribute('poster')
    })
  })

  describe('accessible names', () => {
    it('gives every control a real one', () => {
      renderPlayer()

      expect(
        screen.getByRole('slider', { name: SEEK_LABEL }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: PLAY_LABEL }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: MUTE_LABEL }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: FULLSCREEN_LABEL }),
      ).toBeInTheDocument()
    })

    it('reaches all four controls with Tab', async () => {
      const user = userEvent.setup()

      renderPlayer()

      const order: (string | null)[] = []

      for (let index = 0; index < 5; index += 1) {
        await user.tab()
        order.push(
          document.activeElement?.getAttribute('aria-label') ??
            document.activeElement?.tagName ??
            null,
        )
      }

      expect(order).toEqual([
        `${TITLE} — ${VIDEO_PLAYER_LABEL}`,
        SEEK_LABEL,
        PLAY_LABEL,
        MUTE_LABEL,
        FULLSCREEN_LABEL,
      ])
    })

    it('marks the two toggles as toggles', () => {
      renderPlayer()

      expect(screen.getByRole('button', { name: MUTE_LABEL })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
      expect(
        screen.getByRole('button', { name: FULLSCREEN_LABEL }),
      ).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('the readout', () => {
    it('renders elapsed over total', () => {
      renderPlayer({ currentTime: 320 })

      expect(screen.getByText('5:20 / 14:02')).toBeInTheDocument()
    })

    it('renders 0:00 at the start rather than the unknown dash', () => {
      renderPlayer()

      expect(screen.getByText('0:00 / 14:02')).toBeInTheDocument()
    })

    it('renders an unknown duration as the dash', () => {
      renderPlayer({ duration: Number.NaN })

      expect(screen.getByText(`0:00 / ${UNKNOWN_VALUE}`)).toBeInTheDocument()
    })

    it('follows the element as it plays', () => {
      const { emit, media } = renderPlayer()

      act(() => {
        media.state.currentTime = 320
      })
      emit('timeupdate')

      expect(screen.getByText('5:20 / 14:02')).toBeInTheDocument()
    })
  })

  describe('transport', () => {
    it('plays when the play button is pressed', async () => {
      const user = userEvent.setup()
      const { media } = renderPlayer()

      await user.click(playButton())

      expect(media.play).toHaveBeenCalledTimes(1)
    })

    it('swaps to the pause control when the element says it is playing', () => {
      const { emit, media } = renderPlayer()

      act(() => {
        media.state.paused = false
      })
      emit('play')

      expect(
        screen.getByRole('button', { name: PAUSE_LABEL }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: PLAY_LABEL }),
      ).not.toBeInTheDocument()
    })

    it('pauses a playing element', async () => {
      const user = userEvent.setup()
      const { emit, media } = renderPlayer({ paused: false })

      emit('play')

      await user.click(screen.getByRole('button', { name: PAUSE_LABEL }))

      expect(media.pause).toHaveBeenCalledTimes(1)
      expect(media.play).not.toHaveBeenCalled()
    })

    it('toggles playback when the picture is clicked', async () => {
      const user = userEvent.setup()
      const { media, video } = renderPlayer()

      await user.click(video)

      expect(media.play).toHaveBeenCalledTimes(1)
    })

    it('mutes and unmutes the element', async () => {
      const user = userEvent.setup()
      const { emit, media } = renderPlayer()

      await user.click(screen.getByRole('button', { name: MUTE_LABEL }))

      expect(media.state.muted).toBe(true)

      emit('volumechange')

      const unmute = screen.getByRole('button', { name: UNMUTE_LABEL })

      expect(unmute).toHaveAttribute('aria-pressed', 'true')

      await user.click(unmute)

      expect(media.state.muted).toBe(false)
    })

    it('follows a mute the user made somewhere else', () => {
      const { emit, media } = renderPlayer()

      act(() => {
        media.state.muted = true
      })
      emit('volumechange')

      expect(
        screen.getByRole('button', { name: UNMUTE_LABEL }),
      ).toBeInTheDocument()
    })
  })

  describe('the seek bar', () => {
    it('is a real range input rather than a div with a mouse handler', () => {
      renderPlayer()

      const slider = seekBar()

      expect(slider.tagName).toBe('INPUT')
      expect(slider).toHaveAttribute('type', 'range')
    })

    it('seeks the element when it changes', () => {
      const { media } = renderPlayer()

      fireEvent.change(seekBar(), { target: { value: '50' } })

      expect(media.state.currentTime).toBe(DURATION / 2)
    })

    it('seeks to the start and to the end', () => {
      const { media } = renderPlayer({ currentTime: 320 })

      fireEvent.change(seekBar(), { target: { value: '0' } })
      expect(media.state.currentTime).toBe(0)

      fireEvent.change(seekBar(), { target: { value: '100' } })
      expect(media.state.currentTime).toBe(DURATION)
    })

    it('reports its position as a time, not a percentage', () => {
      renderPlayer({ currentTime: 320 })

      expect(seekBar()).toHaveAttribute('aria-valuetext', '5:20 of 14:02')
    })

    it('tracks the element as it plays', () => {
      const { emit, media } = renderPlayer()

      expect(seekBar().value).toBe('0')

      act(() => {
        media.state.currentTime = DURATION / 2
      })
      emit('timeupdate')

      expect(seekBar().value).toBe('50')
    })

    it('stays at zero while the duration is unknown', () => {
      renderPlayer({ duration: Number.NaN })

      expect(seekBar().value).toBe('0')
    })
  })

  describe('keyboard shortcuts', () => {
    async function pressOnFrame(
      harness: PlayerHarness,
      keys: string,
    ): Promise<void> {
      const user = userEvent.setup()

      act(() => {
        harness.frame.focus()
      })

      await user.keyboard(keys)
    }

    it('toggles playback on Space', async () => {
      const harness = renderPlayer()

      await pressOnFrame(harness, '[Space]')

      expect(harness.media.play).toHaveBeenCalledTimes(1)
    })

    it('toggles playback on K', async () => {
      const harness = renderPlayer()

      await pressOnFrame(harness, 'k')

      expect(harness.media.play).toHaveBeenCalledTimes(1)
    })

    it('pauses a playing element on Space', async () => {
      const harness = renderPlayer({ paused: false })

      await pressOnFrame(harness, '[Space]')

      expect(harness.media.pause).toHaveBeenCalledTimes(1)
    })

    it('seeks forward on the right arrow', async () => {
      const harness = renderPlayer({ currentTime: 320 })

      await pressOnFrame(harness, '[ArrowRight]')

      expect(harness.media.state.currentTime).toBe(320 + SEEK_STEP_SECONDS)
    })

    it('seeks back on the left arrow', async () => {
      const harness = renderPlayer({ currentTime: 320 })

      await pressOnFrame(harness, '[ArrowLeft]')

      expect(harness.media.state.currentTime).toBe(320 - SEEK_STEP_SECONDS)
    })

    it('never seeks past either end of the file', async () => {
      const harness = renderPlayer({ currentTime: 1 })

      await pressOnFrame(harness, '[ArrowLeft][ArrowLeft]')

      expect(harness.media.state.currentTime).toBe(0)
    })

    it('mutes on M', async () => {
      const harness = renderPlayer()

      await pressOnFrame(harness, 'm')

      expect(harness.media.state.muted).toBe(true)
    })

    it('goes fullscreen on F', async () => {
      const harness = renderPlayer()
      const request = jest.fn()

      harness.frame.requestFullscreen = request

      await pressOnFrame(harness, 'f')

      expect(request).toHaveBeenCalledTimes(1)
    })

    it('works from a focused control, not just from the frame', async () => {
      const user = userEvent.setup()
      const harness = renderPlayer({ currentTime: 320 })

      act(() => {
        playButton().focus()
      })

      await user.keyboard('[ArrowRight]')

      expect(harness.media.state.currentTime).toBe(320 + SEEK_STEP_SECONDS)
    })

    it('leaves Space alone on a button, which already activates on it', async () => {
      const user = userEvent.setup()
      const harness = renderPlayer()

      act(() => {
        playButton().focus()
      })

      await user.keyboard('[Space]')

      // Once, from the button's own activation — not twice.
      expect(harness.media.play).toHaveBeenCalledTimes(1)
    })

    it('leaves a modified press to the browser', async () => {
      const harness = renderPlayer({ currentTime: 320 })

      await pressOnFrame(harness, '{Meta>}[ArrowRight]{/Meta}')

      expect(harness.media.state.currentTime).toBe(320)
    })

    it('ignores a key nothing is bound to', async () => {
      const harness = renderPlayer({ currentTime: 320 })

      await pressOnFrame(harness, 'z')

      expect(harness.media.play).not.toHaveBeenCalled()
      expect(harness.media.state.currentTime).toBe(320)
    })
  })

  describe('fullscreen', () => {
    it('asks the frame to go fullscreen', async () => {
      const user = userEvent.setup()
      const { frame } = renderPlayer()
      const request = jest.fn()

      frame.requestFullscreen = request

      await user.click(screen.getByRole('button', { name: FULLSCREEN_LABEL }))

      expect(request).toHaveBeenCalledTimes(1)
    })

    it('falls back to the video when the engine has no element fullscreen', async () => {
      const user = userEvent.setup()
      const { video } = renderPlayer()
      const enter = jest.fn()

      // iPhone Safari: no requestFullscreen anywhere, only the video's own.
      Object.defineProperty(video, 'webkitEnterFullscreen', {
        configurable: true,
        value: enter,
      })

      await user.click(screen.getByRole('button', { name: FULLSCREEN_LABEL }))

      expect(enter).toHaveBeenCalledTimes(1)
    })

    it('does not claim to be fullscreen just because the button was pressed', async () => {
      const user = userEvent.setup()
      const { frame } = renderPlayer()

      frame.requestFullscreen = jest.fn()

      await user.click(screen.getByRole('button', { name: FULLSCREEN_LABEL }))

      // The request is asynchronous and can be refused. Only the document
      // gets to say whether it happened.
      expect(
        screen.getByRole('button', { name: FULLSCREEN_LABEL }),
      ).toBeInTheDocument()
    })

    it('follows the document into fullscreen', () => {
      const { frame } = renderPlayer()

      act(() => {
        setFullscreenElement(frame)
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      const exit = screen.getByRole('button', { name: EXIT_FULLSCREEN_LABEL })

      expect(exit).toHaveAttribute('aria-pressed', 'true')
    })

    it('follows the document back out when the user presses Escape', () => {
      const { frame } = renderPlayer()

      act(() => {
        setFullscreenElement(frame)
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      expect(
        screen.getByRole('button', { name: EXIT_FULLSCREEN_LABEL }),
      ).toBeInTheDocument()

      // Escape never reaches this component — the browser handles it and
      // tells the document. A local boolean would be stale from here on.
      act(() => {
        setFullscreenElement(null)
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      expect(
        screen.getByRole('button', { name: FULLSCREEN_LABEL }),
      ).toBeInTheDocument()
    })

    it('is not fullscreen when some other element is', () => {
      renderPlayer()

      act(() => {
        setFullscreenElement(document.createElement('div'))
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      expect(
        screen.getByRole('button', { name: FULLSCREEN_LABEL }),
      ).toBeInTheDocument()
    })

    it('reads the webkit spelling of both the property and the event', () => {
      const { frame } = renderPlayer()

      act(() => {
        setFullscreenElement(frame, 'webkitFullscreenElement')
        document.dispatchEvent(new Event('webkitfullscreenchange'))
      })

      expect(
        screen.getByRole('button', { name: EXIT_FULLSCREEN_LABEL }),
      ).toBeInTheDocument()
    })

    it('leaves fullscreen when the control is pressed again', async () => {
      const user = userEvent.setup()
      const { frame } = renderPlayer()
      const exitFullscreen = jest.fn()

      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: exitFullscreen,
      })

      act(() => {
        setFullscreenElement(frame)
        document.dispatchEvent(new Event('fullscreenchange'))
      })

      await user.click(
        screen.getByRole('button', { name: EXIT_FULLSCREEN_LABEL }),
      )

      expect(exitFullscreen).toHaveBeenCalledTimes(1)
    })
  })
})
