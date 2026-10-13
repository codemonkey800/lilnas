import {
  AnimationClip,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three'

import {
  stripProportionTracks,
  stripToRotation,
} from 'src/components/Scene/clipTracks'

const ROOT_BONE_NAME = 'mixamorig:Hips'
const OTHER_BONE_NAME = 'mixamorig:Spine'

// Two real keyframes each — three.js's KeyframeTrack constructors only
// require `times` to be non-empty, but a real quaternion/vector track still
// needs `values.length === times.length * itemSize` (4/3 per keyframe) to be
// a well-formed track, so these aren't arbitrary stand-ins. Building real
// QuaternionKeyframeTrack/VectorKeyframeTrack instances (rather than mocking
// AnimationClip) matches this app's fixture convention — see
// CharacterSelect/__tests__/pedestal.test.ts.
function quaternionTrack(name: string): QuaternionKeyframeTrack {
  return new QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
}

function vectorTrack(name: string): VectorKeyframeTrack {
  return new VectorKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 1, 1])
}

// One clip covering every combination stripProportionTracks/stripToRotation
// must tell apart: the root bone's and another bone's quaternion, position,
// and scale tracks.
function buildClip(): AnimationClip {
  return new AnimationClip('test-clip', 1, [
    quaternionTrack(`${ROOT_BONE_NAME}.quaternion`),
    vectorTrack(`${ROOT_BONE_NAME}.position`),
    vectorTrack(`${ROOT_BONE_NAME}.scale`),
    quaternionTrack(`${OTHER_BONE_NAME}.quaternion`),
    vectorTrack(`${OTHER_BONE_NAME}.position`),
    vectorTrack(`${OTHER_BONE_NAME}.scale`),
  ])
}

function trackNames(clip: AnimationClip): string[] {
  return clip.tracks.map(track => track.name)
}

describe('stripProportionTracks', () => {
  it("keeps every .quaternion track and the root bone's own .position track", () => {
    const clip = buildClip()

    const names = trackNames(stripProportionTracks(clip, ROOT_BONE_NAME))

    expect(names.sort()).toEqual(
      [
        `${ROOT_BONE_NAME}.quaternion`,
        `${ROOT_BONE_NAME}.position`,
        `${OTHER_BONE_NAME}.quaternion`,
      ].sort(),
    )
  })

  it("drops every other bone's position/scale track and the root's own scale track", () => {
    const clip = buildClip()

    const names = trackNames(stripProportionTracks(clip, ROOT_BONE_NAME))

    expect(names).not.toContain(`${ROOT_BONE_NAME}.scale`)
    expect(names).not.toContain(`${OTHER_BONE_NAME}.position`)
    expect(names).not.toContain(`${OTHER_BONE_NAME}.scale`)
  })

  it("returns a new clone: mutating the result's tracks leaves the source untouched", () => {
    const clip = buildClip()
    const originalTracks = clip.tracks

    const result = stripProportionTracks(clip, ROOT_BONE_NAME)
    result.tracks.push(quaternionTrack('extra.quaternion'))

    expect(result).not.toBe(clip)
    expect(clip.tracks).toBe(originalTracks)
    expect(clip.tracks).toHaveLength(6)
  })
})

describe('stripToRotation', () => {
  it('keeps only .quaternion tracks, regardless of bone', () => {
    const clip = buildClip()

    const names = trackNames(stripToRotation(clip))

    expect(names.sort()).toEqual(
      [`${ROOT_BONE_NAME}.quaternion`, `${OTHER_BONE_NAME}.quaternion`].sort(),
    )
  })

  it("drops the root bone's own .position track that stripProportionTracks keeps", () => {
    const clip = buildClip()

    const names = trackNames(stripToRotation(clip))

    expect(names).not.toContain(`${ROOT_BONE_NAME}.position`)
    expect(names).not.toContain(`${ROOT_BONE_NAME}.scale`)
  })

  it("returns a new clone: mutating the result's tracks leaves the source untouched", () => {
    const clip = buildClip()
    const originalTracks = clip.tracks

    const result = stripToRotation(clip)
    result.tracks.push(quaternionTrack('extra.quaternion'))

    expect(result).not.toBe(clip)
    expect(clip.tracks).toBe(originalTracks)
    expect(clip.tracks).toHaveLength(6)
  })
})
