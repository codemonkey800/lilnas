import 'dotenv/config'

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ComponentType,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js'

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

// Mock Movies - Different States
const mockMovies = {
  // Available Movie
  available: {
    id: 'movie_1',
    title: 'The Matrix',
    year: 1999,
    type: 'movie' as const,
    rating: 8.7,
    runtime: '136 min',
    genres: ['Sci-Fi', 'Action'],
    overview:
      'A computer programmer discovers that reality as he knows it is a simulation created by machines, and joins a rebellion to free humanity.',
    poster: 'https://image.tmdb.org/t/p/w300/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg',
    releaseDate: 'March 31, 1999',
    director: 'The Wachowskis',
    cast: [
      'Keanu Reeves',
      'Laurence Fishburne',
      'Carrie-Anne Moss',
      'Hugo Weaving',
      'Joe Pantoliano',
    ],
    imdbId: 'tt0133093',
    tmdbId: 603,
    available: true,
    downloading: false,
    requested: false,
    quality: '1080p BluRay',
  },
  // Requested Movie
  requested: {
    id: 'movie_2',
    title: 'Inception',
    year: 2010,
    type: 'movie' as const,
    rating: 8.8,
    runtime: '148 min',
    genres: ['Sci-Fi', 'Action', 'Thriller'],
    overview:
      'A thief who steals corporate secrets through the use of dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
    poster: 'https://image.tmdb.org/t/p/w300/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg',
    releaseDate: 'July 16, 2010',
    director: 'Christopher Nolan',
    cast: [
      'Leonardo DiCaprio',
      'Marion Cotillard',
      'Elliot Page',
      'Tom Hardy',
      'Cillian Murphy',
    ],
    imdbId: 'tt1375666',
    tmdbId: 27205,
    available: false,
    downloading: false,
    requested: true,
    quality: '1080p BluRay',
  },
  // Downloading Movie
  downloading: {
    id: 'movie_3',
    title: 'Interstellar',
    year: 2014,
    type: 'movie' as const,
    rating: 8.6,
    runtime: '169 min',
    genres: ['Sci-Fi', 'Drama', 'Adventure'],
    overview:
      'A team of explorers travel through a wormhole in space in an attempt to ensure humanity\'s survival.',
    poster: 'https://image.tmdb.org/t/p/w300/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    releaseDate: 'November 7, 2014',
    director: 'Christopher Nolan',
    cast: [
      'Matthew McConaughey',
      'Anne Hathaway',
      'Jessica Chastain',
      'Michael Caine',
      'Matt Damon',
    ],
    imdbId: 'tt0816692',
    tmdbId: 157336,
    available: false,
    downloading: true,
    requested: false,
    quality: '4K HDR',
  },
  // Unavailable Movie
  unavailable: {
    id: 'movie_4',
    title: 'Dune: Part Two',
    year: 2024,
    type: 'movie' as const,
    rating: 8.5,
    runtime: '166 min',
    genres: ['Sci-Fi', 'Adventure', 'Drama'],
    overview:
      'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    poster: 'https://image.tmdb.org/t/p/w300/8b8R8l88Qje9dn9OE8PY05Nxl1X.jpg',
    releaseDate: 'March 1, 2024',
    director: 'Denis Villeneuve',
    cast: [
      'Timothée Chalamet',
      'Zendaya',
      'Rebecca Ferguson',
      'Josh Brolin',
      'Austin Butler',
    ],
    imdbId: 'tt15239678',
    tmdbId: 693134,
    available: false,
    downloading: false,
    requested: false,
    quality: '',
  },
}

