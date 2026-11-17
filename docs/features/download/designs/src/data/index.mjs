/*
 * The nine routes the download app has today, plus the two root boundaries.
 * One row per route in apps/download/src/app; nothing that has no route.
 */

export default {
  SCREENS: [
    {
      href: 'home.html',
      icon: 'home',
      title: 'Home',
      route: '/',
      desc: 'The search hero, quick access and what was added lately.',
    },
    {
      href: 'search.html',
      icon: 'search',
      title: 'Search',
      route: '/search',
      desc: 'Movies and shows across Radarr and Sonarr, with filters and sort.',
    },
    {
      href: 'gallery.html',
      icon: 'grid',
      title: 'Gallery',
      route: '/gallery',
      desc: 'Videos, movies and shows in one filterable grid.',
    },
    {
      href: 'activity.html',
      icon: 'activity',
      title: 'Activity',
      route: '/activity',
      desc: 'Every download in flight, across every user, live.',
    },
    {
      href: 'admin.html',
      icon: 'shield',
      title: 'Admin',
      route: '/admin',
      desc: 'System stats, history, top downloaders and the audit log.',
    },
    {
      href: 'profile.html',
      icon: 'users',
      title: 'Profile',
      route: '/profile',
      desc: 'One person’s lifetime totals, trend and download history.',
    },
    {
      href: 'movie-detail.html',
      icon: 'film',
      title: 'Movie detail',
      route: '/movies/[tmdbId]',
      desc: 'Every media state, the release picker, attempts and dialogs.',
    },
    {
      href: 'show-detail.html',
      icon: 'tv',
      title: 'Show detail',
      route: '/shows/[tvdbId]',
      desc: 'Seasons and episodes, with per-episode actions.',
    },
    {
      href: 'video-detail.html',
      icon: 'play',
      title: 'Video detail',
      route: '/videos/[videoId]',
      desc: 'The player, the source link and the job’s progress.',
    },
  ],
}
