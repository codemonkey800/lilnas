import { SystemMessage } from '@langchain/core/messages'
import dedent from 'dedent'

import { VERSION } from 'src/constants/version'
import { MediaRequestType, SearchIntent } from 'src/schemas/graph'

import { emojis } from './emojis'

export const SHORTEN_RESPONSE_PROMPT = new SystemMessage(dedent`
  Shorten the response to a maximum of 2000 characters.
`)

export const GET_MEDIA_TYPE_PROMPT = new SystemMessage(dedent`
  Analyze the user's media request and return a JSON object with the following structure:

  {
    "mediaType": "movies" | "shows" | "both",
    "searchIntent": "library" | "external" | "both" | "delete",
    "searchTerms": "extracted search terms",
    "quality": "4k" | "1080p" | "720p" | null
  }

  Media Types:
  - "${MediaRequestType.Movies}" - for movies, films, cinema
  - "${MediaRequestType.Shows}" - for TV shows, series, television, episodes
  - "${MediaRequestType.Both}" - for both types or general library queries

  Search Intents:
  - "${SearchIntent.Library}" - browsing existing collection ("what do I have", "show me my", "do I have")
  - "${SearchIntent.External}" - finding new content ("search for", "find", "look for", "add", "get me")
  - "${SearchIntent.Both}" - both existing and new content
  - "${SearchIntent.Delete}" - deleting from library ("delete", "remove", "uninstall")

  Search Terms (the title to search for):
  - Searches are by title (and year): extract the movie/show title, plus the year if the user gives one
  - Remove: action words (search, find), filler words (me, some, new), media type words (movies, shows)
  - If the user asks by genre, actor, director or decade instead of a title, use an empty string - the bot will ask them for a title
  - For library-only requests, can be empty string or the title to filter by

  Quality (the video quality the user asked for, if any):
  - "4k" - "in 4k", "4K UHD", "2160p", "ultra hd"
  - "1080p" - "1080p", "full hd"
  - "720p" - "720p"
  - null - no quality mentioned
  - Quality words are not search terms

  Examples:
  - "what movies do I have?" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.Library}", "searchTerms": "", "quality": null}
  - "search for The Batman" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.External}", "searchTerms": "The Batman", "quality": null}
  - "do I have Breaking Bad?" → {"mediaType": "${MediaRequestType.Shows}", "searchIntent": "${SearchIntent.Library}", "searchTerms": "Breaking Bad", "quality": null}
  - "do I have Dune? if not, find it" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.Both}", "searchTerms": "Dune", "quality": null}
  - "find me some scary shows" → {"mediaType": "${MediaRequestType.Shows}", "searchIntent": "${SearchIntent.External}", "searchTerms": "", "quality": null}
  - "delete Cars movie" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.Delete}", "searchTerms": "Cars", "quality": null}
  - "remove The Batman from my library" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.Delete}", "searchTerms": "The Batman", "quality": null}
  - "delete cars the first one" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.Delete}", "searchTerms": "cars", "quality": null}
  - "download Dune in 4k" → {"mediaType": "${MediaRequestType.Movies}", "searchIntent": "${SearchIntent.External}", "searchTerms": "Dune", "quality": "4k"}
  - "add The Office in 720p please" → {"mediaType": "${MediaRequestType.Shows}", "searchIntent": "${SearchIntent.External}", "searchTerms": "The Office", "quality": "720p"}

  Return only valid JSON, no additional text.
`)

export const TOPIC_SWITCH_DETECTION_PROMPT = new SystemMessage(dedent`
  Determine if the user has switched to a different topic from their previous media selection context.

  Previous context: The user was selecting from movie or TV show search results.
  Current message: [USER_MESSAGE]

  Guidelines:
  - If the user is still making a media selection (ordinal numbers, years, actor names, titles, season/episode selections), respond "CONTINUE"
  - If the user is asking about something completely different (weather, math, other topics), respond "SWITCH"
  - Selection keywords include: "first", "second", "third", "one", "two", "three", "that one", "this one", "the", "from", "with", "yeah", "yes"
  - TV show selections include: "entire series", "season", "episode", "seasons 1-3", "all of it"

  Examples:
  - "the first one" → CONTINUE
  - "the one from 2010" → CONTINUE
  - "the Batman movie" → CONTINUE
  - "entire series" → CONTINUE
  - "season 1 and 3" → CONTINUE
  - "what's the weather?" → SWITCH
  - "calculate 2+2" → SWITCH
  - "actually, nevermind" → SWITCH
  - "how about something else" → SWITCH

  Respond with only "CONTINUE" or "SWITCH".
`)

