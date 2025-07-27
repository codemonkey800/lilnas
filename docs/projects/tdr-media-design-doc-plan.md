# TDR Media Design Document Creation Plan

## Overview
This plan outlines the creation of a comprehensive engineering design document for the Discord Media Management Feature in TDR-Bot. The document will translate the PRD requirements into technical implementation details, covering architecture, API integrations, data models, and implementation patterns.

## Prerequisites
- [x] Read PRD document (`/docs/projects/tdr-media-prd.md`)
- [x] Analyze TDR-Bot codebase structure
- [x] Research Sonarr/Radarr API documentation
- [x] Review Emby SDK structure

## API Context and Patterns

### Sonarr API Key Information
- **Base URL**: `http://sonarr:8989/api/v3/`
- **Authentication**: API Key in header (`X-Api-Key`)
- **Key Endpoints**:
  - `/series` - Get all TV shows
  - `/series/lookup?term={query}` - Search for TV shows
  - `/series/{id}` - Get specific series details
  - `/episode?seriesId={id}` - Get episodes for a series
  - `/command` - Queue downloads
  - `/queue` - Monitor download progress
  - `/calendar` - Get upcoming episodes
- **Response Format**: JSON with detailed metadata
- **Error Handling**: JSON-RPC style errors

### Radarr API Key Information
- **Base URL**: `http://radarr:7878/api/v3/`
- **Authentication**: API Key in header (`X-Api-Key`)
- **Key Endpoints**:
  - `/movie` - Get all movies
  - `/movie/lookup?term={query}` - Search for movies
  - `/movie/{id}` - Get specific movie details
  - `/command` - Queue downloads
  - `/queue` - Monitor download progress
  - `/qualityprofile` - Get quality profiles
- **Response Format**: JSON similar to Sonarr
- **Queue Integration**: SABnzbd/NZBGet format

### Emby API Key Information
- **Base URL**: `http://emby:8096/emby/`
- **Authentication**: API Key in query params
- **Key Endpoints**:
  - `/Items` - Query media library (extensive filtering)
  - `/Items/{id}` - Get specific item details
  - `/Items/{id}/PlaybackInfo` - Get streaming URLs
  - `/Users` - User management
  - `/Sessions` - Active sessions
- **Query Parameters**: 
  - `IncludeItemTypes` (Movie, Series, Episode)
  - `SearchTerm` for fuzzy search
  - `StartIndex` and `Limit` for pagination
  - `Fields` for additional metadata
- **Web URL Pattern**: `http://emby:8096/web/#!/item?id={itemId}`

### TDR-Bot Code Patterns

#### Slash Command Pattern (Necord)
```typescript
@Injectable()
export class MediaCommands {
  @SlashCommand({
    name: 'media',
    description: 'Media management commands',
  })
  async onMedia(@Context() [interaction]: SlashCommandContext) {
    // Command logic
  }
}
```

#### Service Pattern (NestJS)
```typescript
@Injectable()
export class MediaService {
  constructor(
    private readonly sonarrClient: SonarrClient,
    private readonly radarrClient: RadarrClient,
    private readonly embyClient: EmbyClient,
  ) {}
}
```

#### Discord Interaction Components
- Button custom IDs: `action_mediaType_mediaId_context_page`
- Select menu for dropdown selections
- Modal for TV show episode selection
- Embed for rich media display

## Document Structure & Tasks

### Section 1: Executive Summary & Introduction
- [x] Write executive summary of the technical approach
- [x] Define technology stack and key architectural decisions
- [x] Outline integration strategy with existing TDR-Bot infrastructure
- [x] Document scope and technical constraints
- [x] Include API integration overview

### Section 2: System Architecture
- [x] Create high-level architecture diagram (Mermaid)
- [x] Define layered architecture (Discord → Service → Integration → Data)
- [x] Document component relationships and responsibilities
- [x] Design API gateway pattern for external services
- [x] Define service boundaries and interfaces
- [x] Show data flow between Sonarr, Radarr, and Emby

### Section 3: Discord Command Structure
- [ ] Design slash command hierarchy (`/media` with subcommands)
- [ ] Define command options and parameters using Necord decorators
- [ ] Create command DTOs for type safety
- [ ] Design permission and validation patterns
- [ ] Document command routing and handling flow
- [ ] Example implementations based on existing commands

### Section 4: Service Layer Design
- [ ] Design MediaService interface and implementation
- [ ] Design SearchService for unified search across Sonarr/Radarr
- [ ] Design RequestService for download management
- [ ] Design LibraryService for media browsing
- [ ] Design StatusService for tracking downloads
- [ ] Define service dependency injection patterns
- [ ] Include error handling and logging

### Section 5: Integration Layer (API Clients)
- [ ] Design SonarrClient interface with key methods:
  - `searchSeries(query: string)`
  - `getSeriesById(id: number)`
  - `getEpisodes(seriesId: number)`
  - `queueDownload(seriesId: number, episodes: number[])`
- [ ] Design RadarrClient interface with key methods:
  - `searchMovies(query: string)`
  - `getMovieById(id: number)`
  - `queueDownload(movieId: number)`
- [ ] Design EmbyClient interface with key methods:
  - `searchItems(query: string, type: MediaType)`
  - `getItemById(id: string)`
  - `generatePlayUrl(itemId: string)`
- [ ] Define API request/response models
- [ ] Implement retry and circuit breaker patterns
- [ ] Design error handling and fallback strategies

### Section 6: Data Models
- [ ] Define MediaItem interface (movies and TV shows)
- [ ] Design SearchResult model with pagination
- [ ] Create RequestRecord for audit logging
- [ ] Design TVShowAvailability model (season/episode tracking)
- [ ] Define ComponentState for Discord interaction persistence
- [ ] Create cache entry models
- [ ] Map external API responses to internal models

