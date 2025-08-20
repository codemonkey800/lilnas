# TDR Media Implementation TODO List

This document provides a production-ready TODO list for implementing the Discord Media Management feature in tdr-bot. Tasks are organized by implementation phases with clear dependencies, realistic timelines, and focused on homelab integration.

**Timeline**: 25 days total (production-ready homelab solution with focused reliability and practical observability)  
**Architecture**: NestJS + Discord.js v14 + API-First Approach (Sonarr/Radarr/Emby APIs)  
**Approach**: Leverages existing APIs with practical logging, retry patterns, and basic state management

## Progress Overview

- [x] **Phase 1: Foundation & API Integration** (6 days) - COMPLETED
- [ ] **Phase 2: Core Interactive Features** (6 days)  
- [ ] **Phase 3: Advanced Features & Reliability** (5 days)
- [ ] **Phase 4: Performance & Storage** (3 days)
- [ ] **Phase 5: Testing & Production** (5 days)

---

## Phase 1: Foundation & API Integration (6 days)

**Objective**: Establish robust foundation with API integration, Discord.js v14 components, and lilnas ecosystem integration.  
**Dependencies**: None (foundation phase)  
**Focus**: API-first approach leveraging existing Sonarr/Radarr/Emby queue status endpoints

### 1.1 Project Structure & Architecture Setup (Day 1)

- [x] **1.1.1** Create media module directory structure (all subdirectories under `packages/tdr-bot/src/media/`)
  - [x] Create services/, clients/, commands/, validation/, interfaces/, components/ directories

- [x] **1.1.2** Define core interfaces and types
  - [x] Create media domain interfaces (MediaItem, MovieItem, SeriesItem, MediaRequest, QualityProfile)
  - [x] Create Discord interaction interfaces (ComponentState, DiscordComponents, CorrelationContext)
  - [x] Create enums (MediaType, MediaStatusType, DiscordErrorCodes)

### 1.2 Discord Integration & Error Handling (Day 2)

- [x] **1.2.1** Discord.js v14 component setup
  - [x] Create `components/action-row.builder.ts` using ActionRowBuilder
  - [x] Create `components/select-menu.builder.ts` using StringSelectMenuBuilder
  - [x] Create `components/button.builder.ts` using ButtonBuilder
  - [x] Create `components/modal.builder.ts` using ModalBuilder and TextInputBuilder
  - [x] Set up component collector patterns with timeout handling

- [x] **1.2.2** Comprehensive error handling and logging framework
  - [x] Create `services/discord-error.service.ts` with all Discord error codes (10062, 40060, 50013)
  - [x] Implement rate limiting with exponential backoff (1s, 2s, 4s, max 30s)
  - [x] Add structured logging with correlation IDs throughout
  - [x] Create fallback mechanisms for expired interactions

### 1.3 API Clients Implementation (Days 3-4)

- [x] **1.3.1** Create BaseMediaApiClient with comprehensive error handling
  - [x] Implement abstract base class with retry logic (3 attempts, exponential backoff) 
  - [x] Implement timeout management (Sonarr: 30s, Radarr: 30s, Emby: 30s)
  - [x] Add authentication header management (X-Api-Key, X-Emby-Token, api_key)
  - [x] Implement correlation ID propagation for all API calls
  - [x] Add request/response logging with correlation context
  - [x] Handle error responses (401 Unauthorized, 429 Rate Limited, 503 Unavailable)

- [x] **1.3.2** Implement API clients (SonarrClient, RadarrClient, EmbyClient)
  - [x] Create all three clients extending BaseMediaApiClient
  - [x] Implement search methods (searchSeries, searchMovies, searchLibrary)
  - [x] Implement add methods (addSeries, addMovie) with exact API endpoints
  - [x] Implement queue status consumption with rich field mapping:
    - [x] Map percentage, timeleft, eta, size, sizeleft from queue responses
    - [x] Map downloadId, indexer, priority, outputPath fields
  - [x] Add quality profile retrieval for Sonarr/Radarr
  - [x] Implement Emby playback link generation

- [x] **1.3.3** Implement exact API request patterns from design document
  - [x] Build request methods with proper headers and authentication
  - [x] Parse responses according to design doc JSON structures (sections 4.4-4.6)
  - [x] Validate request bodies for POST endpoints

### 1.4 Core Services & Validation (Day 5)

- [x] **1.4.1** Create ValidationService
  - [x] Create `validation/schemas.ts` with Zod schemas (implemented as request-validation.schemas.ts)
  - [x] Implement MediaSearchQuerySchema with basic security validation
  - [x] Implement MediaRequestSchema with business rule validation (SonarrSeriesRequestSchema, RadarrMovieRequestSchema)
  - [x] Create SeasonEpisodeSchema for episode range parsing (EpisodeSpecificationSchema)
  - [x] Add basic validation error messaging (RequestValidationUtils class)

