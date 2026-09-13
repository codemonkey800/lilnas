/*
 * Copy and sample data for show-detail.pug, exposed to the template as
 * locals. See the note on loadData() in build.mjs for why this isn't just a
 * `- const` at the top of the page.
 */

const LEAD_CAST = [
  ['IK', 'Ida Kowalczyk'],
  ['DP', 'Dax Petrov'],
]

export default {
  TITLE: 'Harbor Watch',
  META: '2022– · 3 seasons · Drama',
  SYNOPSIS:
    "A harbormaster and her deputies keep a fading fishing town running — one permit dispute, one rescue, " +
    'one grudge at a time.',
  DELETE_WARNING:
    "Removes all 3 seasons from Emby and frees 9.4 GB. This can't be undone.",

  // Plain language, not error codes — the user is telling us what they saw.
  REASONS: ['Wrong audio or subtitles', "Video won't play", 'Wrong episode'],

  LEAD_CAST,
  FULL_CAST: [
    ...LEAD_CAST,
    ['MT', 'Mira Tan'],
    ['OB', 'Oskar Bergman'],
    ['CL', 'Chidi Lawal'],
    ['RN', 'Rosa Nery'],
  ],
  // The two names the "+2" bubble stands in for, shown on hover.
  OVERFLOW_CAST: 'Chidi Lawal, Rosa Nery',

  JUMP: [
    ['Primary', 'primary'],
    ['States & flows', 'states'],
    ['Loading', 'loading'],
  ],
  EPISODES: [
    { num: 'E1', title: 'The Long Tide', runtime: '42m', state: 'downloaded', tone: 'ok', action: 'Watch', actionVariant: 'ghost', actionIcon: 'eye' },
    { num: 'E2', title: 'Quota', runtime: '39m', state: 'indexing…', tone: 'warn' },
    { num: 'E3', title: 'Harbor Rules', runtime: '45m', state: 'downloading', tone: 'ok', live: true, progress: 31, action: 'Cancel', actionIcon: 'x' },
    { num: 'E4', title: 'Low Tide', runtime: '44m', state: 'queued', tone: 'mute' },
    { num: 'E5', title: 'The Permit', runtime: '38m', state: 'not downloaded', tone: 'mute', action: 'Download', actionIcon: 'download' },
    { num: 'E6', title: 'Salvage', runtime: '41m', state: 'bad file', tone: 'bad', bad: true, action: 'Replace' },
    { num: 'E7', title: 'Squall Line', runtime: '43m', state: 'failed', tone: 'bad', action: 'Retry' },
  ],
  SKELETON_EPISODES: [
    ['60%', '40%'],
    ['55%', '35%'],
    ['50%', '30%'],
  ],
  VIEWS: ['desktop', 'mobile'],
}
