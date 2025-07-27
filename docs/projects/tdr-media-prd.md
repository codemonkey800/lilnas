# Product Requirements Document: Discord Media Management Feature for TDR-Bot

## 1. Executive Summary

This PRD outlines the requirements for implementing a comprehensive media management feature within the tdr-bot Discord service. The feature will enable Discord users to search, request, manage, and access media content through intuitive slash commands, integrating with the existing Sonarr (TV shows), Radarr (movies), and Emby (media server) infrastructure.

The primary goal is to create a seamless, user-friendly interface for media discovery and management directly within Discord, eliminating the need for users to access multiple web interfaces while maintaining proper access controls and system integrity.

## 2. Problem Statement & User Needs

### Current Challenges:

- Users must navigate between multiple web interfaces (Sonarr, Radarr, Emby) to manage media
- No unified search experience across movies and TV shows
- Lack of quick visibility into what content is already available
- Manual process for requesting new content requires leaving Discord
- No easy way to share media links within Discord conversations

### User Needs:

- **Discovery**: Easily search for movies and TV shows without leaving Discord
- **Visibility**: Quickly check if desired content is already downloaded
- **Convenience**: Request downloads directly from Discord
- **Management**: Basic media library management (list, delete) through Discord
- **Sharing**: Generate and share Emby links for collaborative viewing
- **Context**: View detailed information about media before requesting

## 3. Feature Overview & Goals

### Primary Goals:

1. Create a unified media management interface within Discord
2. Reduce friction in the media discovery and request process
3. Provide transparency into library contents and download status
4. Enable social features through easy media sharing
5. Maintain audit logging for accountability

### Key Features:

- Comprehensive search across movies and TV shows
- Detailed media information display with Discord embeds
- One-click download requests with progress tracking
- Library browsing and management capabilities
- Direct Emby link generation for streaming
- Intelligent duplicate detection and prevention

## 4. Features & User Experience

### 4.1 Command Structure

```
/media
├── search <query>
├── info <media_id>
├── request
│   ├── movie <media_id>
│   └── tv <media_id>
├── status <media_id>
├── delete <media_id>
└── library [query] [limit:number]
```

### 4.2 Core Features

**F1. Search Functionality**

- Support fuzzy searching across movie and TV databases by title
- Return paginated results (5-10 per page) with navigation controls
- Display in embed: Title, Year, Genres, Runtime, Rating with status indicators
- Status indicators: ✅ Available, ⏳ Requested, 📥 Downloading, ❌ Not Available
- Dropdown selection mechanism for choosing specific media items
- Context-aware button states based on selected movie's availability

**Interactive Search Components:**
- **Movie Selection Dropdown**: Select menu listing all movies on current page
  - Shows movie title, year, and status indicator (✅ Available, ⏳ Requested, 📥 Downloading, ❌ Not Available)
  - Includes genre and rating in description
  - Updates action button states when selection changes
- **Context-Aware Action Buttons**: 
  - 📥 Request button (Primary style) - Enabled only for unavailable movies
  - ℹ️ Info button (Secondary style) - Enabled when movie is selected
  - ▶️ Emby button (Success style) - Only appears when selected movie is available
- **Simplified Navigation**: Previous/Next buttons with page indicator

**Search Workflow Enhancement:**
```
/media search "the matrix" → Results Display (Page 1 of N)
                          ↓
           Embed shows numbered list with status
                          ↓
    [Select a movie ▼] → User selects from dropdown
                          ↓
    Action buttons update based on selection
                          ↓
    [Request] [Info] [Emby] → Context-aware actions
                          ↓
    [◀ Previous] [Page 1/N] [Next ▶] → Navigation
```

**Interactive Search Features:**
- Simple pagination through interactive buttons
- Context-aware action buttons based on media status
- Direct actions from search results (request, info, play)

**F2. Media Information Display**

- Rich embed with full poster image
- Complete overview/synopsis
- Cast and crew information (top 5)
- Runtime, genres, rating, release date
- For TV: Season count, episode count, status (continuing/ended)
- For TV: Availability indicator showing partial vs full availability (e.g., "3/5 seasons available")
- Links to IMDB, TVDB, TrailersDB

**Interactive Info Components:**
- **Single Row Button Layout - All Media Types**:
  - All action buttons MUST be placed on a single row for consistency
  - Maximum 5 buttons per row (Discord limitation)
  - Button order and availability varies by media status
  
**Button Configurations by Status:**

**Movies - Available:**
- ▶️ Play (Success style) - Direct playback in Emby
- 🔗 Share (Secondary style) - Generate shareable links
- 🎬 IMDB (Link style) - External database link
- 🎞️ Trailer (Link style) - YouTube trailer search

**Movies - Unavailable/Requested/Downloading:**
- Same as general media patterns below

