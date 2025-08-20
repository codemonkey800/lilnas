# BaseMediaApiClient Implementation Guide

This directory contains the complete implementation of the BaseMediaApiClient system for TDR-Bot's media management functionality. The BaseMediaApiClient provides a standardized foundation for interacting with media services (Sonarr, Radarr, Emby) with comprehensive error handling, retry logic, and health monitoring capabilities.

## Architecture Overview

The BaseMediaApiClient follows the Abstract Factory pattern to provide a consistent interface for all media service interactions while allowing service-specific implementations.

```
┌─────────────────────────────────────────────────────────┐
│                BaseMediaApiClient                        │
├─────────────────────────────────────────────────────────┤
│ + HTTP Methods (GET, POST, PUT, DELETE)                 │
│ + Error Handling & Retry Logic                          │
│ + Retry Logic & Performance Monitoring                  │
│ + Health Checks & Diagnostics                           │
│ + Correlation ID Propagation                            │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼──────┐  ┌────────▼──────┐  ┌─────────▼─────┐
│RadarrClient  │  │SonarrClient   │  │EmbyClient     │
├──────────────┤  ├───────────────┤  ├───────────────┤
│Movie Search  │  │Series Search  │  │Library Browse │
│Movie Request │  │Episode Spec   │  │Playback Links │
│Queue Monitor │  │Queue Monitor  │  │Availability   │
└──────────────┘  └───────────────┘  └───────────────┘
```

## Key Components

### 1. BaseMediaApiClient (`base-media-api.client.ts`)

The abstract base class that provides:

- HTTP method implementations with retry logic
- Retry logic with exponential backoff via RetryService
- Comprehensive error handling and mapping
- Health checks and service diagnostics
- Performance monitoring and logging integration
- Correlation ID propagation for distributed tracing

### 2. Configuration Validation (`config/media-config.validation.ts`)

Provides startup validation for:

- Environment variable validation
- URL format and accessibility checks
- API key format validation
- Service-specific configuration requirements
- Clear error messages and remediation guidance

### 3. Example Implementations (`examples/`)

Complete concrete implementations for each service:

- `radarr-client.example.ts` - Movie management with Radarr v3 API
- `sonarr-client.example.ts` - TV series management with episode specification parsing
- `emby-client.example.ts` - Library browsing and playback link generation

### 4. Integration Tests (`__tests__/clients/`)

Comprehensive test suite covering:

- HTTP method functionality
- Error handling scenarios
- Retry logic integration
- Health check operations
- Service diagnostics

## Implementation Guide

### Step 1: Environment Configuration

Set up the required environment variables in your deployment configuration:

```env
# Radarr Configuration
RADARR_URL=http://radarr:7878
RADARR_API_KEY=your-radarr-api-key

# Sonarr Configuration
SONARR_URL=http://sonarr:8989
SONARR_API_KEY=your-sonarr-api-key

# Emby Configuration
EMBY_URL=http://emby:8096
EMBY_API_TOKEN=your-emby-api-token
EMBY_USER_ID=your-emby-user-uuid
```

### Step 2: Service Registration

Register the configuration validation service and clients in your NestJS module:

```typescript
import { Module } from '@nestjs/common'
import { MediaConfigValidationService } from './config/media-config.validation'
import { RadarrClient } from './clients/radarr.client'
import { SonarrClient } from './clients/sonarr.client'
import { EmbyClient } from './clients/emby.client'

@Module({
  providers: [
    MediaConfigValidationService,
    RadarrClient,
    SonarrClient,
    EmbyClient,
  ],
  exports: [
    MediaConfigValidationService,
    RadarrClient,
    SonarrClient,
    EmbyClient,
  ],
})
export class MediaModule {}
```

### Step 3: Implement Concrete Clients

Follow the examples in the `examples/` directory to create your concrete client implementations. Each client must implement the five abstract methods:

