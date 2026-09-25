import {
  ELAPSED_ZERO,
  enterFullscreen,
  formatDuration,
  formatElapsed,
  formatTimecode,
  fullscreenElement,
  isFullscreen,
  leaveFullscreen,
  MEDIA_SNAPSHOT_INITIAL,
  PCT_MAX,
  playedPct,
  playerIntentForKey,
  readMediaSnapshot,
  sameMediaSnapshot,
  SEEK_STEP_SECONDS,
  seekBy,
  seekTimeFromPct,
  seekValueText,
  shortcutOrigin,
} from 'src/components/detail/video-player-state'
import { UNKNOWN_VALUE } from 'src/lib/format'

describe('formatElapsed', () => {
  it('renders 0:00 at the start of a file rather than an em dash', () => {
    // The whole reason this exists: formatRuntime(0, 'clock') is UNKNOWN_VALUE,
    // which is right for an unknown runtime and wrong for a loaded player.
    expect(formatElapsed(0)).toBe(ELAPSED_ZERO)
    expect(formatElapsed(0)).not.toBe(UNKNOWN_VALUE)
  })

  it('renders 0:00 for a sub-second position', () => {
    expect(formatElapsed(0.4)).toBe(ELAPSED_ZERO)
  })

  it('floors rather than rounds, so it never shows a second early', () => {
    expect(formatElapsed(30.9)).toBe('0:30')
  })

  it('renders minutes and seconds', () => {
    expect(formatElapsed(320)).toBe('5:20')
  })

  it('grows an hours field', () => {
    expect(formatElapsed(3723)).toBe('1:02:03')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['a negative time', -12],
  ])('renders 0:00 for %s', (_label, value) => {
    expect(formatElapsed(value)).toBe(ELAPSED_ZERO)
  })
})

describe('formatDuration', () => {
  it('renders the clock duration', () => {
    expect(formatDuration(842)).toBe('14:02')
  })

  it.each([
    ['NaN, before metadata loads', Number.NaN],
    ['Infinity, for a stream', Number.POSITIVE_INFINITY],
    ['zero, for a file the browser cannot measure', 0],
    ['null', null],
    ['undefined', undefined],
  ])('renders the em dash for %s', (_label, value) => {
    expect(formatDuration(value)).toBe(UNKNOWN_VALUE)
  })
})

describe('formatTimecode', () => {
  it('renders the mockup readout', () => {
    expect(formatTimecode(320, 842)).toBe('5:20 / 14:02')
  })

  it('shows a real elapsed against an unknown duration', () => {
    expect(formatTimecode(0, Number.NaN)).toBe(
      `${ELAPSED_ZERO} / ${UNKNOWN_VALUE}`,
    )
  })
})

describe('seekValueText', () => {
  it('spells the position out for a screen reader instead of a percentage', () => {
    expect(seekValueText(320, 842)).toBe('5:20 of 14:02')
  })
})

