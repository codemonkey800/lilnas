import {
  drainIceCandidates,
  enqueueIceCandidate,
  isOfferer,
} from 'src/voice/peerConnections'

// Pure-helper coverage only (per this app's no-browser-verification
// convention, and this unit's own "no test required, but a small test for a
// cleanly-extractable pure helper is a welcome bonus" note) — the two
// functions here are the ones peerConnections.ts pulls out specifically so
// they're testable without a real RTCPeerConnection/WebRTC runtime (jsdom
// implements neither, and this app's jest config runs under
// `testEnvironment: 'node'` anyway).

describe('isOfferer', () => {
  it('is true when selfId sorts lower than peerId', () => {
    expect(isOfferer('aaa', 'bbb')).toBe(true)
  })

  it('is false when selfId sorts higher than peerId', () => {
    expect(isOfferer('bbb', 'aaa')).toBe(false)
  })

  // The property that actually matters for the glare rule: for any two
  // distinct ids, exactly one side computes `true` and the other `false` —
  // both sides run this same comparison independently and always agree,
  // with no handshake, and never both decide to offer.
  it('never agrees for both sides of the same pair', () => {
    const a = 'socket-1'
    const b = 'socket-2'

    expect(isOfferer(a, b)).toBe(!isOfferer(b, a))
  })
})

describe('enqueueIceCandidate / drainIceCandidates', () => {
  it('drains an absent peer to an empty array, never throwing', () => {
    const buffers = new Map<string, RTCIceCandidateInit[]>()

    expect(drainIceCandidates(buffers, 'missing')).toEqual([])
  })

  it('preserves enqueue order when draining', () => {
    const buffers = new Map<string, RTCIceCandidateInit[]>()
    const first = { candidate: 'candidate:1' }
    const second = { candidate: 'candidate:2' }
    const third = { candidate: 'candidate:3' }

    enqueueIceCandidate(buffers, 'peer-a', first)
    enqueueIceCandidate(buffers, 'peer-a', second)
    enqueueIceCandidate(buffers, 'peer-a', third)

    expect(drainIceCandidates(buffers, 'peer-a')).toEqual([
      first,
      second,
      third,
    ])
  })

  it('removes the entry once drained, so a second drain is empty', () => {
    const buffers = new Map<string, RTCIceCandidateInit[]>()
    enqueueIceCandidate(buffers, 'peer-a', { candidate: 'candidate:1' })

    drainIceCandidates(buffers, 'peer-a')

    expect(drainIceCandidates(buffers, 'peer-a')).toEqual([])
    expect(buffers.has('peer-a')).toBe(false)
  })

  it('keeps separate peers in separate queues', () => {
    const buffers = new Map<string, RTCIceCandidateInit[]>()
    const forA = { candidate: 'candidate:a' }
    const forB = { candidate: 'candidate:b' }

    enqueueIceCandidate(buffers, 'peer-a', forA)
    enqueueIceCandidate(buffers, 'peer-b', forB)

    expect(drainIceCandidates(buffers, 'peer-a')).toEqual([forA])
    expect(drainIceCandidates(buffers, 'peer-b')).toEqual([forB])
  })
})