```typescript
@Injectable()
export class RadarrClient extends BaseMediaApiClient {
  protected getAuthenticationHeaders(): Record<string, string> {
    return { 'X-Api-Key': this.apiKey }
  }

  protected async validateServiceConfiguration(): Promise<ConnectionTestResult> {
    // Test connectivity and authentication
  }

  protected async getServiceCapabilities(): Promise<ServiceCapabilities> {
    // Return what the service can do
  }

  protected async performHealthCheck(
    correlationId: string,
  ): Promise<HealthCheckResult> {
    // Check service health
  }

  protected getApiEndpoints(): Record<string, string> {
    // Return endpoint mapping
  }

  // Add service-specific methods
  async searchMovies(query: string, correlationId: string): Promise<Movie[]> {
    return this.get(`/api/v3/movie/lookup?term=${query}`, correlationId)
  }
}
```

### Step 4: Service Integration

Use the clients in your services with proper error handling:

```typescript
@Injectable()
export class MediaService {
  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly sonarrClient: SonarrClient,
    private readonly embyClient: EmbyClient,
    private readonly mediaLoggingService: MediaLoggingService,
  ) {}

  async searchMedia(
    query: string,
    correlationId: string,
  ): Promise<MediaResult[]> {
    try {
      const [movies, series, library] = await Promise.allSettled([
        this.radarrClient.searchMovies(query, correlationId),
        this.sonarrClient.searchSeries(query, correlationId),
        this.embyClient.searchLibrary(query, correlationId),
      ])

      return this.mergeSearchResults(movies, series, library)
    } catch (error) {
      this.mediaLoggingService.logError(error, { correlationId })
      throw error
    }
  }

  async runServiceDiagnostics(
    correlationId: string,
  ): Promise<ServiceDiagnostics> {
    const diagnostics = await Promise.allSettled([
      this.radarrClient.runDiagnostics(correlationId),
      this.sonarrClient.runDiagnostics(correlationId),
      this.embyClient.runDiagnostics(correlationId),
    ])

    return this.compileDiagnostics(diagnostics)
  }
}
```

## Error Handling Strategy

The BaseMediaApiClient provides comprehensive error handling with automatic mapping:

| HTTP Status | Error Type                   | Retryable    | Delay              |
| ----------- | ---------------------------- | ------------ | ------------------ |
| 401         | MediaAuthenticationError     | No           | -                  |
| 429         | MediaRateLimitError          | Yes          | Retry-After header |
| 404         | MediaNotFoundApiError        | Limited (1x) | 2 seconds          |
| 400/422     | MediaValidationApiError      | No           | -                  |
| 5xx         | MediaServiceUnavailableError | Yes          | Progressive        |
| Network     | MediaNetworkError            | Yes          | Progressive        |

### Example Error Handling

```typescript
try {
  const movie = await this.radarrClient.addMovie(movieRequest, correlationId)
  return movie
} catch (error) {
  if (error instanceof MediaAuthenticationError) {
    // Handle auth failure - check API key
    throw new Error(
      'Radarr authentication failed. Please check API configuration.',
    )
  } else if (error instanceof MediaRateLimitError) {
    // Handle rate limiting - will be retried automatically
    this.logger.warn(`Radarr rate limited. Retrying in ${error.retryDelayMs}ms`)
  } else if (error instanceof MediaValidationApiError) {
    // Handle validation error - fix request data
    throw new Error(`Invalid movie request: ${error.message}`)
  }

  // Let other errors bubble up for retry handling
  throw error
}
```

## Health Monitoring

The BaseMediaApiClient provides comprehensive health monitoring capabilities:

### Connection Testing

```typescript
const connectionResult = await client.testConnection(correlationId)
if (!connectionResult.canConnect) {
  console.error('Connection failed:', connectionResult.error)
  console.log('Suggestions:', connectionResult.suggestions)
}
```

### Health Checks