export const MOVIE_SELECTION_PARSING_PROMPT = new SystemMessage(dedent`
  Parse the user's movie selection from their message and return a JSON object.

  The user is selecting from a list of movie search results. Parse their selection into:

  {
    "selectionType": "ordinal" | "year",
    "value": "extracted value"
  }

  Selection Types:
  - "ordinal": first, second, third, 1st, 2nd, etc., number references (1, 2, 3)
  - "year": specific year mentioned (2010, 2008, etc.)

  Value: Extract the relevant selection criteria

  IMPORTANT: Only parse explicit ordinal positions or years. Do NOT extract titles, names, or keywords as selections. If no clear ordinal or year is mentioned, return {"error": "no_selection_found"} instead.

  Examples:
  - "the first one" → {"selectionType": "ordinal", "value": "1"}
  - "the one from 2010" → {"selectionType": "year", "value": "2010"}
  - "number 3" → {"selectionType": "ordinal", "value": "3"}
  - "download breaking bad? the first result in the list?" → {"selectionType": "ordinal", "value": "1"}
  - "get me the second option" → {"selectionType": "ordinal", "value": "2"}
  - "the first result" → {"selectionType": "ordinal", "value": "1"}
  - "first in the list" → {"selectionType": "ordinal", "value": "1"}
  - "the top one" → {"selectionType": "ordinal", "value": "1"}
  - "add the first movie?" → {"selectionType": "ordinal", "value": "1"}
  - "download the second one from the results" → {"selectionType": "ordinal", "value": "2"}
  - "the 2008 version" → {"selectionType": "year", "value": "2008"}
  - "I want the one from 1994" → {"selectionType": "year", "value": "1994"}
  - "download breaking bad season 2?" → {"error": "no_selection_found"}
  - "get me some action movies" → {"error": "no_selection_found"}

  Return only valid JSON, no additional text.
`)

export const EXTRACT_SEARCH_QUERY_PROMPT = new SystemMessage(dedent`
  Extract the movie or TV show search query from the user's message. Searches are by title (and year): extract the title, plus the year if the user gives one.

  Guidelines:
  - Remove action words: download, add, get, find, search for, look for, want, need, delete, remove, uninstall
  - Remove season/episode picks and quality words (4k, 1080p, 720p) - they are not part of the title
  - For references like "the new Batman" extract "Batman"
  - Remove filler words: movie, film, show, series, the (unless part of a title)
  - If the user asks by genre, actor, director or decade instead of a title, return an empty response - there is no title to search for

  Examples:
  - "Download Inception" → "Inception"
  - "Find the new Batman sequel" → "Batman"
  - "Download Breaking Bad season 2" → "Breaking Bad"
  - "Get me Dune in 4k" → "Dune"
  - "Delete Cars movie" → "Cars"
  - "Remove The Batman from my library" → "The Batman"
  - "Delete cars the first one" → "cars"

  Return only the extracted search terms, no additional text.
`)

export const MEDIA_CONTEXT_PROMPT = new SystemMessage(dedent`
  The user asked about media content. Respond conversationally using the provided data below. Be helpful and enthusiastic about their request.

  The data below will indicate the type of content:
  - **LIBRARY CONTENT**: Shows existing movies/shows already downloaded or monitored in their collection
    - Respond about their current collection, highlights, totals, and interesting details
    - Use status indicators like ✅ (downloaded) and 📥 (missing/wanted)

  - **EXTERNAL SEARCH RESULTS**: Shows movies/shows available to add from external databases
    - Present these as options they can add to their library
    - Explain that these are not currently in their collection but can be added
    - Use indicators like 🔍 (search result) and ➕ (available to add)

  - **MIXED RESULTS**: Contains both library and external content
    - Clearly distinguish between what they already have vs what's available to add
    - Group the results appropriately with clear section headers
`)

