# Download App — User Stories

Granular breakdown of [`spec.md`](spec.md), one story per atomic capability. Grouped to match the spec's sections; three cross-cutting concerns (attribution, playback, entry point) pulled to the top since they touch nearly everything else.

## Attribution
1. As a user downloading a video, I want to optionally hide my identity as the downloader, so others don't see I downloaded it.
2. As a regular user, I want a video's downloader shown anonymized if the uploader hid their identity, so the toggle is actually respected.
3. As an admin, I want to always see the true downloader of any video, even when hidden from others, so I can moderate/audit accurately.
4. As a user, I want an avatar + tooltip on any movie/show/video card showing who downloaded it, so I know at a glance who's responsible.
5. As a user, I want movies and shows to always show their downloader with no hide option, so library contributions stay transparent by design.

## Playback handoff
6. As a user, I want to watch a downloaded video directly in the app, so I don't need another tool.
7. As a user, I want "Watch" on a movie/show to take me to Emby, so I use the same player as the rest of my library.
8. As a user, I want an "Indexing…" state on a movie/show Emby hasn't picked up yet, so I know it's not broken — just not ready.

## Entry point
9. As a user, I want to paste a video link into the nav-bar field from any page, so I can start a download without navigating to the homepage first.
10. As a user, I want a Download button to appear once the field recognizes what I typed as a link, so I know it's ready to go.
11. As a user, I want clicking that Download button to take me to the video's detail page and start the download there, so progress always shows up in the same place.
12. As a user, I want the nav-bar field to treat anything that isn't a link as a title search, so I don't need a separate search box.
13. As a user, I want the nav-bar search to wait for me to press Enter rather than navigating on every keystroke, so I'm not yanked to a new page mid-type.
14. As a user, I want a Search button to appear in the nav-bar field once I've typed a title, so I have something to click even if I don't think to press Enter.
15. As a user on a small screen, I want the nav-bar search to collapse to a tappable icon and expand to the full field on tap, so it doesn't get crowded out by the doorplate, download status, and my account avatar.

## 1. Homepage
16. As a user, I want a homepage snapshot of my library across videos/movies/shows, so I get oriented at a glance.
17. As a user, I want quick-access entry points to view my video library, browse movies, or browse shows, so I can jump straight in.
18. As a user, I want the homepage's Recently Added items to open their detail page — same as a gallery item — so I can act on something I just glanced at without leaving the homepage to search for it again.

## 2. Video Downloads
19. As a user, I want a pasted URL validated immediately, so I know right away if the link is usable.
20. As a user, I want to see the video's title, poster, and metadata on its detail page as soon as I arrive, so I can confirm it's the right one — even though the download is already under way.
21. As a user, I want progress to appear right on the video's page after clicking Download, so I can track it without hunting for it or leaving the page.
22. As a user, I want to cancel an in-progress download, so I can stop one I no longer want.
23. As a user, I want to pause and later resume a download without losing progress, so I don't have to restart from zero. *(Verified: resume continues from the exact byte offset.)*
24. As a user, I want to watch a finished video in-app, so I can view it immediately.
25. As a user, I want to save a finished video to my own device, so I can keep it offline.

## 3. Movie & Show Discovery
26. As a user, I want to search by title, so I can quickly find something specific.
27. As a user, I want to search by year, cast, or genre, so I can find something even without the exact title.
28. As a user, I want search reachable from the nav bar and/or a dedicated page, so it's available from anywhere.
29. As a user, I want to filter results by genre and release-date range, so I can narrow a broad result set.
30. As a user, I want to sort results (relevance, title, release date), so I can order them the way that's useful to me.
31. As a user, I want a search result to open its full detail page, so I can evaluate it before downloading.
32. As a user, I want the nav-bar search field to appear consistently on every page — home, gallery, detail pages, downloads activity, admin — so I never have to hunt for it or navigate back to start a new search.
33. As a user, I want the dedicated search page to show my active genre and release-date filters as removable chips and let me clear them all at once, so I can see and adjust what's narrowing my results without reopening the filter panel.

## 4. Show Detail Page
34. As a user, I want a show's title, cast, and metadata on its detail page, so I can decide if it's what I want.
35. As a user, I want to see all seasons and their episodes, so I can navigate the show's structure.
36. As a user, I want to download a single episode, so I don't have to pull the whole season for one episode.
37. As a user, I want to download a full season in one action, so I don't trigger every episode individually.
38. As a user, I want to download the entire series in one action, so I can grab everything at once.
39. As a user, I want to delete a single downloaded episode, so I can free space without losing the rest of the season.
40. As a user, I want to delete a full downloaded season in one action, so I can clear it out at once.
41. As a user, I want to delete the entire downloaded series in one action, so I can remove it completely.

## 5. Movie Detail Page
42. As a user, I want a movie's trailer, cover art, cast, and metadata on its detail page, so I can decide if it's what I want.
43. As a user, I want to download a movie, so I can add it to the library.
44. As a user, I want to delete a downloaded movie, so I can free up space.

## 6. File Selection, Replacement & Bad-File Reporting
45. As a user, I want to see the available release files for a movie/episode (via Radarr/Sonarr), so I'm not stuck with the auto-selected one.
46. As a user, I want to pick a specific release to download, so I control quality/source.
47. As a user, I want to replace an already-downloaded file with a different release in one flow, so I don't have to manually delete the old one first.
48. As a user, I want to flag a downloaded file as bad, so others (and I) know not to trust it.
49. As a user, I want a flagged file to show a clear "bad file" indicator, so I don't accidentally re-select or trust it.
50. As a user, I want a flagged release auto-excluded if the item is deleted and re-downloaded later, so I don't land back on the same bad file. *(Enforced only inside the download app, by design — doesn't touch Radarr/Sonarr directly.)*

## 7. Unified Gallery
51. As a user, I want one gallery spanning videos, movies, and shows, so I can browse everything in one place.
52. As a user, I want to filter the gallery by date, so I can find recently added content.
53. As a user, I want to filter the gallery by uploader/author, so I can see what a specific person downloaded.
54. As a user, I want to filter the gallery by media type, so I can narrow to just videos, movies, or shows.
55. As a user, I want a gallery item to open its detail page, so I can act on it directly.

## 8. Video Detail Page
56. As a user, I want a video's cover art, title, and author on its detail page, so I have full context.
57. As a user, I want a link back to the original source post, so I can revisit where it came from.
58. As a user, I want to download the video directly from its detail page, so I don't have to go back to find it.

## 9. Local Downloads
59. As a user, I want to save any video, movie, or show to my own device, so I can watch offline or skip the server entirely.

## 10. Downloads Activity Page
60. As a user, I want to see all downloads currently in progress across all users, so I know what's happening right now.
61. As a regular user, I want a hidden video attribution to stay anonymized here too, so the toggle holds everywhere, not just on one page.
62. As an admin, I want the true attributing user visible here for every download, including hidden videos, so I don't need a separate view for full visibility.

## 11. Admin Dashboard
63. As an admin, I want system-wide insights/metrics on download activity, so I can understand overall usage.
64. As an admin, I want per-user download history, so I can see what a specific person has downloaded.
65. As an admin, I want aggregate stats like top downloaders, so I can spot usage patterns.
66. As an admin, I want a full audit log of user interactions with the download system, so I can investigate issues after the fact.
67. As an admin, I want future services calling the download API to also land in that audit log, so the trail stays complete as the system grows.

---

67 stories across 14 groups.
