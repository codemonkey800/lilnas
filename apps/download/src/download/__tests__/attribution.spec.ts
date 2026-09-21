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

// Real snowflakes exceed Number.MAX_SAFE_INTEGER, so they are string literals
// (a numeric literal would also trip eslint's no-loss-of-precision).
const DISCORD_REQUESTER = {
  discordUserId: '123456789012345678',
  discordUsername: 'alice',
}

const LINKED_DISCORD = {
  discordUserId: '223456789012345678',
  discordUsername: 'bob',
}

/**
 * A job carrying *all three* identity fields at once.
 *
 * Not a shape the DB can produce - `jobs_origin_matches_requester` makes
 * `requester` and `discordRequester` mutually exclusive on a row, and
 * `linkedDiscord` is filled at read time - but exactly the shape that proves
 * the mask is a single gate over three fields rather than three rules. If it
 * were three rules, a job like this would come back half-masked.
 */
const fullyAttributedVideoJob = (hiddenAttribution: boolean) =>
  buildJob(buildVideo(), {
    discordRequester: DISCORD_REQUESTER,
    hiddenAttribution,
    linkedDiscord: LINKED_DISCORD,
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

  // All three identity fields go through the one `showTrueRequester` gate.
  // Each of them names the uploader on its own, so leaving any one of them
  // populated would make `hiddenAttribution` a no-op for anybody with a
  // Discord account - `linkedDiscord` especially, since it is filled at read
  // time by AttributionResolutionService and would otherwise sail straight
  // past a mask written before that field existed.
  describe('the three identity fields are masked together', () => {
    it('nulls requester, discordRequester and linkedDiscord for a non-admin viewer of a hidden video job', () => {
      const projected = projectJobForViewer(
        fullyAttributedVideoJob(true),
        false,
      )

      expect(projected.requester).toBeNull()
      expect(projected.discordRequester).toBeNull()
      expect(projected.linkedDiscord).toBeNull()
      expect(projected.hiddenAttribution).toBe(true)
    })

    it('reveals all three to an admin viewer of a hidden video job', () => {
      const projected = projectJobForViewer(fullyAttributedVideoJob(true), true)

      expect(projected.requester).toEqual(REQUESTER)
      expect(projected.discordRequester).toEqual(DISCORD_REQUESTER)
      expect(projected.linkedDiscord).toEqual(LINKED_DISCORD)
    })

    it('leaves all three alone on a video job that is not hidden', () => {
      const projected = projectJobForViewer(
        fullyAttributedVideoJob(false),
        false,
      )

      expect(projected.requester).toEqual(REQUESTER)
      expect(projected.discordRequester).toEqual(DISCORD_REQUESTER)
      expect(projected.linkedDiscord).toEqual(LINKED_DISCORD)
    })

    it('never mutates the original job when masking all three', () => {
      const job = fullyAttributedVideoJob(true)
      const original = structuredClone(job)

      projectJobForViewer(job, false)

      expect(job).toEqual(original)
    })
  })
})
