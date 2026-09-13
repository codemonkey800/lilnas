/*
 * Sample results for search.pug — a query for "the office" across Radarr and
 * Sonarr, interleaved.
 *
 * `v` picks which gradient stand-in shows when the real artwork isn't there;
 * the grid and the table deliberately use different ones for the same title,
 * which is how the originals were drawn.
 */

export default {
  QUERY: 'the office',
  HINT: 'title · year · cast · genre — across Radarr and Sonarr',
  HINT_MOBILE: 'title · year · cast · genre',

  // Grid order: relevance.
  RESULTS: [
    {
      href: 'show-detail.html',
      title: 'The Office',
      kind: 'show',
      icon: 'tv',
      meta: '9 seasons',
      art: 'assets/emby/show-4.jpg',
      v: 1,
    },
    {
      href: 'movie-detail.html',
      title: 'Office Space',
      kind: 'movie',
      icon: 'film',
      meta: '1999',
      art: 'assets/emby/movie-4.jpg',
      v: 3,
    },
    {
      href: 'show-detail.html',
      title: 'Park Bench Diaries',
      kind: 'show',
      icon: 'tv',
      meta: '3 seasons',
      art: 'assets/emby/show-5.jpg',
      v: 2,
    },
    {
      href: 'movie-detail.html',
      title: 'Suburban Static',
      kind: 'movie',
      icon: 'film',
      meta: '2003',
      art: 'assets/emby/movie-5.jpg',
      v: 4,
    },
    {
      href: 'show-detail.html',
      title: 'Middle Management',
      kind: 'show',
      icon: 'tv',
      meta: '2 seasons',
      art: 'assets/emby/show-6.jpg',
      v: 5,
    },
    {
      href: 'movie-detail.html',
      title: 'The Long Weekend',
      kind: 'movie',
      icon: 'film',
      meta: '2007',
      art: 'assets/emby/movie-6.jpg',
      v: 1,
    },
    {
      href: 'show-detail.html',
      title: 'Cubicle Nation',
      kind: 'show',
      icon: 'tv',
      meta: '4 seasons',
      art: 'assets/emby/show-1.jpg',
      v: 3,
    },
    {
      href: 'movie-detail.html',
      title: 'Desk Job',
      kind: 'movie',
      icon: 'film',
      meta: '2002',
      art: 'assets/emby/movie-1.jpg',
      v: 2,
    },
  ],

  // Table order: release year ascending, which is what the sorted column says.
  ROWS: [
    {
      title: 'Office Space',
      kind: 'movie',
      icon: 'film',
      year: '1999',
      genre: 'Comedy',
      seasons: null,
      art: 'assets/emby/movie-4.jpg',
      v: 3,
    },
    {
      title: 'Desk Job',
      kind: 'movie',
      icon: 'film',
      year: '2002',
      genre: 'Comedy',
      seasons: null,
      art: 'assets/emby/movie-1.jpg',
      v: 2,
    },
    {
      title: 'Suburban Static',
      kind: 'movie',
      icon: 'film',
      year: '2003',
      genre: 'Comedy, Drama',
      seasons: null,
      art: 'assets/emby/movie-5.jpg',
      v: 4,
    },
    {
      title: 'The Office',
      kind: 'show',
      icon: 'tv',
      year: '2005',
      genre: 'Comedy',
      seasons: '9',
      art: 'assets/emby/show-4.jpg',
      v: 1,
    },
    {
      title: 'The Long Weekend',
      kind: 'movie',
      icon: 'film',
      year: '2007',
      genre: 'Comedy',
      seasons: null,
      art: 'assets/emby/movie-6.jpg',
      v: 1,
    },
    {
      title: 'Park Bench Diaries',
      kind: 'show',
      icon: 'tv',
      year: '2008',
      genre: 'Comedy',
      seasons: '3',
      art: 'assets/emby/show-5.jpg',
      v: 2,
    },
    {
      title: 'Cubicle Nation',
      kind: 'show',
      icon: 'tv',
      year: '2009',
      genre: 'Comedy',
      seasons: '4',
      art: 'assets/emby/show-1.jpg',
      v: 3,
    },
    {
      title: 'Middle Management',
      kind: 'show',
      icon: 'tv',
      year: '2011',
      genre: 'Comedy',
      seasons: '2',
      art: 'assets/emby/show-6.jpg',
      v: 5,
    },
  ],

  GENRES: ['Comedy', 'Drama', 'Thriller', 'Sci-Fi', 'Documentary', 'Horror'],
  // 390px fits four genre chips before the panel starts scrolling.
  GENRES_MOBILE: 4,
  // The four table rows mobile keeps: a spread across the year range rather
  // than the first four, so the sorted column still reads as sorted.
  ROWS_MOBILE: [0, 2, 3, 5],
  SORTS: ['Relevance', 'Title A–Z', 'Newest release', 'Oldest release'],

  // Skeleton widths, varied so the loading grid doesn't read as a checkerboard.
  GRID_SKELETONS: [
    ['85%', '45%'],
    ['70%', '40%'],
    ['90%', '35%'],
    ['65%', '45%'],
    ['80%', '30%'],
    ['75%', '40%'],
    ['60%', '45%'],
    ['85%', '35%'],
  ],
  LIST_SKELETONS: ['120px', '95px', '140px', '105px', '85px'],
}