**TV Shows - Partially Available:**
- ▶️ Play (Success style) - Direct playback in Emby
- 📥 Request (Primary style) - Request missing episodes/seasons
- 🔗 Share (Secondary style) - Generate shareable links
- 🎬 IMDB (Link style) - External database link

**TV Shows - Fully Available (All Episodes Downloaded):**
- ▶️ Play (Success style) - Direct playback in Emby
- 🔗 Share (Secondary style) - Generate shareable links
- 🎬 IMDB (Link style) - External database link
- 🎞️ Trailer (Link style) - YouTube trailer search
- Note: No Request button shown when all episodes are available

**Unavailable Media (Movie or TV):**
- 📥 Request (Primary style) - Main call-to-action
- 🎬 IMDB (Link style) - External database link
- 🎞️ Trailer (Link style) - YouTube trailer search

**Requested Media (Movie or TV):**
- 📤 Status (Secondary style) - Check queue position
- ❌ Cancel (Danger style) - Cancel the request
- 🎬 IMDB (Link style) - External database link
- 🎞️ Trailer (Link style) - YouTube trailer search

**Downloading Media (Movie or TV):**
- 📥 Progress (Secondary style) - Current download status
- ❌ Cancel (Danger style) - Stop the download
- 🎬 IMDB (Link style) - External database link
- 🎞️ Trailer (Link style) - YouTube trailer search

**TV Show Requests:**
- Request button opens a modal for season/episode specification
- Text input supports formats like S1, S2E5, S3E6-9
- Multi-line input for complex requests

**Contextual Button States:**
- **Movies - Available**: Show "Play in Emby" (Success) + "Share Link" (Secondary)
- **TV Shows - Partially Available**: Show "Play in Emby" (Success) + "Request" (Primary) + "Share Link" (Secondary)
- **TV Shows - Fully Available**: Show "Play in Emby" (Success) + "Share Link" (Secondary) - NO Request button
- **Requested Media**: Show "Status" (Secondary) + "Cancel" (Danger)
- **Downloading Media**: Show "Progress" (Secondary) + "Cancel" (Danger)
- **Unavailable Media**: Show "Request Now" (Primary)


**F3. Request/Download Management**

- Modal-based confirmation for both movies and TV shows
- Additional season/episode selection interface for TV shows within the modal
- Interactive status updates via component refreshes
- Queue position indicator
- Estimated download time (if available)

**Interactive Request Components:**
- **Movie Request Flow**:
  - `/media request movie <media_id>` command opens a confirmation modal
  - Modal displays movie title, year, quality, and estimated file size
  - User confirms or cancels the download request
  - Success response with download status and queue information

**Movie Request Confirmation Modal:**
Modal displays movie details (title, year, quality, estimated size) with confirm/cancel options.

- **TV Show Request Flow**: Modal-based input for season/episode selection with format validation

**TV Show Request Confirmation Modal:**
Modal shows selected content (title, seasons/episodes, estimated size) for user confirmation.

**Smart Request Features:**
- **Duplicate Detection**: Warning modal if content already requested/available
- **Storage Impact**: Display estimated download size and storage usage

**Request Status Tracking:**
- **Component-Based Progress Updates**: Interactive embeds with manual refresh capability
- **Interactive Status Controls**:
  - 🔄 Refresh Status (Secondary button) - Manual status update
  - ❌ Cancel (Danger button) - Remove from queue with confirmation


**F4. Library Management**

- Unified library command: `/media library [query]`
  - No query: Browse all downloaded content with pagination (10 items per page)
  - With query: Search within downloaded content (10 items per page)
- Alphabetical sorting (A-Z) by default
- Delete functionality with confirmation prompt

**Interactive Library Components:**
- **List View Only** - Simple text-based listing showing title, year, type, and quality
- **Media Selection Dropdown**: 
  - Select menu listing all media items on current page
  - Format: "Title (Year) • Type • Quality"
  - Required due to Discord's component limitations
- **Action Buttons** (enabled after selection):
  - ℹ️ Info (Secondary style) - View detailed media information
  - ▶️ Play in Emby (Success style) - Direct playback
  - 🔗 Link (Secondary style) - Generate shareable link
  - 🗑️ Delete (Danger style) - Remove from library with confirmation

**Library Interface:**
Displays paginated, alphabetically sorted list of media items with title, year, type, and quality. Users select from dropdown menu to enable action buttons (Info, Play, Link, Delete). Navigation controls allow browsing through pages.

**Library Workflow:**
```
/media library [query] → Alphabetical Results Display
                              ↓
         User selects from dropdown
                              ↓
    Action buttons become enabled
                              ↓  
  User can: View Info, Play, Share, Delete
```

**F5. Emby Integration**

- Generate shareable Emby play page links
- Quick play button integration that opens Emby web interface

**F6. Status Management**

