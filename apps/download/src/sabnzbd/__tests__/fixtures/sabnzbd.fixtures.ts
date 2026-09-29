/**
 * Raw SABnzbd 5.1.3 API payloads, exactly as they come off the wire (after
 * `JSON.parse`, before any zod parsing). Built from SAB 5.1.3's source:
 *
 * - `sabnzbd/api.py` `build_header` + `build_queue` (mode=queue)
 * - `sabnzbd/api.py` `_api_history_default` + `build_history` +
 *   `add_active_history` (mode=history, post-processing rows)
 * - `sabnzbd/database.py` `unpack_history_info` (mode=history, DB rows)
 * - `sabnzbd/interface.py` `secured_expose` / `check_apikey` (403 bodies)
 *
 * Key order follows the order SAB builds each dict in, so a fixture diffs
 * cleanly against a real capture. Values that were seen on prod are marked
 * "live"; everything else is derived from the source.
 *
 * One story runs through them, sharing nzo_ids, so reducer tests can chain
 * snapshots: a Radarr movie and a Sonarr episode download together; the
 * movie repairs, completes and is archived (prod runs Radarr/Sonarr with
 * RemoveCompleted=1); the episode fails to unpack on a full disk.
 */

// - Structural JSON type the fixtures must satisfy, so nothing here can
//   hold a value JSON.parse could not have produced (no undefined, no Date).
type SabJson =
  | string
  | number
  | boolean
  | null
  | readonly SabJson[]
  | { readonly [key: string]: SabJson }

type SabJsonObject = { readonly [key: string]: SabJson }

// - nzo_ids are uuid4 strings in SAB 5.x (`nzbqueue.py:328`), and equal
//   Radarr/Sonarr's `downloadId`.
export const SAB_MOVIE_NZO_ID = '3d9f0c52-6b1e-4a87-9f24-8c1d7e5a0b63'
export const SAB_EPISODE_NZO_ID = 'a41c7e08-5f3b-4d29-b6e1-0e7a9c2f4d15'
export const SAB_MANUAL_NZO_ID = 'c7e25b90-1a4d-4f6e-8b3c-5d2f0a9e71c8'

const MOVIE_NAME = 'The.Martian.2015.EXTENDED.2160p.UHD.BluRay.x265-TERMINAL'
const EPISODE_NAME =
  'Severance.S02E03.Who.Is.Alive.2160p.ATVP.WEB-DL.DDP5.1.H.265-FLUX'

// - Epoch seconds: movie added 2026-09-28T05:13:35Z, episode 05:14:10Z.
const MOVIE_TIME_ADDED = 1790572415
const EPISODE_TIME_ADDED = 1790572450
const MANUAL_TIME_ADDED = 1790572500

/** `mode=version` (live). */
export const SAB_VERSION = { version: '5.1.3' } as const satisfies SabJsonObject

/** `mode=queue&limit=0` with nothing queued - SAB idle, not paused. */
export const SAB_QUEUE_IDLE = {
  queue: {
    version: '5.1.3',
    paused: false,
    pause_int: '0',
    paused_all: false,
    diskspace1: '1843.21',
    diskspace2: '1843.21',
    diskspace1_norm: '1.8 T',
    diskspace2_norm: '1.8 T',
    diskspacetotal1: '7451.02',
    diskspacetotal2: '7451.02',
    speedlimit: '100',
    speedlimit_abs: '0',
    have_warnings: '0',
    finishaction: null,
    quota: '0 B',
    have_quota: false,
    left_quota: '0 B',
    cache_art: '0',
    cache_size: '0 B',
    kbpersec: '0.00',
    speed: '0',
    mbleft: '0.00',
    mb: '0.00',
    sizeleft: '0 B',
    size: '0 B',
    noofslots_total: 0,
    noofslots: 0,
    start: 0,
    limit: 0,
    finish: 0,
    status: 'Idle',
    timeleft: '0:00:00',
    slots: [],
  },
} as const satisfies SabJsonObject

