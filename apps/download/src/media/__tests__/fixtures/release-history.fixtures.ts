import type { HistoryRecordLike } from 'src/media/release-history.util'

/**
 * History records shaped like the ones Radarr and Sonarr actually return -
 * every `data` value a string, `eventType` a string, the same `downloadId`
 * shared by a grab and its import.
 *
 * Trimmed to the keys the join reads plus a few it deliberately ignores
 * (`age`, `downloadClient`, `droppedPath`), so the tests exercise "pick the
 * right keys out of a real bag" rather than a bag built to fit.
 */

/** Radarr: one movie, grabbed from a usenet indexer and imported as file 9012. */
export const RADARR_HISTORY: HistoryRecordLike[] = [
  {
    date: '2026-07-02T03:19:08Z',
    downloadId: '8F1A2B3C4D5E6F708192A3B4C5D6E7F8',
    eventType: 'downloadFolderImported',
    sourceTitle: 'The Matrix 1999 2160p UHD BluRay x265-TERMINAL',
    data: {
      downloadClient: 'SABnzbd',
      droppedPath:
        '/downloads/complete/movies/The.Matrix.1999.2160p.UHD.BluRay.x265-TERMINAL/matrix.mkv',
      fileId: '9012',
      importedPath: '/media/movies/The Matrix (1999)/The Matrix (1999).mkv',
    },
  },
  {
    date: '2026-07-02T03:11:44Z',
    downloadId: '8F1A2B3C4D5E6F708192A3B4C5D6E7F8',
    eventType: 'grabbed',
    sourceTitle: 'The Matrix 1999 2160p UHD BluRay x265-TERMINAL',
    data: {
      age: '0',
      downloadClient: 'SABnzbd',
      guid: 'https://nzbgeek.info/geekseek.php?guid=163afb8a6c3d4e1fa0b27c99d15e4471',
      indexer: 'NzbGeek',
      indexerId: '4',
      protocol: '1',
      publishedDate: '2026-07-02T00:00:00Z',
      releaseGroup: 'TERMINAL',
      size: '4419036486',
    },
  },
  // Noise the join must ignore: neither a grab nor an import.
  {
    date: '2026-07-02T03:19:09Z',
    downloadId: '8F1A2B3C4D5E6F708192A3B4C5D6E7F8',
    eventType: 'movieFileRenamed',
    sourceTitle: '/media/movies/The Matrix (1999)/The Matrix (1999).mkv',
    data: { relativePath: 'The Matrix (1999).mkv' },
  },
]

/**
 * Sonarr: two episodes of one season, each its own grab/import pair, both
 * torrent grabs. Note `episodeId` is top-level on the *grabbed* record and
 * that neither grab carries an `indexerId` - Sonarr's history only has the
 * indexer name.
 */
export const SONARR_HISTORY: HistoryRecordLike[] = [
  {
    date: '2026-06-14T22:04:51Z',
    downloadId: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
    episodeId: 4411,
    eventType: 'grabbed',
    sourceTitle: 'Severance S02E01 2160p ATVP WEB-DL DDP5 1 Atmos H 265-FLUX',
    data: {
      age: '0',
      downloadClient: 'qBittorrent',
      guid: 'https://althub.co.za/details/6f2c0e1d9b7a4c85',
      indexer: 'AltHub',
      protocol: '2',
      publishedDate: '2026-06-14T21:58:00Z',
      releaseGroup: 'FLUX',
      size: '3155872154',
    },
  },
  {
    date: '2026-06-14T22:31:07Z',
    downloadId: 'A1B2C3D4E5F60718293A4B5C6D7E8F90',
    episodeId: 4411,
    eventType: 'downloadFolderImported',
    sourceTitle: 'Severance S02E01 2160p ATVP WEB-DL DDP5 1 Atmos H 265-FLUX',
    data: {
      downloadClient: 'qBittorrent',
      fileId: '77301',
      importedPath:
        '/media/tv/Severance/Season 02/Severance - S02E01 - Hello, Ms. Cobel.mkv',
    },
  },
  {
    date: '2026-06-21T22:02:18Z',
    downloadId: 'FEDCBA9876543210FEDCBA9876543210',
    episodeId: 4412,
    eventType: 'grabbed',
    sourceTitle: 'Severance S02E02 2160p ATVP WEB-DL DDP5 1 Atmos H 265-NTb',
    data: {
      age: '0',
      downloadClient: 'qBittorrent',
      guid: 'https://althub.co.za/details/b93d5a70c2e14f66',
      indexer: 'AltHub',
      protocol: '2',
      publishedDate: '2026-06-21T21:55:00Z',
      releaseGroup: 'NTb',
      size: '3402118899',
    },
  },
  {
    date: '2026-06-21T22:26:40Z',
    downloadId: 'FEDCBA9876543210FEDCBA9876543210',
    episodeId: 4412,
    eventType: 'downloadFolderImported',
    sourceTitle: 'Severance S02E02 2160p ATVP WEB-DL DDP5 1 Atmos H 265-NTb',
    data: {
      downloadClient: 'qBittorrent',
      fileId: '77302',
      importedPath:
        '/media/tv/Severance/Season 02/Severance - S02E02 - Goodbye, Mrs. Selvig.mkv',
    },
  },
]
