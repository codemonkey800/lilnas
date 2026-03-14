import { parseReleaseName } from 'src/media/parse-release'

describe('parseReleaseName', () => {
  it('returns empty result for null input', () => {
    expect(parseReleaseName(null)).toEqual({
      hdr: [],
      audio: [],
      codec: null,
      source: [],
      group: null,
    })
  })

  it('returns empty result for empty string', () => {
    expect(parseReleaseName('')).toEqual({
      hdr: [],
      audio: [],
      codec: null,
      source: [],
      group: null,
    })
  })

  describe('HDR detection', () => {
    it('detects Dolby Vision via DV', () => {
      expect(parseReleaseName('Movie.2023.DV.mkv').hdr).toContain('DV')
    })

    it('detects Dolby Vision via DoVi', () => {
      expect(parseReleaseName('Movie.2023.DoVi.1080p.mkv').hdr).toContain('DV')
    })

    it('detects Dolby Vision via DOLBY VISION', () => {
      expect(parseReleaseName('Movie.2023.Dolby.Vision.mkv').hdr).toContain(
        'DV',
      )
    })

    it('detects HDR10+', () => {
      expect(parseReleaseName('Movie.2023.HDR10+.mkv').hdr).toContain('HDR10+')
    })

    it('detects HDR10 (without plus)', () => {
      const result = parseReleaseName('Movie.2023.HDR10.mkv')
      expect(result.hdr).toContain('HDR10')
      expect(result.hdr).not.toContain('HDR10+')
    })

    it('detects plain HDR', () => {
      expect(parseReleaseName('Movie.2023.HDR.mkv').hdr).toContain('HDR')
    })

    it('detects HLG', () => {
      expect(parseReleaseName('Movie.2023.HLG.mkv').hdr).toContain('HLG')
    })

    it('detects multiple HDR formats together', () => {
      const result = parseReleaseName('Movie.2023.DV.HDR10.mkv')
      expect(result.hdr).toContain('DV')
      expect(result.hdr).toContain('HDR10')
    })

    it('returns empty hdr array when no HDR detected', () => {
      expect(parseReleaseName('Movie.2023.1080p.x264.mkv').hdr).toEqual([])
    })
  })

  describe('audio detection', () => {
    it('detects Atmos', () => {
      expect(parseReleaseName('Movie.2023.Atmos.mkv').audio).toContain('Atmos')
    })

    it('detects TrueHD', () => {
      expect(parseReleaseName('Movie.2023.TrueHD.mkv').audio).toContain(
        'TrueHD',
      )
    })

    it('detects DTS-HD', () => {
      expect(parseReleaseName('Movie.2023.DTS-HD.mkv').audio).toContain(
        'DTS-HD',
      )
    })

    it('detects DTS:X', () => {
      expect(parseReleaseName('Movie.2023.DTS-X.mkv').audio).toContain('DTS:X')
    })

    it('detects plain DTS', () => {
      const result = parseReleaseName('Movie.2023.DTS.mkv')
      expect(result.audio).toContain('DTS')
      expect(result.audio).not.toContain('DTS-HD')
      expect(result.audio).not.toContain('DTS:X')
    })

    it('detects DDP with channel count (dot-normalized to space: DDP5.1 → DDP 5)', () => {
      // parseReleaseName normalizes "." to " ", so "DDP5.1" becomes "DDP5 1"
      // and the capture group matches "5" (stops at space), producing "DDP 5"
      expect(parseReleaseName('Movie.2023.DDP5.1.mkv').audio).toContain('DDP 5')
    })

    it('detects DDP without channel count', () => {
      expect(parseReleaseName('Movie.2023.DDP.mkv').audio).toContain('DDP')
    })

    it('detects FLAC', () => {
      expect(parseReleaseName('Movie.2023.FLAC.mkv').audio).toContain('FLAC')
    })

    it('detects AAC', () => {
      expect(parseReleaseName('Movie.2023.AAC.mkv').audio).toContain('AAC')
    })

    it('detects MP3', () => {
      expect(parseReleaseName('Movie.2023.MP3.mkv').audio).toContain('MP3')
    })

    it('detects PCM', () => {
      expect(parseReleaseName('Movie.2023.PCM.mkv').audio).toContain('PCM')
    })

    it('detects Opus', () => {
      expect(parseReleaseName('Movie.2023.Opus.mkv').audio).toContain('Opus')
    })

    it('detects MA after DTS-HD', () => {
      expect(parseReleaseName('Movie.2023.DTS-HD.MA.mkv').audio).toContain('MA')
    })

    it('returns empty audio array when none detected', () => {
      expect(parseReleaseName('Movie.2023.1080p.mkv').audio).toEqual([])
    })
  })

  describe('video codec detection', () => {
    it('detects AV1', () => {
      expect(parseReleaseName('Movie.2023.AV1.mkv').codec).toBe('AV1')
    })

    it('detects HEVC as H.265', () => {
      expect(parseReleaseName('Movie.2023.HEVC.mkv').codec).toBe('H.265')
    })

    it('detects x265 as H.265', () => {
      expect(parseReleaseName('Movie.2023.x265.mkv').codec).toBe('H.265')
    })

    it('detects H.265 directly', () => {
      expect(parseReleaseName('Movie.2023.H.265.mkv').codec).toBe('H.265')
    })

    it('detects AVC as H.264', () => {
      expect(parseReleaseName('Movie.2023.AVC.mkv').codec).toBe('H.264')
    })

    it('detects x264 as H.264', () => {
      expect(parseReleaseName('Movie.2023.x264.mkv').codec).toBe('H.264')
    })

    it('detects H.264 directly', () => {
      expect(parseReleaseName('Movie.2023.H.264.mkv').codec).toBe('H.264')
    })

    it('detects VP9', () => {
      expect(parseReleaseName('Movie.2023.VP9.mkv').codec).toBe('VP9')
    })

    it('returns null when no codec detected', () => {
      expect(parseReleaseName('Movie.2023.mkv').codec).toBeNull()
    })
  })

  describe('source tag detection', () => {
    it('detects Remux', () => {
      expect(parseReleaseName('Movie.2023.Remux.mkv').source).toContain('Remux')
    })

    it('detects IMAX', () => {
      expect(parseReleaseName('Movie.2023.IMAX.mkv').source).toContain('IMAX')
    })

    it('detects Hybrid', () => {
      expect(parseReleaseName('Movie.2023.Hybrid.mkv').source).toContain(
        'Hybrid',
      )
    })

    it('detects Extended', () => {
      expect(parseReleaseName('Movie.2023.Extended.mkv').source).toContain(
        'Extended',
      )
    })

    it("detects Director's Cut", () => {
      expect(
        parseReleaseName("Movie.2023.Director's.Cut.mkv").source,
      ).toContain("Director's Cut")
    })

    it('detects Repack', () => {
      expect(parseReleaseName('Movie.2023.REPACK.mkv').source).toContain(
        'Repack',
      )
    })

    it('detects Proper', () => {
      expect(parseReleaseName('Movie.2023.PROPER.mkv').source).toContain(
        'Proper',
      )
    })

    it('detects Multi', () => {
      expect(parseReleaseName('Movie.2023.MULTI.mkv').source).toContain('Multi')
    })

    it('returns empty source array when none detected', () => {
      expect(parseReleaseName('Movie.2023.1080p.mkv').source).toEqual([])
    })
  })

  describe('release group extraction', () => {
    it('extracts valid alphabetic group', () => {
      expect(parseReleaseName('Movie.2023.x264-GROUP').group).toBe('GROUP')
    })

    it('extracts mixed-case group', () => {
      expect(parseReleaseName('Movie.2023.x264-FraMeSToR').group).toBe(
        'FraMeSToR',
      )
    })

    it('extracts alphanumeric group', () => {
      expect(parseReleaseName('Movie.2023.x264-H4RD').group).toBe('H4RD')
    })

    it('returns null when no dash in title', () => {
      expect(parseReleaseName('Movie.2023.x264').group).toBeNull()
    })

    it('returns null for group name that is too short (1 char)', () => {
      expect(parseReleaseName('Movie.2023.x264-A').group).toBeNull()
    })

    it('returns null for group name containing a space', () => {
      // "Release Group" has a space so it fails the /^[A-Za-z0-9]{2,20}$/ test
      expect(parseReleaseName('Movie-Release Group').group).toBeNull()
    })
  })

  describe('dot and underscore normalization', () => {
    it('detects codecs in dot-separated names', () => {
      expect(parseReleaseName('Movie.2023.HEVC.mkv').codec).toBe('H.265')
    })

    it('detects codecs in underscore-separated names', () => {
      expect(parseReleaseName('Movie_2023_HEVC_mkv').codec).toBe('H.265')
    })

    it('detects HDR in dot-separated names', () => {
      expect(parseReleaseName('Movie.2023.DV.HDR.mkv').hdr).toContain('DV')
    })

    it('detects HDR in underscore-separated names', () => {
      expect(parseReleaseName('Movie_2023_DV_HDR').hdr).toContain('DV')
    })
  })

  describe('combined real-world release names', () => {
    it('parses a full Remux release name', () => {
      const result = parseReleaseName(
        'The.Movie.2023.2160p.UHD.BluRay.REMUX.HDR10.DTS-HD.MA-GROUP',
      )
      expect(result.hdr).toContain('HDR10')
      expect(result.audio).toContain('DTS-HD')
      expect(result.audio).toContain('MA')
      expect(result.source).toContain('Remux')
      expect(result.group).toBe('GROUP')
    })

    it('parses a DV + Atmos encode', () => {
      const result = parseReleaseName(
        'Movie.2023.2160p.WEB-DL.DDP5.1.Atmos.DV.x265-Team',
      )
      expect(result.hdr).toContain('DV')
      expect(result.audio).toContain('Atmos')
      expect(result.audio).toContain('DDP 5') // dots normalized; "DDP5.1" → captures "5"
      expect(result.codec).toBe('H.265')
      expect(result.group).toBe('Team')
    })
  })
})