/**
 * `mode=queue&limit=0` while downloading: the movie is transferring and the
 * episode waits its turn behind it.
 *
 * Both slots read `status: "Downloading"`. SAB 5.1.3 reports every job that
 * isn't individually paused as "Downloading" while the downloader runs
 * (`api.py:1713-1719`); the job's own "Queued" status only shows through
 * when the whole queue is paused (see `SAB_QUEUE_PAUSED`). The job being
 * transferred right now is only distinguishable by queue order / `index`.
 *
 * Captured during a slow patch (100 KiB/s) so the cumulative per-slot
 * `timeleft` (queue bytes ahead of and including the slot, divided by the
 * GLOBAL speed) rolls past a day into the 4-part `D:HH:MM:SS` form.
 */
// TODO(H1): replace with a live capture
export const SAB_QUEUE_DOWNLOADING = {
  queue: {
    version: '5.1.3',
    paused: false,
    pause_int: '0',
    paused_all: false,
    diskspace1: '1843.21',
    diskspace2: '1843.21',
    diskspace1_norm: '1.8 T',
    diskspace2_norm: '1.8 T',
    diskspacetotal1: '7451.02',
    diskspacetotal2: '7451.02',
    speedlimit: '100',
    speedlimit_abs: '0',
    have_warnings: '0',
    finishaction: null,
    quota: '0 B',
    have_quota: false,
    left_quota: '0 B',
    cache_art: '12',
    cache_size: '8.4 MB',
    kbpersec: '100.00',
    speed: '100 K',
    mbleft: '9216.00',
    mb: '14336.00',
    sizeleft: '9.0 GB',
    size: '14.0 GB',
    noofslots_total: 2,
    noofslots: 2,
    start: 0,
    limit: 0,
    finish: 0,
    status: 'Downloading',
    timeleft: '1:02:12:51',
    slots: [
      {
        index: 0,
        nzo_id: SAB_MOVIE_NZO_ID,
        unpackopts: '3',
        // - String form: INTERFACE_PRIORITIES maps known priorities to names.
        priority: 'Normal',
        script: 'None',
        filename: MOVIE_NAME,
        labels: [],
        password: '',
        cat: 'movies',
        mbleft: '3072.00',
        mb: '8192.00',
        size: '8.0 GB',
        sizeleft: '3.0 GB',
        // - Floored: 5120 / 8192 = 62.5%.
        percentage: '62',
        mbmissing: '0.00',
        direct_unpack: null,
        status: 'Downloading',
        timeleft: '8:44:17',
        avg_age: '12d',
        time_added: MOVIE_TIME_ADDED,
      },
      {
        index: 1,
        nzo_id: SAB_EPISODE_NZO_ID,
        unpackopts: '3',
        // - Int form: `INTERFACE_PRIORITIES.get(prio, NORMAL_PRIORITY)` falls
        //   back to the bare int 0 for priorities outside the map (a job added
        //   at Paused -2 or Stop -4), `api.py:1699`.
        priority: 0,
        script: 'None',
        filename: EPISODE_NAME,
        labels: ['ENCRYPTED'],
        password: '',
        cat: 'tv',
        mbleft: '6144.00',
        mb: '6144.00',
        size: '6.0 GB',
        sizeleft: '6.0 GB',
        percentage: '0',
        mbmissing: '0.00',
        direct_unpack: null,
        status: 'Downloading',
        timeleft: '1:02:12:51',
        avg_age: '3d',
        time_added: EPISODE_TIME_ADDED,
      },
    ],
  },
} as const satisfies SabJsonObject

/**
 * `mode=queue&limit=0` with the whole queue paused (`mode=pause`, which
 * does not set `paused_all`). The movie and episode now show their own
 * "Queued" status, and a manually added job (no category, so `cat` is the
 * string "None") that was paused on its own shows "Paused". Every slot's
 * `timeleft` is "0:00:00" while paused.
 */