```typescript
const healthResult = await client.checkHealth(correlationId)
if (!healthResult.isHealthy) {
  console.error('Service unhealthy:', healthResult.error)
  console.log('Response time:', healthResult.responseTime, 'ms')
}
```

### Full Diagnostics

```typescript
const diagnostics = await client.runDiagnostics(correlationId)
console.log('Service operational:', diagnostics.summary.isOperational)
console.log('Issues found:', diagnostics.summary.issues)
console.log('Recommendations:', diagnostics.summary.recommendations)
```

## Integration with TDR-Bot Services

The BaseMediaApiClient is designed to integrate seamlessly with existing TDR-Bot services:

### RetryService Integration

- Exponential backoff for transient errors
- Configurable retry policies per service
- Automatic failure detection and recovery

### MediaLoggingService Integration

- Structured logging with correlation IDs
- Performance metrics collection
- Error context tracking

### ErrorClassificationService Integration

- Consistent error categorization
- Retry decision making for recoverable errors
- Error severity classification

## Performance Considerations

### Retry Configuration

- Maximum 3 retry attempts
- Exponential backoff: 1s → 2s → 4s
- Service-specific retryable error types

### Timeout Settings

- Default 30-second request timeout
- Configurable per service
- Separate timeout for health checks

## Testing

Run the comprehensive test suite:

```bash
# Run all media client tests
npm test -- --testPathPattern="media.*client"

# Run specific client tests
npm test -- base-media-api.client.test.ts

# Run with coverage
npm test -- --coverage --testPathPattern="media.*client"
```

The test suite covers:

- HTTP method functionality
- Error handling scenarios
- Retry behavior and backoff strategies
- Health check operations
- Service diagnostics
- Configuration validation

## Production Deployment

### Startup Validation

The MediaConfigValidationService automatically validates all configuration on application startup:

```typescript
// This runs automatically during module initialization
const validation = await configService.revalidateConfiguration()
if (!validation.isValid) {
  throw new Error('Media service configuration invalid')
}
```

### Health Check Endpoint

Integrate with your application's health check endpoint:

```typescript
@Controller('health')
export class HealthController {
  async getHealth(): Promise<HealthResponse> {
    const mediaHealth = await Promise.allSettled([
      this.radarrClient.checkHealth(nanoid()),
      this.sonarrClient.checkHealth(nanoid()),
      this.embyClient.checkHealth(nanoid()),
    ])

    return {
      status: this.determineOverallHealth(mediaHealth),
      services: this.formatServiceHealth(mediaHealth),
    }
  }
}
```

### Performance Monitoring

Monitor key metrics in production:

- Response times for each service
- Error rates and types
- Retry attempts and recovery patterns
- Queue status polling efficiency

## Troubleshooting

### Common Issues

1. **Authentication Failures**

   - Verify API keys are correct
   - Check service URLs are accessible
   - Confirm API key permissions

2. **Connection Timeouts**

   - Check network connectivity
   - Verify service containers are running
   - Increase timeout values if needed

3. **Repeated Failures**
   - Check service health and logs
   - Verify API rate limits aren't exceeded
   - Review error patterns in logs

### Debug Logging

Enable debug logging for detailed troubleshooting:

```typescript
// Set LOG_LEVEL=debug in environment
process.env.LOG_LEVEL = 'debug'
```

This will provide detailed logs for:

- HTTP request/response details
- Retry attempts and backoff strategies
- Error recovery patterns
- Performance metrics

## Next Steps

After implementing the BaseMediaApiClient system:

1. **Create Concrete Clients**: Use the examples as templates for your specific needs
2. **Implement Discord Commands**: Build Discord slash commands that use the clients
3. **Add Queue Monitoring**: Implement real-time download progress tracking
4. **Create Health Dashboard**: Build monitoring dashboard using health check data
5. **Optimize Performance**: Tune timeout and retry settings based on production metrics

The BaseMediaApiClient provides a solid foundation for reliable, maintainable media service integration that follows TDR-Bot's architectural patterns and quality standards.