- [x] **1.4.2** Create MediaService orchestration layer
  - [x] Create configuration validation service with dependency injection (MediaConfigValidationService)
  - [x] Implement service configuration with correlation context support
  - [x] Use comprehensive configuration validation with graceful degradation
  - [x] Implement correlation ID validation and propagation (UUID v4)

- [x] **1.4.3** Create MediaModule with EventEmitter2 integration
  - [x] Create `media.module.ts` with NestJS module configuration
  - [x] Configure dependency injection and environment validation (MediaConfigValidationService)
  - [x] Set up lilnas environment integration (SONARR_URL, RADARR_URL, EMBY_URL)
  - [x] Integrate media clients with proper service registration
  - [x] Create comprehensive module export structure for cross-module usage

---

## Phase 2: Core Interactive Features (6 days)

**Objective**: Implement interactive Discord components, basic state management, and complete command functionality for homelab use.  
**Dependencies**: Phase 1 complete  
**Focus**: Discord.js v14 components with collector patterns and user interaction flows

### 2.1 Component State Management (Days 1-2)

- [ ] **2.1.1** Create ComponentStateService with cleanup and recovery
  - [ ] Create `services/component-state.service.ts` with Map-based state tracking
  - [ ] Implement 15-minute TTL with grace period warnings (2-minute warning)
  - [ ] Add user interaction limits (5 concurrent per user, 10 global)
  - [ ] Implement cleanup process with collector deactivation
  - [ ] Add memory threshold monitoring (100MB max)
  - [ ] Implement 2-attempt recovery strategy for failed collectors

### 2.2 Interactive Components (Days 3-4)

- [ ] **2.2.1** Implement all Discord component builders
  - [ ] Create search dropdown with pagination (10 items per page per design doc)
  - [ ] Implement action button system with context-aware generation
  - [ ] Create modal forms for requests (Movie vs Series differences)
  - [ ] Add Discord constraint validation (5 ActionRows, 5 components per row)
  - [ ] Implement text truncation for 100-character limits
  - [ ] Add graceful degradation for constraint violations

### 2.3 Discord Command Implementation (Days 5-6)

- [ ] **2.3.1** Implement all Discord slash commands
  - [ ] `/media search` - Search with interactive dropdowns and action buttons
  - [ ] `/media request` - Modal forms with quality and episode selection
  - [ ] `/media library` - Browse with pagination and deletion
  - [ ] `/media status` - Queue monitoring with progress display
  - [ ] `/media link` - Emby playback link generation


---

## Phase 3: Advanced Features & Reliability (5 days)

**Objective**: Implement Emby linking, episode specification parsing, basic caching, and reliable error handling.  
**Dependencies**: Phase 2 complete  
**Focus**: Practical homelab features with robust but simple implementations

### 3.1 Emby Integration (Days 1-2)

- [ ] **3.1.1** EmbyLinkService and `/media link` command
  - [ ] Create `services/emby-link.service.ts` for deep link generation
  - [ ] Implement playback link format: `emby.lilnas.io/web/index.html#!/item?id={itemId}`
  - [ ] Add rich Discord embeds with metadata and thumbnails
  - [ ] Implement availability verification and error handling

- [ ] **3.1.3** Enhanced progress tracking
  - [ ] Create `services/download-monitor.service.ts` for queue monitoring
  - [ ] Implement queue API consumption from Sonarr/Radarr
  - [ ] Add progress formatting with ETA calculations and progress bars
  - [ ] Create status change detection and user notifications
  - [ ] Add download speed and time remaining display

### 3.2 Episode Specification Service (Days 3-4)

- [ ] **3.2.1** Episode parsing foundation
  - [ ] Create `services/episode-specification.service.ts` with regex-based parsing
  - [ ] Implement episode range parsing using patterns:
    - [ ] `S1` (entire season 1)
    - [ ] `S2E5` (season 2, episode 5)
    - [ ] `S3E1-10` (season 3, episodes 1-10)
    - [ ] `S1-3` (seasons 1 through 3)
  - [ ] Add episode count calculation for ranges
  - [ ] Create validation for episode specifications

- [ ] **3.2.2** Episode specification integration
  - [ ] Integrate episode parsing with Sonarr series requests
  - [ ] Add episode monitoring configuration (monitor specific episodes vs full season)
  - [ ] Create episode specification display in request confirmations
  - [ ] Implement episode validation against available seasons
  - [ ] Add error handling for invalid episode specifications

