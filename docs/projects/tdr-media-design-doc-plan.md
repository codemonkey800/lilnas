# TDR Media Design Document Creation Plan

## Overview

This plan outlines the creation of a comprehensive engineering design document for the Discord Media Management Feature in TDR-Bot. The document provides technical implementation details for a personal homelab media management system, covering architecture, API integrations, data models, and implementation patterns optimized for friends and personal use rather than business deployment.

## Project Context Transformation

**From Business to Homelab Context:** The project has been transformed from its original business-focused implementation to a personal homelab system designed for use among friends and personal media consumption. This transformation affects all aspects of planning, from performance targets to security considerations.

**Code Reduction Strategy:** The documentation approach has shifted from detailed implementation examples to interface-focused architectural design. This reduces code verbosity by approximately 77% while maintaining architectural clarity through well-defined TypeScript interfaces and clear implementation contracts.

**Rate Limiting Removal:** All rate limiting and throttling mechanisms have been removed from the architecture as inappropriate for personal homelab usage among friends, simplifying the implementation significantly.

## Current Progress Summary

**Completion Status: ~18-20% Complete**

✅ **COMPLETED SECTIONS (3/16):**
- Section 1: Executive Summary - **FULLY COMPLETE** (Transformed from business to homelab context)
- Section 2: System Architecture - **FULLY COMPLETE** 
- Section 3: Discord Command Structure - **FULLY COMPLETE** (Sections 3.7 & 3.8 transformed with 77% code reduction using interface-focused approach)

🔄 **REMAINING SECTIONS (13/16):**
- Section 4: Service Layer Design - **NEEDS RECREATION** (requires rework with homelab context)
- Sections 5-16 require completion for full implementation readiness

**Quality Note:** The completed sections provide a solid architectural foundation with comprehensive technical detail, proper Mermaid diagrams, TypeScript interfaces, and clear implementation patterns optimized for personal homelab deployment. Code verbosity has been significantly reduced in favor of interface-focused architectural documentation.

**Code Reduction Implementation:** Sections 3.7 & 3.8 successfully demonstrate the new interface-focused documentation strategy, achieving 77% code reduction while maintaining architectural clarity through well-defined TypeScript interfaces and clear implementation contracts. This approach prioritizes architectural intent over implementation detail.

## Prerequisites

