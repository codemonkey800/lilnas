import { Injectable, Logger } from '@nestjs/common'
import {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js'

import {
  ComponentConstraints,
  QualityProfileData,
  RootFolderData,
  SearchResultData,
  SelectMenuConfig,
  SelectMenuOption,
} from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

@Injectable()
export class SelectMenuBuilderService {
  private readonly logger = new Logger(SelectMenuBuilderService.name)

  private readonly constraints: ComponentConstraints = {
    maxActionRows: 5,
    maxComponentsPerRow: 5,
    maxSelectMenuOptions: 25,
    maxSelectMenuValues: 25,
    maxButtonsPerRow: 5,
    maxTextInputsPerModal: 5,
    maxTextInputLength: 4000,
    maxLabelLength: 45,
    maxPlaceholderLength: 100,
    maxCustomIdLength: 100,
  }

  /**
   * Create search results select menu with pagination
   */
  createSearchResultsMenu(
    results: SearchResultData[],
    page: number = 0,
    pageSize: number = 10,
    correlationId?: string,
  ): StringSelectMenuBuilder {
    const startIndex = page * pageSize
    const endIndex = Math.min(startIndex + pageSize, results.length)
    const pageResults = results.slice(startIndex, endIndex)

    const customId = `search_results:${correlationId || 'unknown'}:${page}`
    const options = pageResults.map(result =>
      this.createSearchResultOption(result),
    )

    const totalPages = Math.ceil(results.length / pageSize)
    const placeholder = `Select from ${pageResults.length} results (Page ${page + 1}/${totalPages})`

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setPlaceholder(this.truncatePlaceholder(placeholder))
      .addOptions(options)

    this.logger.debug('Created search results select menu', {
      correlationId,
      page,
      pageSize,
      totalResults: results.length,
      pageResults: pageResults.length,
      totalPages,
      customId,
    })

    return selectMenu
  }

  /**
   * Create quality profiles select menu
   */
  createQualityProfilesMenu(
    profiles: QualityProfileData[],
    mediaType: MediaType,
    correlationId?: string,
  ): StringSelectMenuBuilder {
    const customId = `quality_profiles:${correlationId || 'unknown'}:${mediaType}`
    const options = profiles.map(profile =>
      this.createQualityProfileOption(profile),
    )

    const placeholder = `Select quality profile for ${mediaType}`

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setPlaceholder(this.truncatePlaceholder(placeholder))
      .addOptions(options)

    // Default selection is handled in createQualityProfileOption method
    const defaultProfile = profiles.find(p => p.isDefault)

    this.logger.debug('Created quality profiles select menu', {
      correlationId,
      mediaType,
      profileCount: profiles.length,
      defaultProfile: defaultProfile?.name,
      customId,
    })

    return selectMenu
  }

  /**
   * Create root folders select menu
   */
  createRootFoldersMenu(
    folders: RootFolderData[],
    mediaType: MediaType,
    correlationId?: string,
  ): StringSelectMenuBuilder {
    const customId = `root_folders:${correlationId || 'unknown'}:${mediaType}`
    const options = folders
      .filter(folder => folder.accessible !== false)
      .map(folder => this.createRootFolderOption(folder))

    const placeholder = `Select storage location for ${mediaType}`

    if (options.length === 0) {
      throw new Error('No accessible root folders available')
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setPlaceholder(this.truncatePlaceholder(placeholder))
      .addOptions(options)

    this.logger.debug('Created root folders select menu', {
      correlationId,
      mediaType,
      totalFolders: folders.length,
      accessibleFolders: options.length,
      customId,
    })

    return selectMenu
  }

  /**
   * Create seasons select menu for series
   */
  createSeasonsMenu(
    seasons: { number: number; monitored: boolean; episodeCount: number }[],
    correlationId?: string,
  ): StringSelectMenuBuilder {
    const customId = `seasons:${correlationId || 'unknown'}`
    const options = seasons.map(season => this.createSeasonOption(season))

    const placeholder = `Select seasons to monitor (${seasons.length} available)`

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setPlaceholder(this.truncatePlaceholder(placeholder))
      .addOptions(options)
      .setMinValues(1)
      .setMaxValues(
        Math.min(seasons.length, this.constraints.maxSelectMenuValues),
      )

    this.logger.debug('Created seasons select menu', {
      correlationId,
      seasonCount: seasons.length,
      customId,
    })

    return selectMenu
  }

  /**
   * Create media actions select menu
   */
  createMediaActionsMenu(
    availableActions: string[],
    mediaId: string,
    mediaType: MediaType,
    correlationId?: string,
  ): StringSelectMenuBuilder {
    const customId = `media_actions:${correlationId || 'unknown'}:${mediaType}:${mediaId}`
    const options = availableActions.map(action =>
      this.createMediaActionOption(action),
    )

    const placeholder = `Choose action for ${mediaType}`

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.truncateCustomId(customId))
      .setPlaceholder(this.truncatePlaceholder(placeholder))
      .addOptions(options)

    this.logger.debug('Created media actions select menu', {
      correlationId,
      mediaType,
      mediaId,
      actionCount: availableActions.length,
      customId,
    })

    return selectMenu
  }

  /**
   * Create generic select menu from config
   */
  createSelectMenu(config: SelectMenuConfig): StringSelectMenuBuilder {
    const options = config.options.map(opt => this.createOptionFromConfig(opt))

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.truncateCustomId(config.customId))
      .setPlaceholder(this.truncatePlaceholder(config.placeholder))
      .addOptions(options)

    if (config.minValues !== undefined) {
      selectMenu.setMinValues(config.minValues)
    }

    if (config.maxValues !== undefined) {
      selectMenu.setMaxValues(
        Math.min(config.maxValues, this.constraints.maxSelectMenuValues),
      )
    }

    if (config.disabled) {
      selectMenu.setDisabled(true)
    }

    return selectMenu
  }

  /**
   * Create search result option
   */
  private createSearchResultOption(
    result: SearchResultData,
  ): StringSelectMenuOptionBuilder {
    const title = this.truncateText(result.title, 80)
    const year = result.year ? ` (${result.year})` : ''
    const label = this.truncateText(
      `${title}${year}`,
      this.constraints.maxLabelLength,
    )

    let description = ''
    if (result.inLibrary) {
      description += '[In Library] '
    }
    if (result.overview) {
      description += this.truncateText(
        result.overview,
        100 - description.length,
      )
    }
    description = this.truncateText(description, 100)

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(`${result.mediaType}:${result.id}`)

    if (description) {
      option.setDescription(description)
    }

    if (result.mediaType === MediaType.MOVIE) {
      option.setEmoji('🎬')
    } else if (result.mediaType === MediaType.SERIES) {
      option.setEmoji('📺')
    }

    if (result.inLibrary) {
      option.setDefault(false) // Already in library, don't make default
    }

    return option
  }

  /**
   * Create quality profile option
   */
  private createQualityProfileOption(
    profile: QualityProfileData,
  ): StringSelectMenuOptionBuilder {
    const label = this.truncateText(
      profile.name,
      this.constraints.maxLabelLength,
    )
    const description = profile.isDefault
      ? 'Default quality profile'
      : `Quality profile ID: ${profile.id}`

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(profile.id.toString())
      .setDescription(description)

    if (profile.isDefault) {
      option.setDefault(true)
      option.setEmoji('⭐')
    }

    return option
  }

  /**
   * Create root folder option
   */
  private createRootFolderOption(
    folder: RootFolderData,
  ): StringSelectMenuOptionBuilder {
    const label = this.truncateText(
      folder.path,
      this.constraints.maxLabelLength,
    )
    let description = `Folder ID: ${folder.id}`

    if (folder.freeSpace !== undefined) {
      const freeSpaceGB = Math.round(folder.freeSpace / 1024 ** 3)
      description += ` | ${freeSpaceGB}GB free`
    }

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(folder.id.toString())
      .setDescription(this.truncateText(description, 100))
      .setEmoji('📁')

    return option
  }

  /**
   * Create season option
   */
  private createSeasonOption(season: {
    number: number
    monitored: boolean
    episodeCount: number
  }): StringSelectMenuOptionBuilder {
    const label = season.number === 0 ? 'Specials' : `Season ${season.number}`
    const description = `${season.episodeCount} episodes${season.monitored ? ' (currently monitored)' : ''}`

    const option = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(season.number.toString())
      .setDescription(this.truncateText(description, 100))

    if (season.monitored) {
      option.setDefault(true)
      option.setEmoji('👁️')
    }

    return option
  }

  /**
   * Create media action option
   */
  private createMediaActionOption(
    action: string,
  ): StringSelectMenuOptionBuilder {
    const actionMap: Record<
      string,
      { label: string; emoji: string; description: string }
    > = {
      play: {
        label: 'Play',
        emoji: '▶️',
        description: 'Generate Emby playback link',
      },
      download: {
        label: 'Download',
        emoji: '⬇️',
        description: 'Start downloading this media',
      },
      delete: {
        label: 'Delete',
        emoji: '🗑️',
        description: 'Remove from library',
      },
      monitor: {
        label: 'Monitor',
        emoji: '👁️',
        description: 'Start monitoring for new content',
      },
      unmonitor: {
        label: 'Stop Monitoring',
        emoji: '🚫',
        description: 'Stop monitoring this media',
      },
      search: {
        label: 'Manual Search',
        emoji: '🔍',
        description: 'Search for better quality releases',
      },
      refresh: {
        label: 'Refresh',
        emoji: '🔄',
        description: 'Refresh metadata from TMDB/TVDB',
      },
    }

    const config = actionMap[action] || {
      label: action,
      emoji: '⚙️',
      description: `Perform ${action} action`,
    }

    return new StringSelectMenuOptionBuilder()
      .setLabel(config.label)
      .setValue(action)
      .setDescription(config.description)
      .setEmoji(config.emoji)
  }

  /**
   * Create option from config
   */
  private createOptionFromConfig(
    config: SelectMenuOption,
  ): StringSelectMenuOptionBuilder {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(
        this.truncateText(config.label, this.constraints.maxLabelLength),
      )
      .setValue(config.value)

    if (config.description) {
      option.setDescription(this.truncateText(config.description, 100))
    }

    if (config.emoji) {
      option.setEmoji(config.emoji)
    }

    if (config.default) {
      option.setDefault(true)
    }

    return option
  }

  /**
   * Truncate text to fit constraints
   */
  private truncateText(
    text: string,
    maxLength: number,
    suffix = '...',
  ): string {
    if (text.length <= maxLength) {
      return text
    }
    return text.substring(0, maxLength - suffix.length) + suffix
  }

  /**
   * Truncate custom ID to fit constraints
   */
  private truncateCustomId(customId: string): string {
    return this.truncateText(customId, this.constraints.maxCustomIdLength, '')
  }

  /**
   * Truncate placeholder to fit constraints
   */
  private truncatePlaceholder(placeholder: string): string {
    return this.truncateText(placeholder, this.constraints.maxPlaceholderLength)
  }

  /**
   * Get constraint limits
   */
  getConstraints(): ComponentConstraints {
    return { ...this.constraints }
  }
}