### 3.3 Simple Cache Management (Day 4)

- [ ] **3.3.1** Implement comprehensive caching strategy
  - [ ] Create `services/cache.service.ts` with Map-based in-memory cache
  - [ ] Implement TTL management (search: 15min, status: 1min, metadata: 1hr, links: 30min)
  - [ ] Add LRU eviction when cache exceeds 1000 entries
  - [ ] Integrate caching across all API calls and search results
  - [ ] Implement cache invalidation and statistics logging


---

## Phase 4: Performance & Storage (3 days)

**Objective**: Implement basic performance optimization, homelab storage tracking, and system monitoring.  
**Dependencies**: Phase 3 complete  
**Focus**: Single-server optimization and practical storage management

### 4.1 Basic Storage Management (Days 1-2)

- [ ] **4.1.1** StorageService implementation
  - [ ] Create `services/storage.service.ts` for homelab storage tracking
  - [ ] Implement `calculateMediaSize(mediaId, mediaType)` using Sonarr/Radarr APIs
  - [ ] Add `getAvailableSpace()` using Docker volume or filesystem APIs
  - [ ] Implement `calculateDeletionImpact(mediaId)` with basic file size calculation
  - [ ] Create storage space warnings for low disk space (< 10GB free)
  - [ ] Add storage information display in status commands

- [ ] **4.1.2** Storage integration
  - [ ] Integrate storage checks with media request workflows
  - [ ] Add storage space validation before accepting large requests
  - [ ] Create storage information display in `/media status` command
  - [ ] Implement basic storage cleanup suggestions (oldest downloads first)
  - [ ] Add storage space monitoring with simple alerts

### 4.2 Performance Optimization & Monitoring (Day 3)

- [ ] **4.2.1** Implement performance optimization and monitoring
  - [ ] Create request batching service with priority levels (critical, normal, background)
  - [ ] Implement batch window collection (100ms) with error isolation
  - [ ] Add comprehensive monitoring:
    - [ ] Response time tracking (target: search <3s, status <1s)
    - [ ] Memory usage monitoring with 100MB threshold
    - [ ] Service availability indicators
    - [ ] Health check endpoints with metrics
  - [ ] Create performance baseline documentation

---

## Phase 5: Testing & Production (5 days)

**Objective**: Complete testing suite, basic health monitoring, and lilnas ecosystem deployment.  
**Dependencies**: Phase 4 complete  
**Focus**: Production-ready homelab deployment with lilnas integration

### 5.1 Testing Suite (Days 1-2)

- [ ] **5.1.1** Implement comprehensive testing (80% coverage target)
  - [ ] Unit tests for critical services (MediaService, ValidationService, API clients)
  - [ ] Integration tests for complete user workflows (search → request → status)
  - [ ] Performance tests for memory management and component cleanup
  - [ ] Concurrent user testing (5-10 simultaneous users)
  - [ ] Create automated test suite for CI integration

### 5.2 Health Monitoring & Observability (Days 3-4)

- [ ] **5.2.1** Implement health monitoring and observability
  - [ ] Create health monitoring service with 5-minute checks
  - [ ] Implement `/health` and `/health/detailed` endpoints
  - [ ] Add health status levels (HEALTHY, DEGRADED, RECOVERED, FAILED)
  - [ ] Include performance metrics in health responses
  - [ ] Implement structured logging with correlation IDs (already setup in Phase 1)
  - [ ] Add audit logging for security monitoring

### 5.3 Production Configuration & Deployment (Day 5)

- [ ] **5.3.1** Lilnas environment configuration
  - [ ] Create production environment variable documentation
  - [ ] Set up configuration validation using Zod schemas
  - [ ] Add lilnas-specific environment variables (SONARR_URL, RADARR_URL, EMBY_URL)
  - [ ] Create deployment configuration for lilnas ecosystem
  - [ ] Implement environment variable validation on startup
  - [ ] Add configuration testing and validation

- [ ] **5.3.2** Documentation and procedures
  - [ ] Document all Discord commands with usage examples
  - [ ] Create deployment procedures using `./lilnas redeploy tdr-bot`
  - [ ] Add basic troubleshooting guide for common issues
  - [ ] Create operational procedures for lilnas environment
  - [ ] Document configuration and environment setup
  - [ ] Create user guide for Discord commands

- [ ] **5.3.3** Lilnas deployment and validation
  - [ ] Deploy using lilnas deployment patterns (`./lilnas redeploy tdr-bot --rebuild-base`)
  - [ ] Validate environment configuration with lilnas services
  - [ ] Test health endpoints in production environment
  - [ ] Verify service integration with lilnas Traefik routing
  - [ ] Conduct basic production readiness validation
  - [ ] Create post-deployment monitoring checklist