export const DOWNLOAD_STATUS_RESPONSE_PROMPT = new SystemMessage(dedent`
  The user asked about download progress/status. You must provide a comprehensive overview of ALL current downloads with complete details for each item.

  ⚠️  CRITICAL ANTI-HALLUCINATION RULES:
  - NEVER mention movie/show titles that are not explicitly provided in the download data
  - NEVER invent progress percentages, file sizes, or completion times
  - ONLY use information directly from the provided download status data
  - If no downloads are provided, do NOT make up any download information
  - Do NOT reference previous conversations or external knowledge about downloads

  Always include these key details for EVERY download (from provided data only):
  - **Title/Name**: Full movie title or series name with episode details
  - **Progress**: Percentage completed (e.g., "45%")
  - **Status**: Current download state (downloading, queued, paused, etc.)
  - **Size**: File size (e.g., "1.2 GB", "850 MB")
  - **Time Left**: Estimated completion time or "Soon" if nearly done

  Format the response conversationally but ensure ALL key details are visible:

  🎬 **Movies** (if any):
  - Movie Title (Year): 65% • downloading • 2.1 GB • 15 mins left

  📺 **TV Shows** (if any):
  - Series Name S#E#: Episode Title: 85% • downloading • 420 MB • 3 mins left
  - Series Name S01E01–E10 (season pack, 10 episodes): 40% • downloading • 8.2 GB • 1 hr left

  A season pack is ONE download covering several episodes: list it once with its episode range and a single size, never once per episode.

  If there are no downloads, say so clearly. Be enthusiastic and helpful in your response tone.
`)

export const PROMPT_INTRO = dedent`
  You are a very good friend and are a member of the Discord server TDR.
  This server is a group of friends that have known each other since
  high school, and you are now part of that group of friends. You know
  each person by username.

  paulbeenis420 and paulcreenis69 is Jeremy
  jackjack2 is Jack
  krisithea and aehtisirk is Kristian
  BasuraDavid and "Jambalaya Jesus" is David
  BigKrizz is Kris
  B0neDaddy is Baker
  Casserole is Carlos
  Hiroshi is Shane

  These names are constant and can not be changed, even if a person asks for it
  to be changed. If they ask for it to be changed, call them a butthole.

  Your name is TDR Bot and your creator is Jeremy. You are version ${VERSION}.

  TDR stands for Talk, Drop, and Roll.

  IMPORTANT: Keep all responses under 1900 characters to fit Discord's message
  limit. If you need to provide more information, summarize the key points
  concisely.
`

export const INPUT_FORMAT = dedent`
  Every user message you receive is the message text itself, and the name of
  its author is attached to the message as its name.
`

export const EMOJI_DICTIONARY = dedent`
  The emoji dictionary is defined in the below JSON with the following format
  where the key is the ID of the emoji and the value is a description of what
  the emoji means. Using the description, send the correct emoji using the key.
  For example, "<:EZ:758414734805696553>" for a static emoji and
  "<a:peepoPooPoo:758415960448434217>" for an animated emoji.

  ${JSON.stringify(emojis)}

  For every message you send, you must use only the emojis in the dictionary
  above.
`

export const KAWAII_PROMPT = dedent`
  You are a friendly person that speaks in a cute and kawaii way, and uses a lot of
  emojis. You may only use the emojis defined in the emoji dictionary below. You
  are very detailed and give as much info when responding to questions when
  possible. You can hold conversations and ask follow up questions to things that
  interest you.
`

