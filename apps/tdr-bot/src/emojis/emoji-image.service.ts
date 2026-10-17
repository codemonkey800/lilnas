import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'

import {
  EMOJI_FRAME_COUNT,
  EMOJI_IMAGE_FETCH_TIMEOUT_MS,
} from 'src/emojis/emoji.constants'

/** 2x2 grid of cells; 512px square matches what low detail downscales to. */
const CELL = 244
const GAP = 8
const SHEET_SIZE = CELL * 2 + GAP * 3
const BACKGROUND = '#ffffff'
const GUTTER = '#b8b8b8'

export interface EmojiImage {
  url: string
  /** True when `url` is a frame sheet, false for a single still frame. */
  frames: boolean
}

/** Static PNG on Discord's CDN; a still frame for animated emojis. */
export function emojiPngUrl(id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.png`
}

/** The animated original on Discord's CDN. */
export function emojiGifUrl(id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.gif`
}

/** Browsers play GIF delays of 10ms or less at 100ms; match that. */
function playDelay(ms: number | undefined): number {
  return ms === undefined || ms <= 10 ? 100 : ms
}

/**
 * Indices of the frames on screen at 0, 1/count, 2/count, ... of one loop.
 * Sampling by play time, not frame index, so a long hold counts for what it is.
 */
export function pickFrames(
  delays: (number | undefined)[],
  count: number,
): number[] {
  const durations = delays.map(playDelay)
  const total = durations.reduce((sum, d) => sum + d, 0)
  return Array.from({ length: count }, (_, k) => {
    const target = (total * k) / count
    let elapsed = 0
    let i = 0
    while (i < durations.length - 1 && elapsed + durations[i] <= target) {
      elapsed += durations[i++]
    }
    return i
  })
}

/**
 * Lays EMOJI_FRAME_COUNT evenly spaced frames of an animated GIF out in a
 * 2x2 grid, in play order left to right, top to bottom. Returns a JPEG.
 * Throws when the image has a single frame.
 */
export async function buildFrameSheet(image: Buffer): Promise<Buffer> {
  const { pages = 1, delay = [] } = await sharp(image).metadata()
  if (pages < 2) throw new Error('Emoji image has a single frame')

  const delays = Array.from({ length: pages }, (_, i) => delay[i])
  const cells = await Promise.all(
    pickFrames(delays, EMOJI_FRAME_COUNT).map(page =>
      sharp(image, { page })
        .resize(CELL, CELL, { fit: 'contain', background: BACKGROUND })
        .flatten({ background: BACKGROUND })
        .png()
        .toBuffer(),
    ),
  )

  return sharp({
    create: {
      width: SHEET_SIZE,
      height: SHEET_SIZE,
      channels: 3,
      background: GUTTER,
    },
  })
    .composite(
      cells.map((input, i) => ({
        input,
        left: GAP + (i % 2) * (CELL + GAP),
        top: GAP + Math.floor(i / 2) * (CELL + GAP),
      })),
    )
    .jpeg({ quality: 85 })
    .toBuffer()
}

/** Picks the picture the describer sends for an emoji. */
@Injectable()
export class EmojiImageService {
  private readonly logger = new Logger(EmojiImageService.name)

  /**
   * A frame sheet (as a data URL) for animated emojis, so the model sees the
   * motion; the still PNG URL for static ones, or when the sheet can't be
   * built. Never throws.
   */
  async imageFor(emoji: {
    id: string
    name: string
    animated: boolean
  }): Promise<EmojiImage> {
    const still = { url: emojiPngUrl(emoji.id), frames: false }
    if (!emoji.animated) return still

    try {
      const res = await fetch(emojiGifUrl(emoji.id), {
        signal: AbortSignal.timeout(EMOJI_IMAGE_FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sheet = await buildFrameSheet(Buffer.from(await res.arrayBuffer()))
      return {
        url: `data:image/jpeg;base64,${sheet.toString('base64')}`,
        frames: true,
      }
    } catch (err) {
      this.logger.warn(
        { emojiId: emoji.id, name: emoji.name, error: getErrorMessage(err) },
        'Could not build emoji frame sheet; using the still frame',
      )
      return still
    }
  }
}
