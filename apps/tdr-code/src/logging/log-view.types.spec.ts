import { parseLogLine } from 'src/logging/log-view.types'

describe('parseLogLine', () => {
  it('parses a well-formed pino line', () => {
    expect(parseLogLine('{"level":30,"time":1,"msg":"x"}')).toEqual({
      level: 30,
      time: 1,
      msg: 'x',
    })
  })

  it.each(['', '   '])('returns null for blank input %j', raw => {
    expect(parseLogLine(raw)).toBeNull()
  })

  it('returns null for a truncated/half-written line without throwing', () => {
    expect(() => parseLogLine('{"level":30, "msg":')).not.toThrow()
    expect(parseLogLine('{"level":30, "msg":')).toBeNull()
  })

  it('parses a debug-level line with no event field, and never invents one', () => {
    const parsed = parseLogLine('{"level":20,"time":1,"msg":"tick"}')
    expect(parsed).toEqual({ level: 20, time: 1, msg: 'tick' })
    expect(parsed).not.toHaveProperty('event')
  })

  it.each(['42', '"just a string"', 'true', 'null', '[1,2,3]'])(
    'returns null for non-object JSON value %j',
    raw => {
      expect(parseLogLine(raw)).toBeNull()
    },
  )
})
