/*
 * Sample data for discord-attribution.pug.
 *
 * Four requester states, per plan 017 (docs/features/download/plans/
 * 017-discord-attribution-and-account-linking.md): `web` (unchanged),
 * `linked` (a Discord job whose snowflake is linked to a lilnas account —
 * resolved at read time, so it renders byte-identical to `web`), `discord`
 * (an unlinked Discord requester — username + a Discord mark), and `hidden`
 * (masked, exactly as today).
 *
 * Every `discord`-kind identity carries `discordUserId` (the raw snowflake)
 * alongside `username` — both are shown in the identity popover (see
 * `discordPopover` in discord-attribution.pug).
 */

export default {
  ACTIVITY_ROWS: [
    {
      title: 'Sourdough starter, day one to seven',
      short: 'Sourdough starter…',
      kind: 'video',
      icon: 'play',
      art: 'assets/video/video-3.jpg',
      v: 2,
      requester: { kind: 'web', initials: 'JA', email: 'jeremy.asuncion' },
      state: 'downloading',
      tone: 'ok',
      live: true,
      progress: 64,
      started: '2m ago',
    },
    {
      title: 'Harbor Watch — S2E3',
      kind: 'show',
      icon: 'tv',
      art: 'assets/emby/show-1.jpg',
      v: 3,
      // A Discord job whose snowflake is linked — resolved at read time, so
      // it looks exactly like a web requester. No separate visual treatment;
      // that's the point (reverse display is out of scope for v1).
      requester: { kind: 'linked', initials: 'AC', email: 'alex.chen' },
      state: 'downloading',
      tone: 'ok',
      live: true,
      progress: 31,
      started: '45s ago',
    },
    {
      title: 'Salt & Ceremony',
      kind: 'movie',
      icon: 'film',
      art: 'assets/emby/movie-1.jpg',
      v: 1,
      // Never linked — the admin hasn't matched this snowflake to a lilnas
      // account, so it renders the raw Discord identity tdr-bot sent.
      requester: {
        kind: 'discord',
        initials: 'SP',
        username: 'sam.pham',
        discordUserId: '583920174659201024',
      },
      state: 'queued',
      tone: 'mute',
      started: '12s ago',
    },
    {
      title: 'the only kettlebell move you need',
      short: 'the only kettlebell…',
      kind: 'video',
      icon: 'play',
      art: 'assets/video/video-1.jpg',
      v: 4,
      // hiddenAttribution masks discordRequester exactly as it masks
      // requester — same field, same gate, same "hidden" label.
      requester: { kind: 'hidden' },
      state: 'paused',
      tone: 'mute',
      progress: 18,
      quietProgress: true,
      mobileState: 'paused · 18%',
      started: '3m ago',
    },
  ],

  DETAIL_HEADERS: [
    {
      label: 'Web-attributed (unchanged)',
      requester: { kind: 'web', initials: 'JA', email: 'jeremy.asuncion' },
      when: '12m ago',
    },
    {
      label: 'Linked Discord — resolved to the same lilnas identity',
      requester: { kind: 'linked', initials: 'AC', email: 'alex.chen' },
      when: '3h ago',
    },
    {
      label: 'Unlinked Discord — raw identity, no lilnas account matched',
      requester: {
        kind: 'discord',
        initials: 'SP',
        username: 'sam.pham',
        discordUserId: '583920174659201024',
      },
      when: '1d ago',
    },
    {
      label: 'Masked (hiddenAttribution)',
      requester: { kind: 'hidden' },
      when: '5h ago',
    },
  ],

  // Admin audit log — a true service actor (no forwarded identity at all,
  // e.g. the yt-dlp updater) keeps its existing `service` chip untouched.
  // Only actors carrying a Discord identity get the new treatment; the
  // masking rule from the activity feed doesn't apply here at all (the admin
  // audit log never masks — see admin-actor.tsx's own header comment).
  AUDIT_ACTORS: [
    {
      level: 'DOWNLOAD',
      tone: 'text-ok',
      actor: { kind: 'web', initials: 'JA', email: 'jeremy.asuncion' },
      what: '→ "Sourdough starter, day one to seven" (video)',
    },
    {
      level: 'DOWNLOAD',
      tone: 'text-ok',
      actor: { kind: 'linked', initials: 'AC', email: 'alex.chen' },
      what: '→ "Harbor Watch — S2E3" (show)',
    },
    {
      level: 'DOWNLOAD',
      tone: 'text-ok',
      actor: {
        kind: 'discord',
        initials: 'SP',
        username: 'sam.pham',
        discordUserId: '583920174659201024',
      },
      what: '→ "Salt & Ceremony" (movie)',
    },
    {
      level: 'API',
      tone: 'text-ink-4',
      actor: { kind: 'service' },
      what: '→ re-indexed Harbor Watch S2E3',
    },
  ],

  // Optional (E4 is droppable): a recent/gallery card whose last requester is
  // an unlinked Discord identity.
  GALLERY_CARD: {
    href: 'video-detail.html',
    title: 'the daily commute, but by canoe',
    kind: 'video',
    icon: 'play',
    meta: '6:14',
    art: 'assets/video/video-2.jpg',
    video: true,
    v: 5,
    requester: {
      kind: 'discord',
      initials: 'SP',
      username: 'sam.pham',
      discordUserId: '583920174659201024',
    },
    when: '20m ago',
  },
}