// Mock TV Shows - Different States
const mockTVShows = {
  // Available TV Show
  available: {
    id: 'tv_1',
    title: 'The Last of Us',
    year: 2023,
    type: 'tv' as const,
    rating: 8.7,
    runtime: '50-80 min',
    genres: ['Drama', 'Action', 'Adventure'],
    overview:
      'Joel and Ellie, a pair connected through the harshness of the world they live in, are forced to endure brutal circumstances and ruthless killers on a trek across post-pandemic America.',
    poster: 'https://image.tmdb.org/t/p/w300/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg',
    releaseDate: 'January 15, 2023',
    creator: 'Craig Mazin & Neil Druckmann',
    cast: [
      'Pedro Pascal',
      'Bella Ramsey',
      'Anna Torv',
      'Gabriel Luna',
      'Nick Offerman',
    ],
    imdbId: 'tt3581920',
    tvdbId: 392256,
    available: true,
    downloading: false,
    requested: false,
    quality: '1080p WEB-DL',
    seasonCount: 1,
    episodeCount: 9,
    status: 'Continuing',
    seasons: [
      { number: 1, episodes: 9, available: true },
    ],
  },
  // Requested TV Show
  requested: {
    id: 'tv_2',
    title: 'Breaking Bad',
    year: 2008,
    type: 'tv' as const,
    rating: 9.5,
    runtime: '45-60 min',
    genres: ['Crime', 'Drama', 'Thriller'],
    overview:
      'A high school chemistry teacher turned methamphetamine producer partners with a former student to secure his family\'s future as he battles terminal lung cancer.',
    poster: 'https://image.tmdb.org/t/p/w300/ggFHVNu6YYI5L9pCfOacjizRGt.jpg',
    releaseDate: 'January 20, 2008',
    creator: 'Vince Gilligan',
    cast: [
      'Bryan Cranston',
      'Aaron Paul',
      'Anna Gunn',
      'Dean Norris',
      'RJ Mitte',
    ],
    imdbId: 'tt0903747',
    tvdbId: 81189,
    available: false,
    downloading: false,
    requested: true,
    quality: '1080p WEB-DL',
    seasonCount: 5,
    episodeCount: 62,
    status: 'Ended',
    seasons: [
      { number: 1, episodes: 7, available: false },
      { number: 2, episodes: 13, available: false },
      { number: 3, episodes: 13, available: false },
      { number: 4, episodes: 13, available: false },
      { number: 5, episodes: 16, available: false },
    ],
  },
  // Downloading TV Show (partial availability)
  downloading: {
    id: 'tv_3',
    title: 'Better Call Saul',
    year: 2015,
    type: 'tv' as const,
    rating: 9.0,
    runtime: '45-60 min',
    genres: ['Crime', 'Drama'],
    overview:
      'The trials and tribulations of criminal lawyer Jimmy McGill in the time before he established his strip-mall law office in Albuquerque, New Mexico.',
    poster: 'https://image.tmdb.org/t/p/w300/fC2HDm5t0kHl7mTm7jxMR31b7by.jpg',
    releaseDate: 'February 8, 2015',
    creator: 'Vince Gilligan & Peter Gould',
    cast: [
      'Bob Odenkirk',
      'Jonathan Banks',
      'Rhea Seehorn',
      'Patrick Fabian',
      'Michael Mando',
    ],
    imdbId: 'tt3032476',
    tvdbId: 273181,
    available: false,
    downloading: true,
    requested: false,
    quality: '1080p WEB-DL',
    seasonCount: 6,
    episodeCount: 63,
    status: 'Ended',
    seasons: [
      { number: 1, episodes: 10, available: true },
      { number: 2, episodes: 10, available: true },
      { number: 3, episodes: 10, available: true },
      { number: 4, episodes: 10, available: false }, // Currently downloading
      { number: 5, episodes: 10, available: false },
      { number: 6, episodes: 13, available: false },
    ],
  },
  // Unavailable TV Show
  unavailable: {
    id: 'tv_4',
    title: 'Shogun',
    year: 2024,
    type: 'tv' as const,
    rating: 8.6,
    runtime: '60 min',
    genres: ['Drama', 'History', 'War'],
    overview:
      'When a mysterious European ship is found marooned in a nearby Japanese fishing village, Lord Yoshii Toranaga discovers secrets that could tip the scales of power.',
    poster: 'https://image.tmdb.org/t/p/w300/sgR1uGme7X2LH2qKOmYqNjLXfXb.jpg',
    releaseDate: 'February 27, 2024',
    creator: 'Rachel Kondo & Justin Marks',
    cast: [
      'Hiroyuki Sanada',
      'Cosmo Jarvis',
      'Anna Sawai',
      'Tadanobu Asano',
      'Takehiro Hira',
    ],
    imdbId: 'tt2788316',
    tvdbId: 345156,
    available: false,
    downloading: false,
    requested: false,
    quality: '',
    seasonCount: 1,
    episodeCount: 10,
    status: 'Continuing',
    seasons: [
      { number: 1, episodes: 10, available: false },
    ],
  },
}

// Type for media items
type MediaItem = typeof mockMovies[keyof typeof mockMovies] | typeof mockTVShows[keyof typeof mockTVShows]