### Section 7: Discord Interaction Layer
- [ ] Design custom ID encoding strategy: `action_mediaType_mediaId_context_page`
- [ ] Create button/dropdown component builders
- [ ] Design modal interfaces for TV show episode input (S1, S2E5, etc.)
- [ ] Implement pagination component patterns
- [ ] Define interaction collectors and handlers
- [ ] Design context-aware component state management
- [ ] Handle component timeouts (15 minutes)

### Section 8: Caching Strategy
- [ ] Design Redis cache service interface
- [ ] Define cache keys and TTL configurations:
  - External metadata: 5-15 minutes
  - Never cache: availability, download status, queue
- [ ] Implement cache-aside pattern
- [ ] Design cache invalidation strategies
- [ ] Create cache warming mechanisms
- [ ] Document what to cache vs. fetch fresh

### Section 9: State Management
- [ ] Design component state persistence in Redis
- [ ] Implement session management for multi-step workflows
- [ ] Design state cleanup mechanisms
- [ ] Create state recovery patterns
- [ ] Define state transition diagrams
- [ ] Handle concurrent user interactions

### Section 10: Error Handling & Resilience
- [ ] Design error classification system
- [ ] Implement retry strategies with exponential backoff
- [ ] Design circuit breaker implementation
- [ ] Create graceful degradation patterns
- [ ] Define user-friendly error messages
- [ ] Design logging and monitoring strategy
- [ ] Handle API timeout scenarios

### Section 11: Security & Audit
- [ ] Design API key management (environment variables)
- [ ] Implement input validation schemas (Zod)
- [ ] Design rate limiting per user/command
- [ ] Create audit logging structure (SQLite)
- [ ] Define permission checking patterns
- [ ] Design data sanitization strategies
- [ ] Track user actions by Discord ID

### Section 12: Performance Optimization
- [ ] Design request queuing system
- [ ] Implement lazy loading patterns
- [ ] Create database query optimization strategies
- [ ] Design batch processing for bulk operations
- [ ] Define performance metrics and benchmarks
- [ ] Implement request debouncing

### Section 13: Testing Strategy
- [ ] Design unit test patterns for services
- [ ] Create integration test approach for API clients
- [ ] Define Discord interaction testing strategy
- [ ] Design mock services for development
- [ ] Create test data factories
- [ ] Include existing test patterns from TDR-Bot

### Section 14: Implementation Roadmap
- [ ] Define development phases:
  1. Core search functionality
  2. Request/download management
  3. Library browsing
  4. Advanced features
- [ ] Create milestone definitions
- [ ] Design feature flags for gradual rollout
- [ ] Document deployment strategy
- [ ] Create monitoring and alerting plan

### Section 15: Code Examples
- [ ] Provide example command implementation
- [ ] Show service interface examples
- [ ] Demonstrate API client patterns
- [ ] Include Discord component examples
- [ ] Show error handling examples
- [ ] Provide caching implementation samples

### Section 16: Visual Documentation
- [ ] System architecture diagram
- [ ] Search workflow sequence diagram
- [ ] Component state flow diagram
- [ ] Request lifecycle diagram
- [ ] Cache strategy diagram
- [ ] API integration flow charts

## AI-Friendly Execution Instructions

### For Each Section:
1. **Research Phase**
   - Read relevant parts of the PRD
   - Analyze existing TDR-Bot code patterns
   - Review external API documentation if needed
   - Check API response examples in this document

2. **Design Phase**
   - Create interfaces and type definitions
   - Design patterns that follow NestJS best practices
   - Ensure consistency with existing codebase
   - Use TypeScript strict mode patterns

3. **Documentation Phase**
   - Write clear explanations
   - Include code snippets (TypeScript)
   - Add Mermaid diagrams where applicable
   - Reference PRD requirements

4. **Review Phase**
   - Verify alignment with PRD requirements
   - Check consistency with existing patterns
   - Ensure all dependencies are considered
   - Validate against API capabilities

### Context Management
- After completing each major section (2-3 subsections), save progress
- Clear context before starting new major sections
- Maintain a running summary of key decisions
- Reference this plan document for API details

### Code Style Guidelines
- Use TypeScript with strict typing
- Follow NestJS/Necord patterns from existing codebase
- Use dependency injection consistently
- Implement proper error handling
- Add JSDoc comments for interfaces
- Follow existing import patterns

### File Output
- Save to: `/home/jeremy/lilnas/docs/projects/tdr-media-design-doc.md`
- Use proper markdown formatting
- Include table of contents
- Add cross-references between sections
- Include code syntax highlighting

## Progress Tracking
Use this checklist to track completion. Mark items with [x] when complete.

## Notes for AI Agents
- Focus on one section at a time to manage context
- Reference the PRD for requirements
- Use existing TDR-Bot patterns as templates
- Prioritize clarity and completeness over brevity
- Include practical implementation details
- Use the API endpoint information provided above
- Consider rate limiting and error scenarios
- Think about user experience for Discord interactions

## Key Implementation Considerations

### Discord Interaction Limits
- Component custom IDs: max 100 characters
- Button labels: max 80 characters
- Select menu options: max 25 options
- Embed descriptions: max 4096 characters
- Total embed size: max 6000 characters

### API Rate Limits (Estimated)
- Sonarr/Radarr: ~30 requests/minute
- Emby: ~60 requests/minute
- Implement request queuing to avoid hitting limits

### Performance Goals (from PRD)
- Command success rate: >95%
- API response time: <2 seconds (95th percentile)
- Search to request time: <30 seconds average