describe('readMediaSnapshot', () => {
  it('returns the shared initial snapshot for no element', () => {
    expect(readMediaSnapshot(null)).toBe(MEDIA_SNAPSHOT_INITIAL)
    expect(readMediaSnapshot(undefined)).toBe(MEDIA_SNAPSHOT_INITIAL)
  })

  it('reads the element', () => {
    expect(
      readMediaSnapshot({
        currentTime: 320,
        duration: 842,
        muted: true,
        paused: false,
        volume: 0.5,
      }),
    ).toEqual({
      currentTime: 320,
      duration: 842,
      muted: true,
      paused: false,
      volume: 0.5,
    })
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('collapses a %s duration to zero', (_label, duration) => {
    const snapshot = readMediaSnapshot({
      currentTime: 0,
      duration,
      muted: false,
      paused: true,
      volume: 1,
    })

    // NaN !== NaN, so leaving it through would make every snapshot compare
    // unequal to the last and re-render the bar on every timeupdate.
    expect(snapshot.duration).toBe(0)
  })
})

describe('sameMediaSnapshot', () => {
  it('is true for two reads that changed nothing', () => {
    expect(
      sameMediaSnapshot(MEDIA_SNAPSHOT_INITIAL, { ...MEDIA_SNAPSHOT_INITIAL }),
    ).toBe(true)
  })

  it.each([
    ['currentTime', { currentTime: 1 }],
    ['duration', { duration: 1 }],
    ['muted', { muted: true }],
    ['paused', { paused: false }],
    ['volume', { volume: 0.2 }],
  ])('is false when %s moved', (_label, change) => {
    expect(
      sameMediaSnapshot(MEDIA_SNAPSHOT_INITIAL, {
        ...MEDIA_SNAPSHOT_INITIAL,
        ...change,
      }),
    ).toBe(false)
  })
})

describe('playedPct', () => {
  it('is the fraction played, as a percentage', () => {
    expect(playedPct({ currentTime: 320, duration: 842 })).toBeCloseTo(38, 0)
  })

  it.each([
    ['an unknown duration', { currentTime: 10, duration: 0 }],
    ['a NaN duration', { currentTime: 10, duration: Number.NaN }],
    ['a NaN position', { currentTime: Number.NaN, duration: 842 }],
  ])('is zero for %s', (_label, snapshot) => {
    expect(playedPct(snapshot)).toBe(0)
  })

  it('clamps a position past the end', () => {
    expect(playedPct({ currentTime: 900, duration: 842 })).toBe(PCT_MAX)
  })
})

describe('seekTimeFromPct', () => {
  it('turns a slider value back into a time', () => {
    expect(seekTimeFromPct(50, 842)).toBe(421)
  })

  it('round-trips against playedPct', () => {
    expect(
      seekTimeFromPct(playedPct({ currentTime: 320, duration: 842 }), 842),
    ).toBeCloseTo(320, 6)
  })

  it('clamps out-of-range values', () => {
    expect(seekTimeFromPct(140, 842)).toBe(842)
    expect(seekTimeFromPct(-20, 842)).toBe(0)
  })

  it.each([
    ['an unknown duration', 50, 0],
    ['a NaN duration', 50, Number.NaN],
    ['a NaN value', Number.NaN, 842],
  ])('is zero for %s', (_label, pct, duration) => {
    expect(seekTimeFromPct(pct, duration)).toBe(0)
  })
})

describe('seekBy', () => {
  it('moves forward', () => {
    expect(seekBy(320, SEEK_STEP_SECONDS, 842)).toBe(325)
  })

  it('moves back', () => {
    expect(seekBy(320, -SEEK_STEP_SECONDS, 842)).toBe(315)
  })

  it('never seeks past the end', () => {
    expect(seekBy(840, SEEK_STEP_SECONDS, 842)).toBe(842)
  })

  it('never seeks before the start', () => {
    // Assigning a negative currentTime throws in a real browser.
    expect(seekBy(2, -SEEK_STEP_SECONDS, 842)).toBe(0)
  })

  it('still clamps at zero when the duration is unknown', () => {
    expect(seekBy(2, -SEEK_STEP_SECONDS, Number.NaN)).toBe(0)
    expect(seekBy(2, SEEK_STEP_SECONDS, Number.NaN)).toBe(7)
  })

  it('treats a NaN position as the start', () => {
    expect(seekBy(Number.NaN, SEEK_STEP_SECONDS, 842)).toBe(5)
  })
})

describe('shortcutOrigin', () => {
  it('recognises the seek bar', () => {
    expect(shortcutOrigin({ tagName: 'INPUT', type: 'range' })).toBe('range')
  })

  it('recognises a transport button', () => {
    expect(shortcutOrigin({ tagName: 'BUTTON', type: 'button' })).toBe('button')
  })

  it('treats the frame itself as the surface', () => {
    expect(shortcutOrigin({ tagName: 'DIV' })).toBe('surface')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a non-object', 'window'],
  ])('treats %s as the surface', (_label, target) => {
    expect(shortcutOrigin(target)).toBe('surface')
  })
})

describe('playerIntentForKey', () => {
  it.each([[' '], ['Spacebar'], ['k'], ['K']])(
    'toggles playback on %s',
    key => {
      expect(playerIntentForKey({ key }, 'surface')).toEqual({
        kind: 'toggle-play',
      })
    },
  )

  it.each([[' '], ['Spacebar']])(
    'leaves %s alone on a button, which activates on it already',
    key => {
      expect(playerIntentForKey({ key }, 'button')).toBeNull()
    },
  )

  it('still takes K on a button', () => {
    expect(playerIntentForKey({ key: 'k' }, 'button')).toEqual({
      kind: 'toggle-play',
    })
  })

  it.each([['ArrowRight'], ['ArrowUp']])('seeks forward on %s', key => {
    expect(playerIntentForKey({ key }, 'surface')).toEqual({
      kind: 'seek-by',
      seconds: SEEK_STEP_SECONDS,
    })
  })

  it.each([['ArrowLeft'], ['ArrowDown']])('seeks back on %s', key => {
    expect(playerIntentForKey({ key }, 'surface')).toEqual({
      kind: 'seek-by',
      seconds: -SEEK_STEP_SECONDS,
    })
  })

  it('seeks the same distance from the slider as from the frame', () => {
    expect(playerIntentForKey({ key: 'ArrowRight' }, 'range')).toEqual(
      playerIntentForKey({ key: 'ArrowRight' }, 'surface'),
    )
  })

  it.each([['m'], ['M']])('mutes on %s', key => {
    expect(playerIntentForKey({ key }, 'surface')).toEqual({
      kind: 'toggle-mute',
    })
  })

  it.each([['f'], ['F']])('goes fullscreen on %s', key => {
    expect(playerIntentForKey({ key }, 'surface')).toEqual({
      kind: 'toggle-fullscreen',
    })
  })

  it.each([['Home'], ['End'], ['PageUp'], ['PageDown'], ['Enter'], ['Tab']])(
    'leaves %s to the browser',
    key => {
      expect(playerIntentForKey({ key }, 'range')).toBeNull()
      expect(playerIntentForKey({ key }, 'surface')).toBeNull()
    },
  )

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['alt', { altKey: true }],
  ])('leaves a %s-modified press to the browser', (_label, modifier) => {
    expect(
      playerIntentForKey({ key: 'ArrowRight', ...modifier }, 'surface'),
    ).toBeNull()
    expect(playerIntentForKey({ key: ' ', ...modifier }, 'surface')).toBeNull()
  })
})