// Create media info embed
function createMediaInfoEmbed(media: MediaItem) {
  const embed = new EmbedBuilder()
    .setTitle(`${media.title} (${media.year})`)
    .setDescription(media.overview)
    .setColor(
      media.available ? 0x00ff00 :     // Green for available
      media.downloading ? 0x00aaff :   // Blue for downloading
      media.requested ? 0xffaa00 :     // Orange for requested
      0xff0000                         // Red for unavailable
    )
    .setThumbnail(media.poster)
    .setTimestamp()

  // Basic info
  embed.addFields(
    {
      name: '📊 Details',
      value: [
        `⭐ **Rating:** ${media.rating}/10`,
        `🎭 **Genres:** ${media.genres.join(', ')}`,
        `⏱️ **Runtime:** ${media.runtime}`,
        `📅 **Release Date:** ${media.releaseDate}`,
        `💿 **Quality:** ${media.quality || 'Not Available'}`,
      ].join('\n'),
      inline: true,
    },
    {
      name: '🎬 Cast & Crew',
      value: [
        `🎥 **${media.type === 'movie' ? 'Director' : 'Creator'}:** ${media.type === 'movie' ? media.director : (media as typeof mockTVShow).creator}`,
        `🎭 **Cast:**`,
        ...media.cast.map(actor => `• ${actor}`),
      ].join('\n'),
      inline: true,
    }
  )

  // TV show specific info
  if (media.type === 'tv') {
    const tvShow = media as typeof mockTVShows[keyof typeof mockTVShows]
    
    // Calculate available seasons if partially available
    const availableSeasons = tvShow.seasons.filter(s => s.available).length
    const seasonInfo = availableSeasons > 0 && availableSeasons < tvShow.seasonCount
      ? `${tvShow.seasonCount} (${availableSeasons} available)`
      : `${tvShow.seasonCount}`
    
    embed.addFields({
      name: '📺 Series Information',
      value: [
        `📺 **Seasons:** ${seasonInfo}`,
        `📋 **Episodes:** ${tvShow.episodeCount}`,
        `📊 **Status:** ${tvShow.status}`,
      ].join('\n'),
      inline: false,
    })
  }

  // Availability status
  const statusText = media.available
    ? '✅ Available in Library'
    : media.downloading
    ? '📥 Currently Downloading'
    : media.requested
    ? '⏳ Requested - In Queue'
    : '❌ Not Available'

  embed.addFields({
    name: '📊 Status',
    value: statusText,
    inline: false,
  })

  return embed
}

// Create context-aware components based on media status
function createMediaInfoComponents(media: MediaItem) {
  const rows: any[] = []

  // Single row with all buttons based on media status
  const buttons: ButtonBuilder[] = []

  if (media.available) {
    // Available media: Play, Share, Stats, IMDB, Trailer
    buttons.push(
      new ButtonBuilder()
        .setCustomId('play_emby')
        .setLabel('Play')
        .setEmoji('▶️')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('share_link')
        .setLabel('Share')
        .setEmoji('🔗')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('view_stats')
        .setLabel('Stats')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setLabel('IMDB')
        .setEmoji('🎬')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.imdb.com/title/${media.imdbId}/`),
      new ButtonBuilder()
        .setLabel('Trailer')
        .setEmoji('🎞️')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(media.title + ' ' + media.year + ' trailer')}`)
    )
  } else if (media.requested) {
    // Requested media: View Status, Cancel Request, IMDB, Trailer
    buttons.push(
      new ButtonBuilder()
        .setCustomId('view_status')
        .setLabel('Status')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('cancel_request')
        .setLabel('Cancel')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setLabel('IMDB')
        .setEmoji('🎬')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.imdb.com/title/${media.imdbId}/`),
      new ButtonBuilder()
        .setLabel('Trailer')
        .setEmoji('🎞️')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(media.title + ' ' + media.year + ' trailer')}`)
    )
  } else if (media.downloading) {
    // Downloading media: View Progress, Cancel Download, IMDB, Trailer
    buttons.push(
      new ButtonBuilder()
        .setCustomId('view_progress')
        .setLabel('Progress')
        .setEmoji('📥')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('cancel_download')
        .setLabel('Cancel')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setLabel('IMDB')
        .setEmoji('🎬')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.imdb.com/title/${media.imdbId}/`),
      new ButtonBuilder()
        .setLabel('Trailer')
        .setEmoji('🎞️')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(media.title + ' ' + media.year + ' trailer')}`)
    )
  } else {
    // Unavailable media: Request, Stats, IMDB, Trailer
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`request_media_${media.type}_${media.id}`)
        .setLabel('Request')
        .setEmoji('📥')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('view_stats')
        .setLabel('Stats')
        .setEmoji('📊')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setLabel('IMDB')
        .setEmoji('🎬')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.imdb.com/title/${media.imdbId}/`),
      new ButtonBuilder()
        .setLabel('Trailer')
        .setEmoji('🎞️')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(media.title + ' ' + media.year + ' trailer')}`)
    )
  }

  // Add the single row of buttons
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)
  )

  return rows
}

