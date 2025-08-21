# Media API Clients E2E Tests

Comprehensive end-to-end tests for the media API clients (Sonarr, Radarr, and Emby) with real service integration, performance monitoring, and safety measures.

## Overview

This test suite provides:

- **Connection and Authentication Testing**: Verify API connectivity and credentials
- **Functional Testing**: Test search, browsing, and management operations
- **Performance Testing**: Monitor response times and concurrent request handling
- **Error Handling Testing**: Validate error scenarios and recovery
- **Integration Testing**: Cross-service compatibility and consistency
- **Safety Measures**: Read-only mode and cleanup mechanisms

## Quick Start

### 1. Environment Setup

Copy the example environment file:

```bash
cp .env.e2e.example .env.e2e
```

Edit `.env.e2e` with your actual service configurations:

```bash
# Sonarr Configuration
E2E_SONARR_URL=https://sonarr.lilnas.io
E2E_SONARR_API_KEY=your_actual_sonarr_api_key

# Radarr Configuration
E2E_RADARR_URL=https://radarr.lilnas.io
E2E_RADARR_API_KEY=your_actual_radarr_api_key

# Emby Configuration
E2E_EMBY_URL=https://emby.lilnas.io
E2E_EMBY_API_KEY=your_actual_emby_api_key
E2E_EMBY_USER_ID=your_actual_emby_user_id

# Enable the services you want to test
E2E_TEST_SONARR=true
E2E_TEST_RADARR=true
E2E_TEST_EMBY=true
```

### 2. Running Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run E2E tests in watch mode (development)
pnpm test:e2e:watch

# Run E2E tests for CI (single worker, strict mode)
pnpm test:e2e:ci

# Run specific service tests
pnpm test:e2e --testNamePattern="Sonarr"
pnpm test:e2e --testNamePattern="Radarr"
pnpm test:e2e --testNamePattern="Emby"