- Interactive download progress tracking
- Component-based queue position monitoring
- Manual request status verification
- Download completion notifications

**Interactive Status Components:**
- **Status Refresh**: 🔄 Manual refresh button (Secondary style) for updated information
- **Progress Indicators**: 
  - 📥 Queued (awaiting download start)
  - ⬇️ Downloading (with progress percentage)
  - ✅ Completed (ready for playback)
  - ❌ Failed (with error details and retry option)
- **Queue Management Controls**:
  - ❌ Cancel (Danger button) - Remove from queue with confirmation

**Status Tracking Features:**
```
/media status <media_id> → Current Status Display
                         ↓
    Interactive Progress Display with Controls
                         ↓
     [Refresh] [Cancel]
                         ↓
    User clicks control → Component updates status
```

**Advanced Status Information:**
- **Download Details**: Current speed, ETA, file size, quality
- **Error Diagnostics**: Detailed error messages with suggested fixes

**F7. Delete Management**

- Safe media removal with confirmations
- Storage reclamation tracking

**Delete Confirmation:**
Modal displays media title and storage impact (file size, metadata) with confirm/cancel options for safe deletion.


**Smart Delete Features:**
- **Storage Impact Calculator**: Show space that will be freed

**Delete Safety Mechanisms:**
- **Simple Confirmation**: Click confirm button to delete
- **User Notifications**: Inform users when shared content is being deleted

### 4.2 Technical Requirements

**T1. API Integration**

- Implement service classes for Sonarr, Radarr, and Emby APIs
- Use existing HTTP client patterns from tdr-bot codebase
- Implement proper error handling and retry logic
- Implement strategic caching for performance optimization:
  - **Cache (5-15 minutes)**: External metadata searches (TMDB/TVDB results), static media information (posters, descriptions, cast)
  - **Never cache (always fresh)**: Library availability status, download queue/progress, request status, duplicate detection queries
- TV Show availability detection:
  - **Full Availability Check**: Compare total episode count against downloaded episodes
  - **Partial Availability**: Track which seasons/episodes are available vs missing
  - **Smart Request Button**: Show request button for TV shows unless ALL episodes are downloaded
  - **Season-Level Tracking**: Maintain granular data on which seasons are complete vs partial

**T2. Discord Interface & Component Handling**

- **Core Discord.js Integration**:
  - Use Discord.js v14+ slash commands with Necord framework
  - Implement comprehensive button, select menu, and modal interactions
  - Use rich embeds for media display with thumbnail support
  - Implement component state persistence across user sessions

- **Interactive Component Management**:
  - **Component Lifecycle**: Implement proper creation, update, and cleanup of interactive components
  - **State Persistence**: Store component state in Redis/database for multi-step workflows
  - **Custom ID Encoding**: Use structured custom IDs: `action_mediaType_mediaId_context_page`
  - **Component Timeout Handling**: Auto-cleanup abandoned interactions after 15 minutes
  - **Concurrent Interaction Support**: Handle multiple users interacting simultaneously

- **Advanced Component Patterns**:
  - **Progressive Disclosure**: Start with simple interfaces, reveal complexity on demand
  - **Smart Pagination**: Dynamic page sizing based on content and user preferences
  - **Contextual Actions**: Button availability based on media status and user permissions
  - **Multi-Step Workflows**: Chain interactions for complex operations (search → info → request → confirm)

- **Component Performance Optimization**:
  - **Lazy Loading**: Load component data only when needed
  - **Component Caching**: Cache frequently accessed component configurations
  - **Debounced Updates**: Prevent excessive API calls from rapid interactions
  - **Intelligent Refreshing**: Update only changed components, not entire messages

- **Error Handling for Interactive Components**:
  - **Graceful Degradation**: Fall back to text-based interfaces if components fail
  - **User Feedback**: Clear error messages with suggested recovery actions
  - **Retry Mechanisms**: Automatic retry for transient failures
  - **Component Validation**: Validate interaction data before processing
  - **Permission Handling**: Graceful handling of insufficient permissions

- **Component Security**:
  - **Input Validation**: Sanitize all component interaction data
  - **Rate Limiting**: Prevent abuse through rapid component interactions
  - **Permission Checks**: Verify user permissions before executing component actions
  - **Custom ID Encryption**: Encrypt sensitive data in component custom IDs

**T3. Performance & Scalability**

- Implement request queuing to prevent API flooding
- Use database to track user requests for audit purposes
- Implement intelligent caching strategy:
  - Cache static metadata to reduce external API calls
  - Always fetch current data for operational queries (availability, status, queue)
  - Use cache invalidation for critical updates
- Async processing for long-running operations

**T4. Data Management**

- Store user request history for audit trails
- Implement comprehensive audit logging for all actions
- Use existing SQLite database infrastructure