// Create TV show request modal
function createTVRequestModal(tvShow: typeof mockTVShows[keyof typeof mockTVShows]) {
  const modal = new ModalBuilder()
    .setCustomId(`tv_request_${tvShow.id}`)
    .setTitle(`Request ${tvShow.title}`)

  // Create the text input for season/episode selection
  const seasonEpisodeInput = new TextInputBuilder()
    .setCustomId('season_episode_input')
    .setLabel('Season & Episode Selection')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder(
      'Enter seasons/episodes to download:\n\n' +
      'S1 - Full season 1\n' +
      'S2E5 - Season 2, episode 5\n' +
      'S3E1-5 - Season 3, episodes 1-5\n\n' +
      'Multiple lines supported!'
    )
    .setValue('S1') // Default to requesting season 1
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(1000)

  // Add season info to help users
  const seasonInfo = tvShow.seasons
    .map(s => `Season ${s.number}: ${s.episodes} episodes${s.available ? ' ✅' : ''}`)
    .join('\n')

  // Create a read-only field showing available seasons
  const seasonInfoInput = new TextInputBuilder()
    .setCustomId('season_info')
    .setLabel('Available Seasons')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(seasonInfo)
    .setRequired(false)

  // Create action rows
  const firstActionRow = new ActionRowBuilder<TextInputBuilder>()
    .addComponents(seasonEpisodeInput)

  const secondActionRow = new ActionRowBuilder<TextInputBuilder>()
    .addComponents(seasonInfoInput)

  // Add components to modal
  modal.addComponents(firstActionRow, secondActionRow)

  return modal
}