export const SAB_QUEUE_PAUSED = {
  queue: {
    version: '5.1.3',
    paused: true,
    pause_int: '0',
    paused_all: false,
    diskspace1: '1843.21',
    diskspace2: '1843.21',
    diskspace1_norm: '1.8 T',
    diskspace2_norm: '1.8 T',
    diskspacetotal1: '7451.02',
    diskspacetotal2: '7451.02',
    speedlimit: '100',
    speedlimit_abs: '0',
    have_warnings: '0',
    finishaction: null,
    quota: '0 B',
    have_quota: false,
    left_quota: '0 B',
    cache_art: '0',
    cache_size: '0 B',
    kbpersec: '0.00',
    speed: '0',
    mbleft: '15139.40',
    mb: '20259.40',
    sizeleft: '14.8 GB',
    size: '19.8 GB',
    noofslots_total: 3,
    noofslots: 3,
    start: 0,
    limit: 0,
    finish: 0,
    status: 'Paused',
    timeleft: '0:00:00',
    slots: [
      {
        index: 0,
        nzo_id: SAB_MOVIE_NZO_ID,
        unpackopts: '3',
        priority: 'Normal',
        script: 'None',
        filename: MOVIE_NAME,
        labels: [],
        password: '',
        cat: 'movies',
        mbleft: '3072.00',
        mb: '8192.00',
        size: '8.0 GB',
        sizeleft: '3.0 GB',
        percentage: '62',
        mbmissing: '0.00',
        direct_unpack: null,
        status: 'Queued',
        timeleft: '0:00:00',
        avg_age: '12d',
        time_added: MOVIE_TIME_ADDED,
      },
      {
        index: 1,
        nzo_id: SAB_EPISODE_NZO_ID,
        unpackopts: '3',
        priority: 0,
        script: 'None',
        filename: EPISODE_NAME,
        labels: ['ENCRYPTED'],
        password: '',
        cat: 'tv',
        mbleft: '6144.00',
        mb: '6144.00',
        size: '6.0 GB',
        sizeleft: '6.0 GB',
        percentage: '0',
        mbmissing: '0.00',
        direct_unpack: null,
        status: 'Queued',
        timeleft: '0:00:00',
        avg_age: '3d',
        time_added: EPISODE_TIME_ADDED,
      },
      {
        index: 2,
        nzo_id: SAB_MANUAL_NZO_ID,
        unpackopts: '3',
        priority: 'Low',
        script: 'None',
        filename: 'ubuntu-24.04.3-desktop-amd64',
        labels: [],
        password: '',
        cat: 'None',
        mbleft: '5923.40',
        mb: '5923.40',
        size: '5.8 GB',
        sizeleft: '5.8 GB',
        percentage: '0',
        mbmissing: '0.00',
        direct_unpack: null,
        status: 'Paused',
        timeleft: '0:00:00',
        avg_age: '1d',
        time_added: MANUAL_TIME_ADDED,
      },
    ],
  },
} as const satisfies SabJsonObject

/**
 * `mode=history&last_history_update=K` when K is still current (live). SAB
 * answers before touching the DB.
 */
export const SAB_HISTORY_UNCHANGED = {
  history: false,
} as const satisfies SabJsonObject

/**
 * `mode=history&nzo_ids=<movie>&limit=10` while the movie is in par2 repair.
 * A post-processing row comes from `add_active_history`, not the DB:
 * `completed` is "now", `storage` is empty, `loaded` is true while it is the
 * job being processed, and `action_line` carries the live progress text
 * ("Repairing: 45%" plus a time-left suffix once the step runs over 10 s;
 * the double space is SAB's `"%2d%% %s"` + `" - 1:23 left"`).
 */
