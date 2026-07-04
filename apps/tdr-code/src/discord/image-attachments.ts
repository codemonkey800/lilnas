import type { ImageAttachment } from 'src/agent/agent.types'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

// Non-DI (plain exported functions, no class) — uses getBackendLogger()
// (src/logging/backend-logger.ts), fetched AT LOG TIME inside each function
// body, never at module-eval time.

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
      getBackendLogger().debug(
        { attachmentName: att.name, contentType: att.contentType },
        'Ignoring non-image attachment',
      )
    }
  }

  const kept = imageAttachments.slice(0, MAX_IMAGES_PER_MESSAGE)
  const dropped = imageAttachments.length - kept.length
  if (dropped > 0) {
    getBackendLogger().debug(
      { dropped, maxImagesPerMessage: MAX_IMAGES_PER_MESSAGE },
      'Dropping image attachment(s) over the per-message cap',
    )
  }

  const results: ImageAttachment[] = []
  for (const att of kept) {
    if (att.size > MAX_IMAGE_BYTES) {
      getBackendLogger().warn(
        {
          event: LOG_EVENTS.imageAttachmentDropped,
          reason: 'size_over_cap',
          attachmentName: att.name,
          size: att.size,
          maxBytes: MAX_IMAGE_BYTES,
        },
        'Skipping image attachment: declared size exceeds cap',
      )
      continue
    }
    try {
      const res = await fetch(att.url)
      if (!res.ok) {
        getBackendLogger().warn(
          {
            event: LOG_EVENTS.imageAttachmentDropped,
            reason: 'fetch_not_ok',
            attachmentName: att.name,
            status: res.status,
            statusText: res.statusText,
          },
          'Failed to fetch image attachment',
        )
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        getBackendLogger().warn(
          {
            event: LOG_EVENTS.imageAttachmentDropped,
            reason: 'fetched_size_over_cap',
            attachmentName: att.name,
            fetchedBytes: buf.byteLength,
            maxBytes: MAX_IMAGE_BYTES,
          },
          'Skipping image attachment: fetched size exceeds cap',
        )
        continue
      }
      results.push({ data: buf.toString('base64'), mimeType: att.contentType! })
    } catch (err) {
      // Low-risk error: att.url is a Discord CDN URL (attachment metadata,
      // not user-typed text), so a fetch/network failure here cannot embed
      // secret material the way the crypto-parse path (identity-
      // resolution.ts's C1 fix) can — { err } is safe.
      getBackendLogger().warn(
        {
          event: LOG_EVENTS.imageAttachmentDropped,
          reason: 'fetch_error',
          attachmentName: att.name,
          err,
        },
        'Error fetching image attachment',
      )
    }
  }

  return results
}
