import type { ImageAttachment } from 'src/agent/agent.types'

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
      console.log(
        `Ignoring non-image attachment ${att.name} (contentType=${att.contentType})`,
      )
    }
  }

  const kept = imageAttachments.slice(0, MAX_IMAGES_PER_MESSAGE)
  const dropped = imageAttachments.length - kept.length
  if (dropped > 0) {
    console.log(
      `Dropping ${dropped} image attachment(s) over the per-message cap`,
    )
  }

  const results: ImageAttachment[] = []
  for (const att of kept) {
    if (att.size > MAX_IMAGE_BYTES) {
      console.warn(
        `Skipping image attachment ${att.name}: ${att.size} bytes exceeds ${MAX_IMAGE_BYTES}`,
      )
      continue
    }
    try {
      const res = await fetch(att.url)
      if (!res.ok) {
        console.warn(
          `Failed to fetch image ${att.name}: ${res.status} ${res.statusText}`,
        )
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        console.warn(
          `Skipping image ${att.name}: fetched ${buf.byteLength} bytes exceeds ${MAX_IMAGE_BYTES}`,
        )
        continue
      }
      results.push({ data: buf.toString('base64'), mimeType: att.contentType! })
    } catch (err) {
      console.warn(`Error fetching image ${att.name}:`, err)
    }
  }

  return results
}