# Run integration tests only
pnpm test:e2e --testNamePattern="Integration"
```

## Test Structure

```
src/media/__tests__/e2e/
├── config/
│   └── e2e-config.ts           # Environment configuration and validation
├── utils/
│   ├── client-factory.ts       # Factory functions for creating test clients
│   └── test-setup.ts           # Common setup, cleanup, and utility functions
├── sonarr.e2e.test.ts         # Comprehensive Sonarr API tests
├── radarr.e2e.test.ts         # Comprehensive Radarr API tests
├── emby.e2e.test.ts           # Comprehensive Emby API tests
├── integration.e2e.test.ts    # Cross-service integration tests
├── setup.e2e.ts              # Global E2E test setup
└── README.md                  # This file
```

## Configuration Options

### Service Configuration

| Variable           | Description                  | Required           |
| ------------------ | ---------------------------- | ------------------ |
| `E2E_*_URL`        | Service base URL             | Yes                |
| `E2E_*_API_KEY`    | Service API key              | Yes                |
| `E2E_EMBY_USER_ID` | Emby user ID                 | Yes (Emby only)    |
| `E2E_TEST_*`       | Enable/disable service tests | No (default: true) |

### Test Configuration

| Variable                      | Default | Description                  |
| ----------------------------- | ------- | ---------------------------- |
| `E2E_TEST_TIMEOUT`            | 60000   | Test timeout in milliseconds |
| `E2E_READ_ONLY_MODE`          | true    | Prevent data modifications   |
| `E2E_ALLOW_DESTRUCTIVE_TESTS` | false   | Allow add/delete operations  |
| `E2E_CLEANUP_ENABLED`         | true    | Enable test data cleanup     |
| `E2E_DEBUG_LOGGING`           | false   | Enable verbose logging       |

### Performance Configuration

| Variable                           | Default | Description                      |
| ---------------------------------- | ------- | -------------------------------- |
| `E2E_MAX_RESPONSE_TIME_MS`         | 5000    | Maximum acceptable response time |
| `E2E_MIN_HEALTH_CHECK_INTERVAL_MS` | 10000   | Minimum health check interval    |

## Safety Features

### Read-Only Mode

By default, tests run in read-only mode (`E2E_READ_ONLY_MODE=true`) which:

- Prevents adding/modifying/deleting media items
- Skips destructive test scenarios
- Ensures safe testing against production services

### Destructive Tests

When `E2E_ALLOW_DESTRUCTIVE_TESTS=true`:

- Tests can add/modify/delete media items
- **Use with caution on production services**
- All test data is tagged with unique identifiers
- Automatic cleanup removes test data after each test

### Cleanup Mechanisms

- Automatic cleanup of test data after each test
- Client connection cleanup and resource disposal
- Graceful error handling and recovery
- Test isolation to prevent cross-test contamination

## Test Categories

### Connection Tests

- Service connectivity verification
- Authentication validation
- API version detection
- Health check monitoring

### Functional Tests

- **Sonarr**: TV series search, quality profiles, series management
- **Radarr**: Movie search, quality profiles, movie management
- **Emby**: Library browsing, media search, playback links

### Performance Tests

- Response time monitoring
- Concurrent request handling
- Performance consistency validation
- Load testing scenarios

### Error Handling Tests

- Network timeout scenarios
- Invalid endpoint handling
- Malformed request handling
- Authentication failure scenarios

### Integration Tests

- Cross-service connectivity matrix
- Performance comparison across services
- Error handling consistency
- API version compatibility

## Development Guidelines

### Adding New Tests

1. **Service-Specific Tests**: Add to the appropriate `*.e2e.test.ts` file
2. **Cross-Service Tests**: Add to `integration.e2e.test.ts`
3. **Test Utilities**: Add reusable functions to `utils/test-setup.ts`
4. **Configuration**: Update `config/e2e-config.ts` for new options

### Test Structure Pattern

```typescript
describe('Feature Group', () => {
  let testContext: E2ETestContext

  beforeAll(() => {
    testContext = createTestContext('Test Name', 'service-name')
  })

  afterAll(async () => {
    await runCleanup(testContext)
  })

  test('should perform operation', async () => {
    const result = await measurePerformance(
      'operation_name',
      () => client.someOperation(testContext.correlationId),
      testContext,
    )

    expect(result).toBeDefined()
    // Add performance assertion if needed
    assertPerformance(responseTime, maxTime, 'Operation name')
  })
})
```

### Safety Best Practices

1. **Always use correlation IDs** for request tracking
2. **Register test data** for automatic cleanup
3. **Use performance measurements** for monitoring
4. **Handle errors gracefully** and provide meaningful messages
5. **Skip tests** when services are unavailable rather than failing
6. **Use unique identifiers** for any test data creation

## Troubleshooting

### Configuration Issues

**Problem**: Tests are skipped with "service not configured"
**Solution**:

- Verify `.env.e2e` file exists and contains correct values
- Check that service URLs are accessible
- Validate API keys are correct and have proper permissions

**Problem**: "E2E configuration is invalid"
**Solution**:

- Run tests with `E2E_DEBUG_LOGGING=true` for detailed error messages
- Check that all required environment variables are set
- Verify service connectivity manually

### Connection Issues

**Problem**: Tests fail with timeout errors
**Solution**:

- Increase `E2E_TEST_TIMEOUT` value
- Check network connectivity to services
- Verify services are running and accessible
- Check for VPN or firewall restrictions

**Problem**: Authentication failures
**Solution**:

- Verify API keys are correct and not expired
- Check API key permissions in service settings
- Ensure Emby user ID is correct

### Performance Issues

**Problem**: Tests fail performance assertions
**Solution**:

- Increase `E2E_MAX_RESPONSE_TIME_MS` for slower networks
- Run tests during low-traffic periods
- Check service health and resource usage
- Verify network conditions

### Test Data Issues

**Problem**: Test data not cleaned up
**Solution**:

- Ensure `E2E_CLEANUP_ENABLED=true`
- Check test logs for cleanup errors
- Manually clean up test data if needed (look for `e2e-test-` prefixed items)
- Verify sufficient permissions for deletion operations

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Run E2E Tests
  run: pnpm test:e2e:ci
  env:
    E2E_SONARR_URL: ${{ secrets.E2E_SONARR_URL }}
    E2E_SONARR_API_KEY: ${{ secrets.E2E_SONARR_API_KEY }}
    E2E_RADARR_URL: ${{ secrets.E2E_RADARR_URL }}
    E2E_RADARR_API_KEY: ${{ secrets.E2E_RADARR_API_KEY }}
    E2E_EMBY_URL: ${{ secrets.E2E_EMBY_URL }}
    E2E_EMBY_API_KEY: ${{ secrets.E2E_EMBY_API_KEY }}
    E2E_EMBY_USER_ID: ${{ secrets.E2E_EMBY_USER_ID }}
```

### Best Practices for CI

1. Use dedicated test instances when possible
2. Set `E2E_READ_ONLY_MODE=true` for production services
3. Use single worker (`--maxWorkers=1`) to avoid conflicts
4. Set appropriate timeout values for CI environment
5. Configure proper secrets management for API keys

## Contributing

When contributing to E2E tests:

1. Follow existing patterns and naming conventions
2. Add appropriate error handling and cleanup
3. Include performance measurements where applicable
4. Update documentation for new configuration options
5. Test with both read-only and destructive modes
6. Verify tests work with service unavailability scenarios

## Security Notes

- **Never commit `.env.e2e`** - it contains sensitive API keys
- **Use dedicated test accounts** when possible
- **Limit API key permissions** to minimum required access
- **Monitor test data creation** in production environments
- **Rotate API keys regularly** for security

## Support

For issues with E2E tests:

1. Check this README for common solutions
2. Review test logs with debug logging enabled
3. Verify service configurations and connectivity
4. Check for known issues in service documentation
5. Create an issue with detailed error information and configuration (without sensitive data)