// TODO(H1): replace with a live capture
export const SAB_HISTORY_PP_REPAIRING = {
  history: {
    total_size: '1.3 T',
    month_size: '212.6 G',
    week_size: '58.1 G',
    day_size: '14.0 G',
    slots: [
      {
        completed: 1790572780,
        name: MOVIE_NAME,
        nzb_name: `${MOVIE_NAME}.nzb`,
        category: 'movies',
        pp: 'D',
        script: 'None',
        report: '',
        url: null,
        status: 'Repairing',
        nzo_id: SAB_MOVIE_NZO_ID,
        storage: '',
        path: `/downloads/incomplete/${MOVIE_NAME}`,
        script_line: '',
        download_time: 412,
        postproc_time: 0,
        stage_log: [
          { name: 'Source', actions: [`${MOVIE_NAME}.nzb`] },
          {
            name: 'Download',
            actions: [
              'Downloaded in 6 mins 52 seconds at an average of 19.9 MB/s<br/>Age: 12d',
            ],
          },
          { name: 'Servers', actions: ['Newshosting=8.0 GB'] },
          {
            name: 'Repair',
            actions: [
              `[${MOVIE_NAME}] Verified in 1 min 12 seconds, repair is required`,
            ],
          },
        ],
        downloaded: 8589934592,
        completeness: null,
        fail_message: '',
        url_info: '',
        bytes: 8589934592,
        size: '8.0 GB',
        meta: null,
        series: '',
        duplicate_key: 'the martian',
        md5sum: '',
        password: null,
        action_line: 'Repairing: 45%  - 1:23 left',
        loaded: true,
        retry: false,
        archive: false,
        time_added: MOVIE_TIME_ADDED,
      },
    ],
    ppslots: 1,
    noofslots: 1,
    last_history_update: 10,
    version: '5.1.3',
  },
} as const satisfies SabJsonObject

/**
 * `mode=history&archive=1&nzo_ids=<movie>&limit=10` after the movie
 * finished and Radarr (RemoveCompleted=1) archived it. A DB row, via
 * `unpack_history_info`: `stage_log` is sorted by STAGES, `action_line` is
 * empty, `loaded` false, and the columns SAB never writes on insert
 * (`completeness`, `meta`, `series`) are null. `ppslots` is always 0 for
 * an archive query.
 */
export const SAB_HISTORY_ARCHIVED_COMPLETED = {
  history: {
    total_size: '1.3 T',
    month_size: '212.6 G',
    week_size: '58.1 G',
    day_size: '14.0 G',
    slots: [
      {
        completed: 1790572831,
        name: MOVIE_NAME,
        nzb_name: `${MOVIE_NAME}.nzb`,
        category: 'movies',
        pp: 'D',
        script: 'None',
        report: '',
        url: null,
        status: 'Completed',
        nzo_id: SAB_MOVIE_NZO_ID,
        storage: `/downloads/complete/movies/${MOVIE_NAME}`,
        path: `/downloads/incomplete/${MOVIE_NAME}`,
        script_line: '',
        download_time: 412,
        postproc_time: 187,
        stage_log: [
          { name: 'Source', actions: [`${MOVIE_NAME}.nzb`] },
          {
            name: 'Download',
            actions: [
              'Downloaded in 6 mins 52 seconds at an average of 19.9 MB/s<br/>Age: 12d',
            ],
          },
          { name: 'Servers', actions: ['Newshosting=8.0 GB'] },
          {
            name: 'Repair',
            actions: [
              `[${MOVIE_NAME}] Verified in 1 min 12 seconds, repair is required`,
              `[${MOVIE_NAME}] Repaired in 2 mins 3 seconds`,
            ],
          },
          {
            name: 'Unpack',
            actions: [
              `[${MOVIE_NAME}] Unpacked 1 files/folders in 1 min 40 seconds`,
            ],
          },
        ],
        downloaded: 8589934592,
        completeness: null,
        fail_message: '',
        url_info: '',
        bytes: 8589934592,
        meta: null,
        series: null,
        md5sum: '0c7f3e5a9b2d4f61a8e3c7d5b1f0e924',
        password: null,
        duplicate_key: 'the martian',
        archive: true,
        time_added: MOVIE_TIME_ADDED,
        size: '8.0 GB',
        action_line: '',
        loaded: false,
        retry: false,
      },
    ],
    ppslots: 0,
    noofslots: 1,
    last_history_update: 12,
    version: '5.1.3',
  },
} as const satisfies SabJsonObject

/**
 * The unrar "write error" disk-full failure, verbatim shape from
 * `newsunpack.py:820`: `"%s %s" % (T("Unpacking failed, write error or disk
 * is full?"), line[11:])`, where `line` is unrar's "Write error in the file
 * <path>". `line[11:]` keeps the leading space, hence the double space.
 * Radarr only treats the BARE prefix (7z's form, `:1047`) as a warning, so
 * this suffixed form reaches it as a plain failure.
 */