### 4.3 User Interface Design

**Interactive Components:**
The interface uses Discord's native interactive components including buttons, select menus, and modals to create an intuitive user experience.

**Key Design Principles:**
- **Progressive Disclosure**: Present basic options first, with advanced features available on demand
- **Context-Aware Actions**: Buttons and options adapt based on media availability and user selections
- **Modal-Based Complex Input**: TV show requests use text input modals for flexible season/episode specification (S1, S2E5, S3E1-10)

**User Workflows:**
- **Search → Discover → Request**: Users can search, view details, and request content in a seamless flow
- **Library → Manage → Share**: Browse library, view details, and share or manage content
- **Status Tracking**: Interactive progress updates from request to completion


## 5. User Stories

### Essential User Stories:

**US1**: As a Discord user, I want to search for movies and TV shows so that I can discover new content to watch.

- **Acceptance Criteria**:
  - Search returns relevant results within 3 seconds
  - Results show key information at a glance
  - Clear indication of availability status
  - Pagination controls work correctly
  - Search returns both movies and TV shows in unified results

**US2**: As a Discord user, I want to request a movie download so that I can watch it later on Emby.

- **Acceptance Criteria**:
  - Single command opens confirmation modal
  - User can review movie details before confirming
  - Immediate feedback on request status after confirmation
  - Notification when download completes
  - Interactive status updates show progress from queued → downloading → completed

**US3**: As a Discord user, I want to check if a specific movie or TV show is already available so that I don't request duplicates.

- **Acceptance Criteria**:
  - Quick lookup by title
  - Shows quality/version if multiple exist
  - Direct link to Emby if available
  - For TV shows: Shows partial availability (e.g., "3/5 seasons available")
  - Contextual buttons change based on availability status

**US3a**: As a Discord user with partially downloaded TV shows, I want to request missing episodes so that I can complete my collection.

- **Acceptance Criteria**:
  - Request button visible for TV shows with missing episodes
  - Modal shows which seasons/episodes are already available
  - Can request specific missing episodes or seasons
  - Text input accepts flexible format (S1, S2E5, S3E1-10)
  - Clear feedback on what will be downloaded

**US4**: As a server member, I want to browse the available media library so that I can discover content I didn't know was available.

- **Acceptance Criteria**:
  - Paginated list view with navigation controls
  - Alphabetically sorted content
  - Shows both movies and TV shows together
  - Search within library filters results
  - Action buttons for info, play, link, and delete operations

**US5**: As a Discord user, I want to get a shareable Emby link so that I can invite friends to watch together.

- **Acceptance Criteria**:
  - Generate link with one command
  - Link opens Emby web interface for the specific media
  - Link includes media title for context
  - Support for temporary links with expiration options

**US6**: As a user, I want to manage the media library through Discord so that I can maintain content quality without accessing multiple interfaces.

- **Acceptance Criteria**:
  - Delete content with confirmation prompt
  - View storage information
  - See request history
  - Storage impact calculator for deletions


## 6. Command Structure & Examples

### 6.1 Search Command

```
/media search query:"The Matrix"
```

**Response**: Paginated embed with movie results, showing title, year, poster, and availability status

### 6.2 Request Command

```
/media request movie media_id:1234
/media request tv media_id:5678
```

**Response**: Opens confirmation modal for user to review and confirm the request

### 6.3 Library Browse/Search

```
# Search within library
/media library query:"comedy"

# Browse all library content
/media library
```

**Response**: List of library content (filtered by query if provided)

## 7. Implementation Notes

### 7.1 Performance Goals

- **Command Success Rate**: >95% successful command executions
- **API Response Time**: <2 seconds for 95th percentile

### 7.2 Efficiency Goals

- **Time to Request**: Reduce average time from search to request from 5 minutes to 30 seconds
- **Duplicate Requests**: Reduce duplicate download requests by 90%
- **Web Interface Usage**: 70% reduction in direct Sonarr/Radarr web access


## 8. Security & User Management

### 8.1 User Identification

- **Discord Integration**: Identify users by Discord ID for audit purposes
- **User Tracking**: Track username and avatar for better UX
- **Equal Access**: All Discord users have full access to all features

### 8.2 Data Protection

- **Secure API Keys**: Store external service credentials in environment variables
- **Comprehensive Audit Logging**: Track all user actions (requests, deletions, searches)
- **Privacy Compliance**: No sensitive user data stored beyond Discord identifiers

### 8.3 Content Management

- **Duplicate Detection**: Prevent multiple requests for same content
- **Confirmation Prompts**: Require confirmation for destructive actions (delete)
- **Request History**: Maintain complete audit trail for accountability

---

This PRD provides a comprehensive roadmap for implementing the Discord media management feature. The phased approach allows for iterative development while maintaining focus on core user needs and system reliability.
