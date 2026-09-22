/*
 * Copy and sample data for movie-detail.pug, exposed to the template as
 * locals. See the note on loadData() in build.mjs for why this isn't just a
 * `- const` at the top of the page.
 *
 * The title is fictional and recurs across gallery.html, search.html and
 * downloads-activity.html; "Salt & Ceremony" is always assets/emby/movie-1.jpg
 * wherever it appears. See assets/README.md.
 */

const LEAD_CAST = [
  ['ML', 'Mara Lin'],
  ['TA', 'Theo Aduba'],
  ['RO', 'Ren Osei'],
]

export default {
  TITLE: 'Salt & Ceremony',
  META: '2024 · 2h 04m · Drama, Thriller',
  SYNOPSIS:
    "A quiet coastal town's annual ceremony turns into a reckoning when the tide brings back what it took " +
    'ten years ago.',
  DELETE_WARNING:
    "Removes the file from Emby and frees 2.1 GB. This can't be undone.",

  // The one manual-import candidate on a stuck download — plan 020's
  // needs-attention state. Shaped after the real Radarr rejection sentence,
  // renamed onto this page's fictional title.
  FILE: {
    name: 'Salt.Ceremony.2024.1080p.BluRay.x265.mp4',
    size: '2.1 GB',
    quality: 'Bluray-1080p',
    language: 'English',
    rejection:
      'Movie [Salt & Ceremony (2024)][tmdb:558212] was not found in the grabbed release: ' +
      'Salt.Ceremony.2024.1080p.BluRay.x265',
  },

  // Plain language, not error codes — the user is telling us what they saw.
  REASONS: ['Wrong audio or subtitles', "Video won't play", 'Not this movie'],

  LEAD_CAST,
  FULL_CAST: [
    ...LEAD_CAST,
    ['KB', 'Kofi Boadi'],
    ['PN', 'Priya Nair'],
    ['WO', 'Wes Okafor'],
  ],
  // The six names the "+6" bubble stands in for, shown on hover.
  OVERFLOW_CAST:
    'Priya Nair, Wes Okafor, Lena Marsh, Iyad Haddad, Colm Reilly, Ana Duarte',

  JUMP: [
    ['Primary', 'primary'],
    ['States & flows', 'states'],
    ['Not downloaded', 'not-downloaded'],
    ['Loading', 'loading'],
  ],
  SKELETON_RELEASES: [
    ['60%', '40%'],
    ['55%', '35%'],
  ],
  VIEWS: ['desktop', 'mobile'],
}
