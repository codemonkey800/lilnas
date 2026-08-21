import { DownloadJobStatus } from '@lilnas/utils/download/types'

import {
  projectJobForViewer,
  showTrueRequester,
} from 'src/download/attribution'

import {
  buildJob,
  buildMovie,
  buildShow,
  buildVideo,
  REQUESTER,
} from './helpers/job-fixtures'

const videoJob = (hiddenAttribution: boolean) =>
  buildJob(buildVideo(), {
    hiddenAttribution,
    status: DownloadJobStatus.Completed,
  })

describe('showTrueRequester', () => {
  describe('video jobs', () => {
    it('is true when not hidden, regardless of admin status', () => {
      const job = videoJob(false)

      expect(showTrueRequester(job, false)).toBe(true)
      expect(showTrueRequester(job, true)).toBe(true)
    })

    it('is false for a non-admin viewer when hidden', () => {
      expect(showTrueRequester(videoJob(true), false)).toBe(false)
    })

    it('is true for an admin viewer even when hidden', () => {
      expect(showTrueRequester(videoJob(true), true)).toBe(true)
    })
  })

  describe('movie/show jobs', () => {
    // hiddenAttribution is deliberately set here: movies/shows have no
    // hiding toggle by design, so the media-type branch - not the flag -
    // must be what decides. Setting the flag is the negative control.
    it('is always true for a movie job, even with the flag set', () => {
      const job = buildJob(buildMovie(), { hiddenAttribution: true })

      expect(showTrueRequester(job, false)).toBe(true)
      expect(showTrueRequester(job, true)).toBe(true)
    })

    it('is always true for a show job, even with the flag set', () => {
      const job = buildJob(buildShow(), { hiddenAttribution: true })

      expect(showTrueRequester(job, false)).toBe(true)
      expect(showTrueRequester(job, true)).toBe(true)
    })
  })
})

describe('projectJobForViewer', () => {
  it('returns the job unchanged (same requester) when not hidden', () => {
    expect(projectJobForViewer(videoJob(false), false).requester).toEqual(
      REQUESTER,
    )
  })

  it('masks the requester for a non-admin viewer of a hidden video job', () => {
    const projected = projectJobForViewer(videoJob(true), false)

    expect(projected.requester).toBeNull()
    // hiddenAttribution itself must survive - non-admin viewers still need
    // it to render the hidden-attribution UI treatment.
    expect(projected.hiddenAttribution).toBe(true)
  })

  it('reveals the true requester to an admin viewer of a hidden video job', () => {
    const projected = projectJobForViewer(videoJob(true), true)

    expect(projected.requester).toEqual(REQUESTER)
    expect(projected.hiddenAttribution).toBe(true)
  })

  it('never mutates the original job object', () => {
    const job = videoJob(true)
    const original = structuredClone(job)

    projectJobForViewer(job, false)

    expect(job).toEqual(original)
  })

  it('never masks a movie job', () => {
    const job = buildJob(buildMovie(), { hiddenAttribution: true })

    expect(projectJobForViewer(job, false).requester).toEqual(REQUESTER)
  })

  it('never masks a show job', () => {
    const job = buildJob(buildShow(), { hiddenAttribution: true })

    expect(projectJobForViewer(job, false).requester).toEqual(REQUESTER)
  })
})
