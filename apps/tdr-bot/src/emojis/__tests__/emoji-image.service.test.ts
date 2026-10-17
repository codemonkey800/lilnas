import sharp from 'sharp'

import {
  buildFrameSheet,
  emojiGifUrl,
  EmojiImageService,
  emojiPngUrl,
  pickFrames,
} from 'src/emojis/emoji-image.service'

const RED = { r: 255, g: 0, b: 0 }
const GREEN = { r: 0, g: 255, b: 0 }
const BLUE = { r: 0, g: 0, b: 255 }
const YELLOW = { r: 255, g: 255, b: 0 }

type Rgb = typeof RED

/** An animated GIF with one solid-colored 32px frame per color. */
async function animatedGif(colors: Rgb[], delay?: number[]): Promise<Buffer> {
  const frames = await Promise.all(
    colors.map(background =>
      sharp({ create: { width: 32, height: 32, channels: 3, background } })
        .png()
        .toBuffer(),
    ),
  )
  return sharp(frames, { join: { animated: true } })
    .gif({ delay: delay ?? colors.map(() => 100), loop: 0 })
    .toBuffer()
}

async function pixel(image: Buffer, x: number, y: number): Promise<Rgb> {
  const { data, info } = await sharp(image)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * info.channels
  return { r: data[i], g: data[i + 1], b: data[i + 2] }
}

/** JPEG wobbles a little; close enough to the solid color counts. */
function expectColor(actual: Rgb, expected: Rgb): void {
  for (const channel of ['r', 'g', 'b'] as const) {
    expect(Math.abs(actual[channel] - expected[channel])).toBeLessThan(24)
  }
}

describe('emoji CDN URLs', () => {
  it('points at the static PNG and the animated GIF', () => {
    expect(emojiPngUrl('42')).toBe('https://cdn.discordapp.com/emojis/42.png')
    expect(emojiGifUrl('42')).toBe('https://cdn.discordapp.com/emojis/42.gif')
  })
})

describe('pickFrames', () => {
  it('spreads picks evenly over equal-length frames', () => {
    expect(pickFrames([100, 100, 100, 100, 100, 100, 100, 100], 4)).toEqual([
      0, 2, 4, 6,
    ])
  })

  it('samples by play time, so a long hold takes several picks', () => {
    // Frame 1 is on screen from 100ms to 800ms of the 1000ms loop.
    expect(pickFrames([100, 700, 100, 100], 4)).toEqual([0, 1, 1, 1])
  })

  it('plays delays of 10ms or less (and missing ones) at 100ms', () => {
    expect(pickFrames([0, 10, undefined, 100], 4)).toEqual([0, 1, 2, 3])
  })

  it('repeats frames when there are fewer frames than picks', () => {
    expect(pickFrames([100, 100], 4)).toEqual([0, 0, 1, 1])
  })
})

describe('buildFrameSheet', () => {
  it('lays four frames out in a 512px 2x2 JPEG in play order', async () => {
    const gif = await animatedGif([RED, GREEN, BLUE, YELLOW])

    const sheet = await buildFrameSheet(gif)

    const meta = await sharp(sheet).metadata()
    expect(meta).toMatchObject({ format: 'jpeg', width: 512, height: 512 })
    // Cell centers: 8px gap + half of a 244px cell, and one cell + gap on.
    expectColor(await pixel(sheet, 130, 130), RED)
    expectColor(await pixel(sheet, 382, 130), GREEN)
    expectColor(await pixel(sheet, 130, 382), BLUE)
    expectColor(await pixel(sheet, 382, 382), YELLOW)
  })

  it('rejects a single-frame image', async () => {
    const png = await sharp({
      create: { width: 32, height: 32, channels: 3, background: RED },
    })
      .png()
      .toBuffer()

    await expect(buildFrameSheet(png)).rejects.toThrow(/single frame/)
  })

  it('samples frames by play time, not by index', async () => {
    // RED holds for 700ms of 1000ms, so it fills three of the four cells.
    const gif = await animatedGif(
      [GREEN, RED, BLUE, YELLOW],
      [100, 700, 100, 100],
    )

    const sheet = await buildFrameSheet(gif)

    expectColor(await pixel(sheet, 130, 130), GREEN)
    expectColor(await pixel(sheet, 382, 130), RED)
    expectColor(await pixel(sheet, 130, 382), RED)
    expectColor(await pixel(sheet, 382, 382), RED)
  })
})

describe('EmojiImageService', () => {
  const STATIC = { id: '1', name: 'pog', animated: false }
  const ANIMATED = { id: '2', name: 'catJAM', animated: true }
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('uses the still PNG for a static emoji without fetching', async () => {
    const image = await new EmojiImageService().imageFor(STATIC)

    expect(image).toEqual({ url: emojiPngUrl('1'), frames: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends an animated emoji as a JPEG frame sheet data URL', async () => {
    const gif = await animatedGif([RED, GREEN, BLUE, YELLOW])
    fetchSpy.mockResolvedValue(new Response(new Uint8Array(gif)))

    const image = await new EmojiImageService().imageFor(ANIMATED)

    expect(fetchSpy).toHaveBeenCalledWith(
      emojiGifUrl('2'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(image.frames).toBe(true)
    expect(image.url).toMatch(/^data:image\/jpeg;base64,/)
    const sheet = Buffer.from(image.url.split(',')[1], 'base64')
    expect(await sharp(sheet).metadata()).toMatchObject({ width: 512 })
  })

  it('falls back to the still PNG on an HTTP error', async () => {
    fetchSpy.mockResolvedValue(new Response('gone', { status: 404 }))

    await expect(new EmojiImageService().imageFor(ANIMATED)).resolves.toEqual({
      url: emojiPngUrl('2'),
      frames: false,
    })
  })

  it('falls back to the still PNG when the fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('timeout'))

    await expect(new EmojiImageService().imageFor(ANIMATED)).resolves.toEqual({
      url: emojiPngUrl('2'),
      frames: false,
    })
  })

  it('falls back to the still PNG when the GIF has a single frame', async () => {
    const gif = await sharp({
      create: { width: 32, height: 32, channels: 3, background: RED },
    })
      .gif()
      .toBuffer()
    fetchSpy.mockResolvedValue(new Response(new Uint8Array(gif)))

    await expect(new EmojiImageService().imageFor(ANIMATED)).resolves.toEqual({
      url: emojiPngUrl('2'),
      frames: false,
    })
  })
})
