import {
  extractImages,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
} from '../image-attachments'

const makeAtt = (
  overrides: Partial<{
    contentType: string | null
    size: number
    url: string
    name: string
  }> = {},
) => ({
  contentType: 'image/png',
  size: 100,
  url: 'https://cdn.discord.com/image.png',
  name: 'image.png',
  ...overrides,
})

// Slice to the exact bytes so the Buffer pool doesn't bleed extra bytes.
function bufToAb(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function mockFetch(buf: Buffer, ok = true): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? 'OK' : 'Not Found',
    arrayBuffer: async () => bufToAb(buf),
  } as unknown as Response)
}

afterEach(() => jest.restoreAllMocks())

describe('extractImages', () => {
  it('returns one ImageAttachment for a valid image attachment', async () => {
    const bytes = Buffer.from('fake-png-data')
    mockFetch(bytes)

    const result = await extractImages([makeAtt()])

    expect(result).toHaveLength(1)
    expect(result[0].mimeType).toBe('image/png')
    expect(result[0].data).toBe(bytes.toString('base64'))
  })

  it('round-trips base64 correctly', async () => {
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    mockFetch(original)

    const [img] = await extractImages([makeAtt()])

    expect(Buffer.from(img.data, 'base64')).toEqual(original)
  })

  it('skips text/plain attachments without calling fetch', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as Response)
    const result = await extractImages([makeAtt({ contentType: 'text/plain' })])
    expect(result).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips application/pdf attachments', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as Response)
    const result = await extractImages([makeAtt({ contentType: 'application/pdf' })])
    expect(result).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips attachments with null contentType', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as Response)
    const result = await extractImages([makeAtt({ contentType: null })])
    expect(result).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips attachment whose size exceeds cap before fetching', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as Response)

    const result = await extractImages([makeAtt({ size: MAX_IMAGE_BYTES + 1 })])

    expect(result).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips attachment whose fetched byteLength exceeds cap', async () => {
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1)
    mockFetch(oversized)

    const result = await extractImages([makeAtt({ size: 100 })])

    expect(result).toHaveLength(0)
  })

  it('skips on fetch !ok (404) and continues processing other attachments', async () => {
    const goodBytes = Buffer.from('good')
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: async () => new ArrayBuffer(0),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => bufToAb(goodBytes),
      } as unknown as Response)

    const result = await extractImages([
      makeAtt({ name: 'bad.png', url: 'https://example.com/bad' }),
      makeAtt({ name: 'good.png', url: 'https://example.com/good' }),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].data).toBe(goodBytes.toString('base64'))
  })

  it('skips on fetch throwing and continues processing other attachments', async () => {
    const goodBytes = Buffer.from('ok')
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => bufToAb(goodBytes),
      } as unknown as Response)

    const result = await extractImages([
      makeAtt({ name: 'fail.png' }),
      makeAtt({ name: 'ok.png' }),
    ])

    expect(result).toHaveLength(1)
  })

  it('returns empty array for no attachments', async () => {
    const result = await extractImages([])
    expect(result).toHaveLength(0)
  })

  it('returns both images for two valid attachments, order preserved', async () => {
    const bytes1 = Buffer.from('one')
    const bytes2 = Buffer.from('two')
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => bufToAb(bytes1),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => bufToAb(bytes2),
      } as unknown as Response)

    const result = await extractImages([
      makeAtt({ name: 'a.png' }),
      makeAtt({ name: 'b.png' }),
    ])

    expect(result).toHaveLength(2)
    expect(result[0].data).toBe(bytes1.toString('base64'))
    expect(result[1].data).toBe(bytes2.toString('base64'))
  })

  it('returns [] when only image is oversized and other is text/plain (AE4)', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as Response)

    const result = await extractImages([
      makeAtt({ name: 'big.png', size: MAX_IMAGE_BYTES + 1 }),
      makeAtt({ name: 'doc.txt', contentType: 'text/plain' }),
    ])

    expect(result).toHaveLength(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it(`returns only the first ${MAX_IMAGES_PER_MESSAGE} images when more are provided`, async () => {
    const count = MAX_IMAGES_PER_MESSAGE + 2
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => bufToAb(Buffer.from('x')),
      } as unknown as Response)

    const atts = Array.from({ length: count }, (_, i) =>
      makeAtt({ name: `img${i}.png` }),
    )
    const result = await extractImages(atts)

    expect(result).toHaveLength(MAX_IMAGES_PER_MESSAGE)
    expect(fetchSpy).toHaveBeenCalledTimes(MAX_IMAGES_PER_MESSAGE)
  })
})