export const SAB_DISK_FULL_FAIL_MESSAGE = `Unpacking failed, write error or disk is full?  in the file /downloads/complete/tv/_UNPACK_${EPISODE_NAME}/${EPISODE_NAME}.mkv`

/**
 * `mode=history&nzo_ids=<episode>&limit=10` after the episode's unpack hit
 * a full disk. Default (non-archive) view: prod's Sonarr (RemoveFailed=1)
 * deletes failed rows outright, so this is only visible briefly. `storage`
 * is the `_FAILED_` renamed folder (`postproc.py:558`), and `retry` is true
 * because the incomplete folder still exists.
 */
export const SAB_HISTORY_FAILED_DISK_FULL = {
  history: {
    total_size: '1.3 T',
    month_size: '212.6 G',
    week_size: '58.1 G',
    day_size: '14.0 G',
    slots: [
      {
        completed: 1790574062,
        name: EPISODE_NAME,
        nzb_name: `${EPISODE_NAME}.nzb`,
        category: 'tv',
        pp: 'D',
        script: 'None',
        report: '',
        url: null,
        status: 'Failed',
        nzo_id: SAB_EPISODE_NZO_ID,
        storage: `/downloads/complete/tv/_FAILED_${EPISODE_NAME}`,
        path: `/downloads/incomplete/${EPISODE_NAME}`,
        script_line: '',
        download_time: 305,
        postproc_time: 96,
        stage_log: [
          { name: 'Source', actions: [`${EPISODE_NAME}.nzb`] },
          {
            name: 'Download',
            actions: [
              'Downloaded in 5 mins 5 seconds at an average of 20.1 MB/s<br/>Age: 3d',
            ],
          },
          { name: 'Servers', actions: ['Newshosting=6.0 GB'] },
          { name: 'Repair', actions: [`[${EPISODE_NAME}] Quick Check OK`] },
          {
            name: 'Unpack',
            actions: [`[${EPISODE_NAME}] ${SAB_DISK_FULL_FAIL_MESSAGE}`],
          },
        ],
        downloaded: 6442450944,
        completeness: null,
        fail_message: SAB_DISK_FULL_FAIL_MESSAGE,
        url_info: '',
        bytes: 6442450944,
        meta: null,
        series: null,
        md5sum: '7a1e04c9d3b85f2e6c0a9d4b8e2f1c73',
        password: null,
        duplicate_key: 'severance/2/3',
        archive: false,
        time_added: EPISODE_TIME_ADDED,
        size: '6.0 GB',
        action_line: '',
        loaded: false,
        retry: true,
      },
    ],
    ppslots: 0,
    noofslots: 1,
    last_history_update: 11,
    version: '5.1.3',
  },
} as const satisfies SabJsonObject

/**
 * HTTP 403 plain-text bodies (`interface.py:101-106`, returned by
 * `secured_expose` at `:173-203`). NOT JSON. With `api_warnings` off in
 * sabnzbd.ini the body is empty instead, so a client must key off the
 * status code, not the text.
 */
export const SAB_FORBIDDEN_API_KEY_INCORRECT = 'API Key Incorrect'
export const SAB_FORBIDDEN_API_KEY_REQUIRED = 'API Key Required'
export const SAB_FORBIDDEN_HOSTNAME =
  'Access denied - Hostname verification failed: https://sabnzbd.org/hostname-check'
export const SAB_FORBIDDEN_EXTERNAL_ACCESS =
  'External internet access denied - https://sabnzbd.org/access-denied'

/**
 * HTTP 200 API error from `report(error)` (`api.py:1187-1221`). This is what
 * an unknown `mode` returns (`_api_undefined`, `api.py:960`). Key problems
 * never take this shape - they are 403s above.
 */
export const SAB_API_ERROR = {
  status: false,
  error: 'not implemented',
} as const satisfies SabJsonObject
