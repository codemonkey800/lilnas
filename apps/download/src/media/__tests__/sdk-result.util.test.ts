import {
  checkSdkError,
  isAlreadyAddedError,
  SdkHttpError,
  type SdkResult,
  unwrapSdkResult,
} from 'src/media/sdk-result.util'

function responseWith(status: number): Response {
  return new Response(null, { status })
}

// Catches what `fn` throws, so a test can assert on more than the message.
function thrownBy(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
}

describe('SdkHttpError', () => {
  it('is an Error subclass that survives instanceof', () => {
    const error = new SdkHttpError('boom', 404, { message: 'nope' })

    expect(error).toBeInstanceOf(SdkHttpError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('SdkHttpError')
    expect(error.message).toBe('boom')
    expect(error.status).toBe(404)
    expect(error.body).toEqual({ message: 'nope' })
  })
})

describe('checkSdkError', () => {
  it('no-ops when the result carries no error', () => {
    expect(() =>
      checkSdkError({ data: 1, response: responseWith(200) }, 'Get movie'),
    ).not.toThrow()
  })

  it.each([
    [404, { message: 'NotFound' }],
    [409, { message: 'Conflict' }],
    [500, 'Internal Server Error'],
  ])('carries HTTP %i and the error body', (status, body) => {
    const error = thrownBy(() =>
      checkSdkError({ error: body, response: responseWith(status) }, 'Delete'),
    )

    expect(error).toBeInstanceOf(SdkHttpError)
    expect(error).toMatchObject({ body, status })
  })

  it('leaves status undefined when there was no response', () => {
    const body = new Error('fetch failed')
    const error = thrownBy(() => checkSdkError({ error: body }, 'Delete'))

    expect(error).toBeInstanceOf(SdkHttpError)
    expect(error).toMatchObject({ body, status: undefined })
  })

  // Other code and tests match on these strings, so they must not drift.
  it.each<[string, unknown, string]>([
    [
      'an Error',
      new Error('fetch failed'),
      'Delete movie failed: fetch failed',
    ],
    [
      'a JSON body',
      { message: 'NotFound' },
      'Delete movie failed: {"message":"NotFound"}',
    ],
    ['a string body', 'nope', 'Delete movie failed: "nope"'],
  ])('keeps the message unchanged for %s', (_label, body, message) => {
    expect(() =>
      checkSdkError(
        { error: body, response: responseWith(500) },
        'Delete movie',
      ),
    ).toThrow(message)
  })

  it('falls back to String() for a body JSON cannot serialise', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() => checkSdkError({ error: circular }, 'Delete movie')).toThrow(
      'Delete movie failed: [object Object]',
    )
  })
})

describe('unwrapSdkResult', () => {
  it('returns the data when the call succeeded', () => {
    expect(
      unwrapSdkResult({ data: [1, 2], response: responseWith(200) }, 'List'),
    ).toEqual([1, 2])
  })

  it.each([404, 409, 500])('carries HTTP %i from the error branch', status => {
    const result: SdkResult<number> = {
      error: { message: 'bad' },
      response: responseWith(status),
    }
    const error = thrownBy(() => unwrapSdkResult(result, 'Get movie'))

    expect(error).toBeInstanceOf(SdkHttpError)
    expect(error).toMatchObject({
      body: { message: 'bad' },
      message: 'Get movie failed: {"message":"bad"}',
      status,
    })
  })

  it('throws an SdkHttpError with the unchanged message when data is missing', () => {
    const error = thrownBy(() =>
      unwrapSdkResult({ response: responseWith(200) }, 'Get movie'),
    )

    expect(error).toBeInstanceOf(SdkHttpError)
    expect(error).toMatchObject({
      body: undefined,
      message: 'Get movie returned no data',
      status: 200,
    })
  })

  it('leaves status undefined when there was no response', () => {
    const error = thrownBy(() =>
      unwrapSdkResult({ error: new Error('fetch failed') }, 'Get movie'),
    )

    expect(error).toBeInstanceOf(SdkHttpError)
    expect(error).toMatchObject({
      message: 'Get movie failed: fetch failed',
      status: undefined,
    })
  })
})

describe('isAlreadyAddedError', () => {
  it('matches the 400 an add gets for a title already in the library', () => {
    const error = new SdkHttpError('addMovie failed: ...', 400, [
      {
        errorCode: 'MovieExistsValidator',
        errorMessage: 'This movie has already been added',
        propertyName: 'TmdbId',
      },
    ])

    expect(isAlreadyAddedError(error)).toBe(true)
  })

  it('matches on the message when the body carries no text', () => {
    const error = new SdkHttpError(
      'addSeries failed: This series has already been added',
      400,
      undefined,
    )

    expect(isAlreadyAddedError(error)).toBe(true)
  })

  it('ignores any other 400', () => {
    const error = new SdkHttpError('addMovie failed', 400, [
      { errorMessage: 'Root folder does not exist' },
    ])

    expect(isAlreadyAddedError(error)).toBe(false)
  })

  it('ignores the same text on a non-400 status', () => {
    const error = new SdkHttpError(
      'addMovie failed: This movie has already been added',
      500,
      undefined,
    )

    expect(isAlreadyAddedError(error)).toBe(false)
  })

  it('ignores anything that is not an SdkHttpError', () => {
    expect(
      isAlreadyAddedError(new Error('This movie has already been added')),
    ).toBe(false)
    expect(isAlreadyAddedError('already been added')).toBe(false)
  })
})
