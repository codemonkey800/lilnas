/*
 * Sample data for home.pug. Quick-access counts and the recently-added grid are
 * hardcoded to what Emby returned when assets/fetch-assets.sh last ran — the
 * one page that presents itself as real library data (see assets/README.md).
 */

export default {
  QUICK: [
    { icon: 'film', name: 'Movies', status: { tone: 'idle', label: '318' } },
    { icon: 'tv', name: 'Shows', status: { tone: 'idle', label: '54' } },
    { icon: 'play', name: 'Videos', status: { tone: 'idle', label: '203' } },
    {
      icon: 'activity',
      name: 'Activity',
      status: { tone: 'accent', label: '2 running', pulse: true },
    },
  ],

  RECENT: [
    {
      href: 'movie-detail.html',
      title: 'Scary Movie',
      kind: 'Movie',
      icon: 'film',
      meta: '2026',
      art: 'assets/emby/movie-4.jpg',
      v: 1,
      who: 'JA',
      when: '12m ago',
      watch: true,
    },
    {
      href: 'show-detail.html',
      title: 'Warrior',
      kind: 'Show',
      icon: 'tv',
      meta: 'S2',
      art: 'assets/emby/show-4.jpg',
      v: 3,
      who: 'SR',
      when: '1h ago',
      watch: true,
    },
    {
      href: 'movie-detail.html',
      title: 'Jackass: Best and Last',
      kind: 'Movie',
      icon: 'film',
      meta: '2026',
      art: 'assets/emby/movie-1.jpg',
      v: 4,
      who: 'AC',
      when: '4h ago',
      watch: true,
    },
    {
      href: 'show-detail.html',
      title: 'The Madison',
      kind: 'Show',
      icon: 'tv',
      art: 'assets/emby/show-1.jpg',
      v: 5,
      who: 'JA',
      when: '6h ago',
      indexing: true,
    },
    {
      href: 'video-detail.html',
      title: 'How to kettlebell swing (in 3 minutes)',
      kind: 'Video',
      icon: 'play',
      meta: '2:58',
      art: 'assets/video/video-1.jpg',
      video: true,
      v: 2,
      who: 'SR',
      when: '9h ago',
    },
    {
      href: 'video-detail.html',
      title: 'Cold plunge, day 30',
      kind: 'Video',
      icon: 'play',
      meta: '0:19',
      art: 'assets/video/video-2.jpg',
      video: true,
      v: 3,
      hidden: true,
      when: '1d ago',
    },
  ],
}
