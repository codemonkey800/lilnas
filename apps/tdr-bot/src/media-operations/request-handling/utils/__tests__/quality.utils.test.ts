import { QualityTier } from '@lilnas/utils/download/types'

import { toQualityTier } from 'src/media-operations/request-handling/utils/quality.utils'
import {
  MediaRequestSchema,
  MediaRequestType,
  SearchIntent,
} from 'src/schemas/graph'
import { GET_MEDIA_TYPE_PROMPT } from 'src/utils/prompts'

/** Parse what the media-type prompt answered and map its quality to a tier. */
function tierFromResponse(quality: unknown): QualityTier | undefined {
  const parsed = MediaRequestSchema.parse({
    mediaType: MediaRequestType.Movies,
    searchIntent: SearchIntent.External,
    searchTerms: 'Dune',
    ...(quality === undefined ? {} : { quality }),
  })
  return toQualityTier(parsed.quality)
}

describe('toQualityTier', () => {
  it.each([
    ['4k', QualityTier.UpTo4k],
    ['1080p', QualityTier.Hd],
    ['720p', QualityTier.UpTo720p],
  ] as const)('maps %s to %s', (quality, tier) => {
    expect(toQualityTier(quality)).toBe(tier)
  })

  it.each([null, undefined])('leaves the tier off for %s', quality => {
    expect(toQualityTier(quality)).toBeUndefined()
  })
})

describe('MediaRequestSchema quality', () => {
  // What the prompt is taught to answer for each message
  it.each([
    ['in 4k', '4k', QualityTier.UpTo4k],
    ['4K UHD', '4K', QualityTier.UpTo4k],
    ['720p please', '720p', QualityTier.UpTo720p],
    ['1080p', '1080p', QualityTier.Hd],
  ])('"%s" (answered %p) maps to %s', (_message, quality, tier) => {
    expect(tierFromResponse(quality)).toBe(tier)
  })

  it('forgives stray whitespace around a quality', () => {
    expect(tierFromResponse(' 1080P ')).toBe(QualityTier.Hd)
  })

  it('leaves the tier off when no quality was named', () => {
    expect(tierFromResponse(undefined)).toBeUndefined()
    expect(tierFromResponse(null)).toBeUndefined()
  })

  it.each(['8k', 'ultra', '', 1080, { value: '4k' }, ['4k']])(
    'degrades an invalid quality (%p) to none instead of throwing',
    quality => {
      const parsed = MediaRequestSchema.parse({
        mediaType: MediaRequestType.Shows,
        searchIntent: SearchIntent.External,
        searchTerms: 'The Office',
        quality,
      })

      expect(parsed).toEqual({
        mediaType: MediaRequestType.Shows,
        searchIntent: SearchIntent.External,
        searchTerms: 'The Office',
        quality: null,
      })
      expect(toQualityTier(parsed.quality)).toBeUndefined()
    },
  )

  it('still rejects a response missing the fields routing needs', () => {
    expect(() => MediaRequestSchema.parse({ quality: '4k' })).toThrow()
  })
})

describe('GET_MEDIA_TYPE_PROMPT', () => {
  it('asks for a quality of 4k, 1080p, 720p or null', () => {
    const prompt = String(GET_MEDIA_TYPE_PROMPT.content)

    expect(prompt).toContain('"quality": "4k" | "1080p" | "720p" | null')
  })
})