### 5.4 Final Production Validation (Day 5 continuation)

- [ ] **5.4.1** Complete production validation and handover
  - [ ] Test all workflows in production environment
  - [ ] Verify performance meets requirements (search <3s, status <1s)
  - [ ] Validate health monitoring and logging with correlation IDs
  - [ ] Monitor system for initial 24 hours
  - [ ] Complete documentation and maintenance procedures

---

## Success Criteria

### Phase 1: Foundation & API Integration
- [x] Discord commands respond correctly with basic functionality
- [x] External API integration working with proper error handling and exact endpoint patterns
- [x] Input validation prevents malformed requests and basic security issues
- [x] **API request patterns match design document specifications exactly**
- [x] **Discord component constraints properly validated and enforced**
- [x] **Basic structured logging with correlation IDs provides operational visibility**
- [x] **EventEmitter2 integration enables cross-module communication**

### Phase 2: Core Interactive Features  
- [ ] Interactive components complete user workflows successfully
- [ ] Component state management prevents memory leaks with cleanup
- [ ] **Component timeout handling provides basic user notifications**
- [ ] **Basic rate limiting prevents Discord API violations**
- [ ] **Discord component limits properly enforced (ActionRows, components per row)**
- [ ] Command interactions work reliably with multiple concurrent users (5-8)
- [ ] **Correlation IDs track interactions through entire workflow**

### Phase 3: Advanced Features & Reliability
- [ ] Emby link generation works for available media in homelab
- [ ] Episode specification parsing handles common patterns (S1, S2E5, ranges)
- [ ] Basic cache management improves response times
- [ ] **Basic retry logic with 3-attempt limits prevents service failures**
- [ ] **Simple graceful degradation maintains functionality with partial service outages**
- [ ] **Service isolation ensures single API failure doesn't break entire system**

### Phase 4: Performance & Storage
- [ ] Storage tracking provides useful homelab storage information
- [ ] Performance meets homelab requirements (search: <3s, status: <1s)
- [ ] System works reliably with multiple concurrent users (5-10)
- [ ] Storage management provides basic space monitoring and warnings
- [ ] **Request batching reduces API load and improves performance**

### Phase 5: Testing & Production
- [ ] Critical path test coverage (80% target) for essential functionality
- [ ] Health monitoring provides useful service status information
- [ ] Production deployment successful using lilnas deployment patterns
- [ ] Documentation enables operation and maintenance in lilnas environment
- [ ] Success metrics achieved for homelab Discord bot integration
- [ ] **Correlation ID system enables comprehensive debugging**

---

## Implementation Benefits

**Streamlined Production Architecture**: 25-day timeline delivers robust Discord bot with practical observability, reliability patterns, and homelab integration.

**Practical Observability**: Structured logging with correlation IDs and EventEmitter2 integration provide effective debugging and monitoring for homelab scale.

**Discord API Compliance**: Proper component constraint validation and basic rate limiting prevent Discord API violations and ensure stable operation.

**Reliable State Management**: Simple timeout handling with automatic cleanup and basic user notifications ensure reliable user experiences without complexity overhead.

**Simplified Error Handling**: Basic retry logic with 3-attempt limits and graceful degradation prevent service failures while maintaining simplicity for homelab deployment.

**Episode Specification Support**: Regex-based episode parsing enables common user workflows for season and episode specifications with Sonarr validation integration.

**Efficient Caching**: In-memory cache management with TTL policies and LRU eviction improves performance and reduces external API load for homelab scale.

**Request Batching**: Smart batching of API requests reduces load and improves overall system performance without adding significant complexity.

**API-First Implementation**: Direct consumption of Sonarr/Radarr/Emby queue APIs with exact endpoint patterns from design document ensures reliable integration.

**Comprehensive Tracing**: Correlation IDs throughout the system enable end-to-end request tracking and debugging across all components and external services.

**Event-Driven Architecture**: EventEmitter2 integration enables loose coupling between modules and supports future extensibility.

**Homelab Performance**: Optimized for single-server homelab operation with appropriate resource usage, response time monitoring, and storage management.

**Focused Testing**: Critical path testing with 80% coverage target ensures reliability for production workflows without over-engineering.

**Lilnas Integration**: Seamless integration with lilnas ecosystem using existing deployment patterns, service discovery, and health monitoring endpoints.

**Production Documentation**: Clear documentation, operational procedures, and troubleshooting guides enable professional operation and maintenance within lilnas environment.

---

Use checkboxes to track completion of each task. Update progress regularly and note any blockers or dependencies that arise during implementation.