async function sendTestMessages() {
  try {
    await client.login(process.env.DISCORD_API_TOKEN)
    console.log('✅ Bot logged in successfully')

    // Wait for client to be ready
    await new Promise(resolve => client.once('ready', resolve))

    // Find the general channel
    const guild = client.guilds.cache.first()
    if (!guild) {
      console.error('❌ No guild found')
      return
    }

    const channel = guild.channels.cache.find(
      ch => ch.name === 'general' && ch.type === 0,
    ) as TextChannel

    if (!channel) {
      console.error('❌ General channel not found')
      return
    }

    console.log(`📍 Found channel: ${channel.name}`)

    // Delete all messages in the channel first
    console.log('🗑️ Clearing channel messages...')
    try {
      const messages = await channel.messages.fetch({ limit: 100 })
      console.log(`Found ${messages.size} messages to delete`)
      
      if (messages.size > 0) {
        // Delete messages in batches (Discord allows bulk delete for messages < 14 days old)
        const messagesToDelete = messages.filter(msg => 
          Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000
        )
        
        if (messagesToDelete.size > 0) {
          await channel.bulkDelete(messagesToDelete, true)
          console.log(`✅ Deleted ${messagesToDelete.size} messages`)
        }
        
        // Delete older messages one by one
        const olderMessages = messages.filter(msg => 
          Date.now() - msg.createdTimestamp >= 14 * 24 * 60 * 60 * 1000
        )
        
        for (const [, msg] of olderMessages) {
          try {
            await msg.delete()
          } catch (error) {
            console.log(`⚠️ Could not delete message: ${error}`)
          }
        }
      }
    } catch (error) {
      console.error('⚠️ Error clearing messages:', error)
    }

    // Wait a moment before sending new messages
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Send all movie examples
    console.log('📤 Sending movie examples...')
    
    // Available Movie
    await channel.send({
      content: '**🎬 MOVIE EXAMPLES**\n\n**1. Available Movie (The Matrix)**',
      embeds: [createMediaInfoEmbed(mockMovies.available)],
      components: createMediaInfoComponents(mockMovies.available),
    })
    
    // Requested Movie
    await channel.send({
      content: '**2. Requested Movie (Inception)**',
      embeds: [createMediaInfoEmbed(mockMovies.requested)],
      components: createMediaInfoComponents(mockMovies.requested),
    })
    
    // Downloading Movie
    await channel.send({
      content: '**3. Downloading Movie (Interstellar)**',
      embeds: [createMediaInfoEmbed(mockMovies.downloading)],
      components: createMediaInfoComponents(mockMovies.downloading),
    })
    
    // Unavailable Movie
    await channel.send({
      content: '**4. Unavailable Movie (Dune: Part Two)**',
      embeds: [createMediaInfoEmbed(mockMovies.unavailable)],
      components: createMediaInfoComponents(mockMovies.unavailable),
    })

    // Send all TV show examples
    console.log('📤 Sending TV show examples...')
    
    // Available TV Show
    await channel.send({
      content: '\n**📺 TV SHOW EXAMPLES**\n\n**1. Available TV Show (The Last of Us)**',
      embeds: [createMediaInfoEmbed(mockTVShows.available)],
      components: createMediaInfoComponents(mockTVShows.available),
    })
    
    // Requested TV Show
    await channel.send({
      content: '**2. Requested TV Show (Breaking Bad)**',
      embeds: [createMediaInfoEmbed(mockTVShows.requested)],
      components: createMediaInfoComponents(mockTVShows.requested),
    })
    
    // Downloading TV Show
    await channel.send({
      content: '**3. Downloading TV Show (Better Call Saul - Partial)**',
      embeds: [createMediaInfoEmbed(mockTVShows.downloading)],
      components: createMediaInfoComponents(mockTVShows.downloading),
    })
    
    // Unavailable TV Show
    await channel.send({
      content: '**4. Unavailable TV Show (Shogun)**',
      embeds: [createMediaInfoEmbed(mockTVShows.unavailable)],
      components: createMediaInfoComponents(mockTVShows.unavailable),
    })


    // Set up interaction handlers
    console.log('⏳ Setting up interaction handlers for 5 minutes...')

    // Handle button clicks
    const buttonCollector = channel.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000, // 5 minutes
    })

    buttonCollector.on('collect', async interaction => {
      // Handle request_media with media type and ID
      if (interaction.customId.startsWith('request_media_')) {
        const [, , mediaType, mediaId] = interaction.customId.split('_')
        
        // Find the media item
        const allMedia = [...Object.values(mockMovies), ...Object.values(mockTVShows)]
        const media = allMedia.find(m => m.id === `${mediaType}_${mediaId}`)
        
        if (media && media.type === 'tv') {
          // Show modal for TV shows
          const tvShow = media as typeof mockTVShows[keyof typeof mockTVShows]
          const modal = createTVRequestModal(tvShow)
          await interaction.showModal(modal)
          console.log(`📺 Showing TV request modal for: ${tvShow.title}`)
          return
        } else {
          // Direct request for movies
          await interaction.reply({
            content: '📥 **Movie Request Initiated!**\n\nYour request has been added to the download queue. You\'ll be notified when it\'s ready!',
            ephemeral: true,
          })
          console.log(`🎬 Movie request for: ${media?.title}`)
          return
        }
      }

      // Handle other buttons
      let responseContent = ''

      switch (interaction.customId) {
        case 'play_emby':
          responseContent = '▶️ **Opening in Emby...**\n\nLaunching media player for selected content.'
          break
        case 'share_link':
          responseContent = '🔗 **Share Link Generated!**\n\n`https://emby.lilnas.io/web/index.html#!/item?id=12345`\n\nLink expires in 7 days.'
          break
        case 'view_status':
          responseContent = '📊 **Request Status**\n\nPosition in queue: #3\nEstimated time: 15 minutes\nRequested by: You'
          break
        case 'cancel_request':
          responseContent = '❌ **Cancel Request**\n\nAre you sure you want to cancel this request? (In a real implementation, this would show a confirmation modal)'
          break
        case 'view_stats':
          responseContent = '📊 **Media Statistics**\n\nTimes watched: 127\nTotal plays: 342\nAverage rating: 4.7/5\nLast watched: 2 days ago'
          break
        case 'view_progress':
          responseContent = '📥 **Download Progress**\n\nDownloading: 47% complete\nSpeed: 12.5 MB/s\nETA: 8 minutes\nSize: 2.4GB / 5.1GB'
          break
        case 'cancel_download':
          responseContent = '❌ **Cancel Download**\n\nAre you sure you want to cancel the current download? (In a real implementation, this would show a confirmation modal)'
          break
        default:
          responseContent = `Button clicked: ${interaction.customId}`
      }

      await interaction.reply({
        content: responseContent,
        ephemeral: true,
      })

      console.log(`👆 Button interaction: ${interaction.customId}`)
    })

    // Handle select menu interactions
    const selectCollector = channel.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 300000, // 5 minutes
    })

    selectCollector.on('collect', async interaction => {
      let responseContent = ''

      switch (interaction.customId) {
        case 'season_select':
          const selectedSeasons = interaction.values.join(', ')
          responseContent = `📺 **Seasons Selected:** ${selectedSeasons}\n\nThese seasons will be included in your request. Now select the episode range to apply to each selected season.`
          await interaction.reply({
            content: responseContent,
            ephemeral: true,
          })
          break
          
        case 'episode_range_select':
          const episodeRange = interaction.values[0]
          let rangeDescription = ''
          
          switch (episodeRange) {
            case 'all_episodes':
              rangeDescription = 'All episodes from each selected season will be downloaded.'
              break
            case 'episodes_1-5':
              rangeDescription = 'Episodes 1-5 from each selected season will be downloaded.'
              break
            case 'episodes_6-10':
              rangeDescription = 'Episodes 6-10 from each selected season will be downloaded.'
              break
            case 'latest_only':
              rangeDescription = 'Only the latest episode from each selected season will be downloaded.'
              break
            case 'custom_range':
              rangeDescription = 'A dialog will open to specify exact episode numbers for each season.'
              break
          }
          
          responseContent = `📺 **Episode Range Selected:** ${episodeRange}\n\n${rangeDescription}\n\n*Example: If you selected Season 1 and Season 2, and chose "Episodes 1-5", you will get S01E01-05 and S02E01-05.*`
          await interaction.reply({
            content: responseContent,
            ephemeral: true,
          })
          break
          
        default:
          responseContent = `Selection made: ${interaction.customId}`
          await interaction.reply({
            content: responseContent,
            ephemeral: true,
          })
      }

      console.log(`📋 Select menu interaction: ${interaction.customId} - ${interaction.values}`)
    })

    // Handle modal submissions
    const modalCollector = channel.createMessageCollector({
      time: 300000, // 5 minutes
    })

    client.on('interactionCreate', async interaction => {
      if (!interaction.isModalSubmit()) return
      
      if (interaction.customId.startsWith('tv_request_')) {
        const tvId = interaction.customId.replace('tv_request_', '')
        const userInput = interaction.fields.getTextInputValue('season_episode_input')
        
        // Parse the user input
        const lines = userInput.trim().split('\n').filter(line => line.trim())
        const parsedRequests: string[] = []
        
        lines.forEach(line => {
          const trimmedLine = line.trim().toUpperCase()
          
          // Match patterns like S1, S1E1, S1E1-5
          const fullSeasonMatch = trimmedLine.match(/^S(\d+)$/)
          const singleEpisodeMatch = trimmedLine.match(/^S(\d+)E(\d+)$/)
          const rangeMatch = trimmedLine.match(/^S(\d+)E(\d+)-(\d+)$/)
          
          if (fullSeasonMatch) {
            parsedRequests.push(`Season ${fullSeasonMatch[1]} (All episodes)`)
          } else if (singleEpisodeMatch) {
            parsedRequests.push(`Season ${singleEpisodeMatch[1]}, Episode ${singleEpisodeMatch[2]}`)
          } else if (rangeMatch) {
            parsedRequests.push(`Season ${rangeMatch[1]}, Episodes ${rangeMatch[2]}-${rangeMatch[3]}`)
          } else {
            parsedRequests.push(`⚠️ Invalid format: ${line}`)
          }
        })
        
        // Find the TV show
        const tvShow = Object.values(mockTVShows).find(show => show.id === tvId)
        
        await interaction.reply({
          content: `📺 **TV Show Request Confirmed!**\n\n**${tvShow?.title}**\n\n**Requested content:**\n${parsedRequests.map(r => `• ${r}`).join('\n')}\n\n✅ Your request has been added to the download queue!`,
          ephemeral: true,
        })
        
        console.log(`📺 TV request parsed for ${tvShow?.title}:`, parsedRequests)
      }
    })

    console.log('✅ Test messages sent successfully!')
    console.log('⏰ Bot will remain active for 5 minutes to handle interactions...')
    console.log('💡 Try clicking different buttons to see the context-aware actions!')

    // Keep the bot running for 5 minutes
    setTimeout(() => {
      console.log('🛑 Test complete, shutting down...')
      client.destroy()
      process.exit(0)
    }, 300000)
  } catch (error) {
    console.error('❌ Error:', error)
    client.destroy()
    process.exit(1)
  }
}

// Run the test
sendTestMessages()