describe('fullscreenElement', () => {
  const element = { id: 'player' }

  it.each([
    ['fullscreenElement'],
    ['webkitFullscreenElement'],
    ['mozFullScreenElement'],
    ['msFullscreenElement'],
  ])('reads %s', property => {
    expect(fullscreenElement({ [property]: element })).toBe(element)
  })

  it('is null when nothing is fullscreen', () => {
    expect(fullscreenElement({ fullscreenElement: null })).toBeNull()
    expect(fullscreenElement({})).toBeNull()
  })
})

describe('isFullscreen', () => {
  const element = { id: 'player' }

  it('is true only for the element the document names', () => {
    expect(isFullscreen({ fullscreenElement: element }, element)).toBe(true)
    expect(isFullscreen({ fullscreenElement: element }, { id: 'other' })).toBe(
      false,
    )
    expect(isFullscreen({ fullscreenElement: null }, element)).toBe(false)
  })

  it('is false for an element that has not mounted', () => {
    // Otherwise a document reporting nothing fullscreen and a ref holding
    // nothing would compare null === null and claim fullscreen.
    expect(isFullscreen({ fullscreenElement: null }, null)).toBe(false)
  })
})

describe('enterFullscreen', () => {
  it.each([
    ['requestFullscreen'],
    ['webkitRequestFullscreen'],
    ['mozRequestFullScreen'],
    ['msRequestFullscreen'],
    ['webkitEnterFullscreen'],
  ])('calls %s when it is the only spelling available', method => {
    const request = jest.fn()

    expect(enterFullscreen({ [method]: request })).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('prefers the unprefixed spelling', () => {
    const request = jest.fn()
    const webkit = jest.fn()

    enterFullscreen({
      requestFullscreen: request,
      webkitRequestFullscreen: webkit,
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(webkit).not.toHaveBeenCalled()
  })

  it('invokes the method on its element', () => {
    const element = {
      requestFullscreen(this: unknown) {
        expect(this).toBe(element)

        return undefined
      },
    }

    expect(enterFullscreen(element)).toBe(true)
  })

  it('reports that no spelling existed, so the caller can fall back', () => {
    expect(enterFullscreen({})).toBe(false)
  })

  it('swallows a refused request rather than leaving it unhandled', async () => {
    expect(
      enterFullscreen({
        requestFullscreen: () => Promise.reject(new Error('gesture required')),
      }),
    ).toBe(true)

    await Promise.resolve()
  })
})

describe('leaveFullscreen', () => {
  it.each([
    ['exitFullscreen'],
    ['webkitExitFullscreen'],
    ['mozCancelFullScreen'],
    ['msExitFullscreen'],
  ])('calls %s when it is the only spelling available', method => {
    const exit = jest.fn()

    expect(leaveFullscreen({ [method]: exit })).toBe(true)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('reports that no spelling existed', () => {
    expect(leaveFullscreen({})).toBe(false)
  })
})