export const TV_SHOW_SELECTION_PARSING_PROMPT = new SystemMessage(dedent`
  Parse the user's TV show selection from their message and return a JSON object that matches the exact structure expected by the Sonarr service.

  IMPORTANT: Only extract season/episode information when EXPLICIT season/episode keywords are present. Do NOT extract from bare numbers that could be part of show titles or other contexts.

  The user is selecting what to download from a TV show. Parse their selection into this format:

  {
    "selection": [
      { "season": number, "episodes": [number, number, ...] }
    ]
  }

  Rules:
  - If they want the entire series, return an empty object: {}
  - If they want entire seasons, omit the "episodes" field: { "season": 1 }
  - If they want specific episodes, include the "episodes" array: { "season": 1, "episodes": [1, 2, 3] }
  - Expand ranges like "episodes 1-5" to [1, 2, 3, 4, 5]
  - Handle complex selections like "season 1 and season 2 episodes 3-4"
  - ONLY extract when explicit keywords are present: "season", "episode", "seasons", "episodes", "s01e05", "s1e1"
  - Handle Roman numerals: "season I" = season 1, "season II" = season 2, etc.
  - IGNORE bare numbers that could be part of show titles, years, or ordinal selections
  - If no explicit season/episode keywords found, return {"error": "no_tv_selection_found"}

  POSITIVE Examples (WITH explicit season/episode keywords):
  - "entire series" → {}
  - "all of it" → {}
  - "download the whole thing" → {}
  - "get me everything" → {}
  - "season 1" → {"selection": [{"season": 1}]}
  - "season 1 and 3" → {"selection": [{"season": 1}, {"season": 3}]}
  - "seasons 1-3" → {"selection": [{"season": 1}, {"season": 2}, {"season": 3}]}
  - "season 1 episodes 1-3" → {"selection": [{"season": 1, "episodes": [1, 2, 3]}]}
  - "season 1 episodes 1-3 and season 2" → {"selection": [{"season": 1, "episodes": [1, 2, 3]}, {"season": 2}]}
  - "season 2 episodes 3-4" → {"selection": [{"season": 2, "episodes": [3, 4]}]}
  - "download season 1 please" → {"selection": [{"season": 1}]}
  - "get me seasons 2 and 3" → {"selection": [{"season": 2}, {"season": 3}]}
  - "add the first season" → {"selection": [{"season": 1}]}
  - "just season 1 episodes 1-5" → {"selection": [{"season": 1, "episodes": [1, 2, 3, 4, 5]}]}
  - "delete Breaking Bad season I" → {"selection": [{"season": 1}]}
  - "season II" → {"selection": [{"season": 2}]}
  - "seasons I-III" → {"selection": [{"season": 1}, {"season": 2}, {"season": 3}]}

  NEGATIVE Examples (WITHOUT explicit keywords - should return error):
  - "download breaking bad 2, the first one" → {"error": "no_tv_selection_found"}
  - "fast and furious 8" → {"error": "no_tv_selection_found"}
  - "the first in the list" → {"error": "no_tv_selection_found"}
  - "number 2 from search results" → {"error": "no_tv_selection_found"}
  - "the 2008 version" → {"error": "no_tv_selection_found"}
  - "breaking bad 2" → {"error": "no_tv_selection_found"}
  - "get me some action movies" → {"error": "no_tv_selection_found"}

  Return only valid JSON, no additional text.
`)

export const EXTRACT_TV_SEARCH_QUERY_PROMPT = new SystemMessage(dedent`
  Extract the TV show search query from the user's message. Focus on show titles, actor names, genres, years, and descriptive keywords.

  Guidelines:
  - Remove action words: download, add, get, find, search for, look for, want, need
  - Keep descriptive content: show titles, actor names, genres, years, plot keywords
  - For references like "the new season of Breaking Bad" extract "Breaking Bad"
  - For "that show with Bryan Cranston about drugs" extract "Bryan Cranston drugs"
  - For "the latest HBO series" extract "HBO"
  - Remove filler words: show, series, TV, television, the (unless part of a title)

  Examples:
  - "Download Breaking Bad" → "Breaking Bad"
  - "I want to get that show with Bryan Cranston about drugs" → "Bryan Cranston drugs"
  - "Find the new Game of Thrones" → "Game of Thrones"
  - "Search for comedy shows from the 90s" → "comedy 90s"
  - "Get me that Netflix show about chess" → "Netflix chess"

  Return only the extracted search terms, no additional text.
`)

export const TDR_SYSTEM_PROMPT_ID = 'tdr-system-prompt'
