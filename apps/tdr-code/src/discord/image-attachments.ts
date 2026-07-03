import { Logger } from '@nestjs/common'

import type { ImageAttachment } from 'src/agent/agent.types'

// Non-DI (plain exported functions, no class) — see acp-client.ts's header
// comment for why this Logger's calls are one interpolated string rather
// than PinoLogger's object-first API.
const logger = new Logger('ImageAttachments')

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGES_PER_MESSAGE = 4

interface AttachmentLike {
  contentType: string | null
  size: number
  url: string
  name: string
}

export async function extractImages(
  attachments: Iterable<AttachmentLike>,
): Promise<ImageAttachment[]> {
  const imageAttachments: AttachmentLike[] = []
  for (const att of attachments) {
    if (att.contentType?.startsWith('image/')) {
      imageAttachments.push(att)
    } else {
      logger.debug(
        `Ignoring non-image attachment ${att.name} (contentType=${att.contentType})`,
      )
    }
  }

  const kept = imageAttachments.slice(0, MAX_IMAGES_PER_MESSAGE)
  const dropped = imageAttachments.length - kept.length
  if (dropped > 0) {
    logger.debug(
      `Dropping ${dropped} image attachment(s) over the per-message cap`,
    )
  }

  const results: ImageAttachment[] = []
  for (const att of kept) {
    if (att.size > MAX_IMAGE_BYTES) {
      logger.warn(
        `Skipping image attachment ${att.name}: ${att.size} bytes exceeds ${MAX_IMAGE_BYTES}`,
      )
      continue
    }
    try {
      const res = await fetch(att.url)
      if (!res.ok) {
        logger.warn(
          `Failed to fetch image ${att.name}: ${res.status} ${res.statusText}`,
        )
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        logger.warn(
          `Skipping image ${att.name}: fetched ${buf.byteLength} bytes exceeds ${MAX_IMAGE_BYTES}`,
        )
        continue
      }
      results.push({ data: buf.toString('base64'), mimeType: att.contentType! })
    } catch (err) {
      logger.warn(
        `Error fetching image ${att.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return results
}