- [x] Read PRD document (`/docs/projects/tdr-media-prd.md`) - **Note:** PRD contains business context; implementation adapted for homelab use
- [x] Analyze TDR-Bot codebase structure
- [x] Research Sonarr/Radarr API documentation
- [x] Review Emby SDK structure
- [x] Transform business requirements to homelab-appropriate functionality
- [x] Establish interface-focused documentation approach

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
    private readonly embyClient: EmbyClient
  ) {}
}
```

#### Discord Interaction Components

- Button custom IDs: `action_mediaType_mediaId_context_page`
- Select menu for dropdown selections
- Modal for TV show episode selection
- Embed for rich media display

## Document Structure & Tasks

### Section 1: Executive Summary ✅ COMPLETE

- [x] Write executive summary of the technical approach (homelab-focused)
- [x] Define technology stack and key architectural decisions
- [x] Outline integration strategy with existing TDR-Bot infrastructure
- [x] Document scope and technical constraints (personal homelab context)
- [x] Include API integration overview
- [x] Transform from business context to personal homelab project

**Notes:** Comprehensive executive summary completed with homelab-focused context, personal use case optimization, and clear technical approach suitable for Discord communities of friends rather than business deployment. Successfully transformed from business-oriented content to personal infrastructure focus.

### Section 2: System Architecture ✅ COMPLETE

- [x] Create high-level architecture diagram (Mermaid)
- [x] Define layered architecture (Discord → Service → Integration → Data)
- [x] Document component relationships and responsibilities
- [x] Design API gateway pattern for external services
- [x] Define service boundaries and interfaces
- [x] Show data flow between Sonarr, Radarr, and Emby

**Notes:** Full architectural design with detailed Mermaid diagrams, clear layered architecture, and comprehensive component documentation.

### Section 3: Discord Command Structure ✅ COMPLETE

- [x] Design slash command hierarchy (`/media` with subcommands)
- [x] Define command options and parameters using Necord decorators
- [x] Create command DTOs for type safety
- [x] Design permission and validation patterns
- [x] Document command routing and handling flow
- [x] Example implementations based on existing commands
- [x] Apply 77% code reduction to sections 3.7 & 3.8 (interface-focused approach)
- [x] Transform detailed implementations to architectural descriptions

**Notes:** Comprehensive command structure design completed with detailed TypeScript interfaces, Necord patterns, validation schemas, and component integration patterns. Includes 8 detailed subsections covering command architecture, hierarchy, DTOs, permissions, routing, interaction components, and error handling. Sections 3.7 & 3.8 successfully implement the new interface-focused approach with 77% code reduction while maintaining architectural clarity through well-defined contracts and implementation patterns.

### Section 4: Service Layer Design ❌ NEEDS RECREATION

- [ ] Design MediaService interface and implementation
- [ ] Design SearchService for unified search across Sonarr/Radarr
- [ ] Design RequestService for download management
- [ ] Design LibraryService for media browsing
- [ ] Design StatusService for tracking downloads
- [ ] Define service dependency injection patterns
- [ ] Include error handling and logging

**Notes:** Section was previously complete but changes were undone. Requires recreation with updated approach using interface-focused documentation and homelab context.

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
- [ ] Define API request/response models through TypeScript interfaces
- [ ] Design retry and circuit breaker patterns appropriate for homelab deployment
- [ ] Design error handling and fallback strategies for personal infrastructure

**Note:** Focus on interface definitions and architectural contracts rather than detailed implementation code.

### Section 6: Data Models

- [ ] Define MediaItem interface (movies and TV shows)
- [ ] Design SearchResult model with pagination
- [ ] Create RequestRecord for basic logging (homelab-appropriate)
- [ ] Design TVShowAvailability model (season/episode tracking)
- [ ] Define ComponentState for in-memory Discord interaction management
- [ ] Create component state models for temporary memory storage
- [ ] Map external API responses to internal models through TypeScript interfaces

**Note:** Focus on clear interface definitions and type safety rather than detailed implementation. Logging simplified for homelab use.

### Section 7: Discord Interaction Layer

- [ ] Design custom ID encoding strategy: `action_mediaType_mediaId_context_page`
- [ ] Define component builder interfaces for buttons/dropdowns
- [ ] Design modal interfaces for TV show episode input (S1, S2E5, etc.)
- [ ] Define pagination component patterns through interfaces
- [ ] Design interaction collector and handler interfaces
- [ ] Define context-aware component state management contracts
- [ ] Design component timeout handling (15 minutes)

**Note:** Emphasize interface design and architectural patterns rather than detailed implementation code.

### Section 8: State Management

- [ ] Design in-memory state service interface using Maps and setTimeout
- [ ] Define component state storage patterns in memory
- [ ] Design state persistence interfaces for multi-step workflows using temporary memory storage
- [ ] Design automatic state cleanup mechanisms for expired components (15-minute timeout)
- [ ] Define session management interfaces for Discord interactions without database dependency
- [ ] Document in-memory state management approach vs. direct API calls

**Note:** Focus on architectural contracts for state management rather than implementation details. Suitable for homelab memory constraints.

### Section 9: Advanced State Management

- [ ] Design component state patterns in memory using JavaScript Maps
- [ ] Implement session management for multi-step workflows with automatic cleanup
- [ ] Design state cleanup mechanisms using setTimeout and garbage collection
- [ ] Create state recovery patterns for process restarts (graceful degradation)
- [ ] Define state transition diagrams for in-memory workflows
- [ ] Handle concurrent user interactions with memory-safe patterns

### Section 10: Error Handling & Resilience

- [ ] Design error classification system
- [ ] Implement retry strategies with exponential backoff
- [ ] Design circuit breaker implementation
- [ ] Create graceful degradation patterns
- [ ] Define user-friendly error messages
- [ ] Design logging and monitoring strategy
- [ ] Handle API timeout scenarios

**Note:** Rate limiting has been completely removed from the architecture as inappropriate for personal homelab use.

### Section 11: Security & Audit

- [ ] Design API key management (environment variables)
- [ ] Implement input validation schemas (Zod)
- [ ] Create audit logging structure (structured logging only, no database)
- [ ] Define simple permission patterns for friends/homelab users
- [ ] Design data sanitization strategies
- [ ] Track user actions by Discord ID in memory

**Note:** Security focuses on homelab environment protection rather than enterprise-grade access control.

### Section 12: Performance Optimization

- [ ] Implement lazy loading patterns
- [ ] Create in-memory state optimization strategies
- [ ] Design batch processing for bulk operations
- [ ] Define performance metrics appropriate for homelab deployment
- [ ] Implement request debouncing and memory cleanup patterns

**Note:** Performance optimization targets personal homelab constraints rather than business scalability requirements. Rate limiting removed as inappropriate for friends-based usage.

### Section 13: Testing Strategy

- [ ] Design unit test patterns for services (homelab-appropriate scope)
- [ ] Define integration test approach for API clients
- [ ] Design Discord interaction testing strategy
- [ ] Define mock service interfaces for development
- [ ] Design test data factory interfaces
- [ ] Reference existing test patterns from TDR-Bot

**Note:** Testing strategy appropriate for personal homelab project rather than enterprise deployment. Focus on interface design for testability.

### Section 14: Implementation Roadmap

- [ ] Define development phases for personal homelab:
  1. Core search functionality
  2. Request/download management
  3. Library browsing
  4. Advanced features for friends/personal use
- [ ] Create milestone definitions for personal project goals
- [ ] Design simple feature toggles for homelab testing
- [ ] Document homelab deployment strategy
- [ ] Create basic monitoring appropriate for personal infrastructure

### Section 15: Code Examples

- [ ] Provide interface-focused architectural examples (reduced code verbosity approach)
- [ ] Show service interface definitions with clear contracts
- [ ] Demonstrate API client patterns through TypeScript interfaces
- [ ] Include Discord component architectural patterns
- [ ] Show error handling strategies through interface design
- [ ] Provide in-memory state management architectural contracts

**Note:** Code examples focus on architectural interfaces rather than detailed implementation, following the 77% code reduction approach demonstrated in sections 3.7 & 3.8.

### Section 16: Visual Documentation

- [ ] System architecture diagram
- [ ] Search workflow sequence diagram
- [ ] Component state flow diagram
- [ ] Request lifecycle diagram
- [ ] State management diagram
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
- **Apply homelab context** throughout all sections
- **Use interface-focused approach** for code reduction
- **Remove business metrics** and replace with homelab-appropriate goals

### Code Style Guidelines

- Use TypeScript with strict typing
- Follow NestJS/Necord patterns from existing codebase
- Use dependency injection consistently
- Implement proper error handling
- Add JSDoc comments for interfaces
- Follow existing import patterns
- **Interface-Focused Documentation:** Prioritize architectural contracts over detailed implementation code
- **Code Reduction Approach:** Use clear interfaces and type definitions rather than extensive code examples
- **Homelab Context:** Design patterns appropriate for personal infrastructure rather than enterprise deployment

### File Output

- Save to: `/home/jeremy/dev/lilnas-tdr-media/docs/projects/tdr-media-design-doc.md`
- Use proper markdown formatting
- Include table of contents
- Add cross-references between sections
- Include code syntax highlighting

## Progress Tracking

Use this checklist to track completion. Mark items with [x] when complete.

**Transformation Status:**
- [x] **Section 1:** Successfully transformed from business executive summary to homelab project overview
- [x] **Section 3.7 & 3.8:** Successfully reduced code verbosity by 77% using interface-focused approach
- [x] **Rate Limiting:** Completely removed from architecture (verified across all documents)
- [x] **Plan Document:** Updated to reflect homelab context and code reduction approach
- [x] **Cross-references:** Updated table of contents and internal navigation
- [ ] **Remaining Sections:** Need homelab context applied during completion

## Notes for AI Agents

**Primary Approach:**
- Focus on one section at a time to manage context
- **Apply homelab context:** Design for personal use among friends, not business deployment
- **Use interface-focused documentation:** Prioritize TypeScript interfaces and architectural contracts over detailed implementation code
- **Remove business elements:** No enterprise metrics, KPIs, or commercial considerations

**Technical Guidelines:**
- Reference the PRD for requirements but adapt to homelab context
- Use existing TDR-Bot patterns as templates
- Include architectural clarity through well-defined interfaces
- Use the API endpoint information provided above
- Consider error scenarios appropriate for homelab deployment (not enterprise-grade)
- Design for Discord interactions among friends and personal use
- **Code Reduction Target:** Follow the 77% code reduction approach demonstrated in sections 3.7 & 3.8

**Context Reminders:**
- This is a **personal homelab project**, not a business system
- Users are **friends and personal contacts**, not enterprise customers
- Performance targets are **homelab-appropriate**, not business KPIs
- Security is **homelab-focused**, not enterprise-grade
- **Rate limiting has been removed** - do not include in any sections

## Key Implementation Considerations

### Discord Interaction Limits

- Component custom IDs: max 100 characters
- Button labels: max 80 characters
- Select menu options: max 25 options
- Embed descriptions: max 4096 characters
- Total embed size: max 6000 characters

### Implementation Philosophy

**Interface-First Design:** Each section should prioritize clear TypeScript interfaces and architectural contracts over detailed implementation code. This approach reduces documentation verbosity while maintaining technical clarity.

**Homelab Context:** All design decisions should account for personal homelab constraints, friend-based usage patterns, and simplified operational requirements rather than enterprise scalability.

**Code Reduction Strategy:** Target ~75% reduction in code examples compared to traditional implementation documentation, focusing on architectural intent through interfaces rather than implementation details.

## Transformation Summary

**Completed Transformations:**

1. **Section 1 Context Change:** Transformed from business executive summary to personal homelab project overview, removing business KPIs and commercial considerations

2. **Code Reduction Implementation:** Sections 3.7 & 3.8 demonstrate the new interface-focused approach with 77% code reduction while maintaining architectural clarity

3. **Rate Limiting Removal:** Complete removal of rate limiting architecture from all sections as inappropriate for personal homelab use among friends

4. **Plan Document Updates:** All planning elements updated to reflect homelab context, performance targets adjusted for personal infrastructure, and business metrics replaced with user experience goals

5. **Documentation Approach:** Shifted from implementation-heavy documentation to interface-focused architectural design throughout all section planning

**Remaining Work:** Sections 4-16 need completion using the established homelab context and interface-focused approach, with consistent application of the code reduction strategy demonstrated in the completed sections.

### Homelab Performance Targets

- Command reliability: Stable operation for personal Discord community
- API response time: Reasonable response times accounting for homelab network constraints
- User experience: Smooth operation for friends and personal use cases

**Note:** Performance targets focus on user experience quality rather than business KPIs, accounting for typical homelab infrastructure limitations.