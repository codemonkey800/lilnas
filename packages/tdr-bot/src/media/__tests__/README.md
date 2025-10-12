# Media Test Architecture Guide

This document explains the improved test architecture for media services (Sonarr/Radarr) and provides guidance for writing high-value, maintainable tests.

## 🏗️ Architecture Overview

The new test architecture addresses the original issues identified in the media test suite:

### **Problems Solved:**

- ❌ **40% code duplication** across test files
- ❌ **Massive test files** (2,232+ lines) difficult to maintain
- ❌ **Low-value tests** (constructor tests, simple getters)
- ❌ **Inconsistent test data** and setup patterns
- ❌ **Poor test organization** by technical structure vs business functionality

### **Solutions Implemented:**

- ✅ **Shared infrastructure** eliminates duplication
- ✅ **Realistic fixtures** provide consistent, meaningful test data
- ✅ **Focused test modules** organized by business functionality
- ✅ **Factory functions** for dynamic test data generation
- ✅ **High-value test patterns** focus on business logic and integration scenarios

## 📁 Directory Structure

```
media/__tests__/
├── shared/                           # Shared test infrastructure
│   ├── factories.ts                  # Mock data factory functions
│   ├── test-helpers.ts               # Common utilities and setup
│   └── base-test-classes.ts          # Reusable test patterns
├── fixtures/                         # Realistic test data
│   ├── sonarr-fixtures.ts            # Sonarr-specific fixtures
│   ├── radarr-fixtures.ts            # Radarr-specific fixtures
│   └── index.ts                      # Centralized exports
├── examples/                         # Working examples of new patterns
│   ├── sonarr-client.example.test.ts # Client test example
│   └── sonarr-service.example.test.ts # Service test example
├── sonarr.client.test.ts             # Original working tests (keep for now)
├── sonarr.service.test.ts            # Original working tests (keep for now)
└── radarr.*.test.ts                  # Original working tests (keep for now)
```

## 🛠️ Shared Infrastructure Usage

### **1. Factory Functions** (`shared/factories.ts`)

Replace inline mock data with factory functions for consistency:

```typescript
// ❌ OLD: Inline mock data (duplicated across files)
const mockSeries = {
  id: 1,
  title: 'Test Series',
  tvdbId: 12345,
  // ... 50+ properties
}

// ✅ NEW: Using factory functions
import { createMockSonarrSeries } from '../shared/factories'

const mockSeries = createMockSonarrSeries({
  id: 1,
  title: 'Test Series',
  tvdbId: 12345,
  // Only specify what's different
})
```

### **2. Realistic Fixtures** (`fixtures/`)

Use pre-defined realistic test data instead of generic mocks:

```typescript
// ❌ OLD: Generic test data
const mockSeries = { title: 'Test Series', year: 2023 }

// ✅ NEW: Realistic fixtures based on actual data
import { THE_OFFICE_SERIES, BREAKING_BAD_SEARCH_RESULT } from '../fixtures'

// Tests use real TV show data with proper relationships
expect(result.title).toBe(THE_OFFICE_SERIES.title) // "The Office (US)"
expect(result.network).toBe('NBC') // Real network data
```

### **3. Common Setup Helpers** (`shared/test-helpers.ts`)

Reduce boilerplate setup code:

```typescript
// ❌ OLD: Manual mock setup (repeated in every test)
let mockLogger: jest.Mocked<Logger>
let mockRetryService: jest.Mocked<RetryService>

beforeEach(() => {
  mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    // ... more setup
  }
  // ... 20+ lines of setup
})

// ✅ NEW: Using shared setup helpers
import { setupCommonMocks, createTestModule } from '../shared/test-helpers'

const commonMocks = setupCommonMocks() // Handles all standard mocking
const module = await createTestModule(providers) // Standard module creation
```

## 📊 Test Scenarios and Fixtures

### **Pre-defined Test Scenarios**

Use scenario-based testing for comprehensive coverage:

```typescript
import { SEARCH_SCENARIOS, MONITORING_SCENARIOS } from '../fixtures'

// Test multiple scenarios efficiently
Object.entries(SEARCH_SCENARIOS).forEach(([name, scenario]) => {
  it(`should handle ${name} scenario`, async () => {
    mockClient.searchSeries.mockResolvedValueOnce(scenario.results)

    const result = await service.searchShows(scenario.query)

    expect(result).toHaveLength(scenario.total)
    expect(result).toEqual(scenario.results)
  })
})
```

### **Realistic Error Scenarios**

Standardized error testing with realistic error responses:

```typescript
import { API_ERROR_RESPONSES, COMMON_TEST_SCENARIOS } from '../fixtures'

// Use predefined error scenarios
testErrorScenario(
  'should handle rate limiting',
  () => {
    mockClient.searchSeries.mockRejectedValueOnce(
      new Error(API_ERROR_RESPONSES.RATE_LIMITED.message),
    )
  },
  async () => {
    await expect(service.searchShows('test')).rejects.toThrow(
      API_ERROR_RESPONSES.RATE_LIMITED.message,
    )
  },
)
```

## 🎯 Test Value Guidelines

### **High-Value Tests (Focus Here):**

- ✅ **Complex business logic workflows** (monitoring, download management)
- ✅ **Integration scenarios** (multiple services working together)
- ✅ **Error handling and recovery** (network failures, API errors)
- ✅ **Edge cases** (large datasets, concurrent operations)
- ✅ **Performance scenarios** (timeout handling, bulk operations)

### **Low-Value Tests (Remove or Simplify):**

- ❌ **Constructor tests** that just verify property assignment
- ❌ **Simple getter/setter tests** without business logic
- ❌ **Basic API forwarding** without transformation or validation
- ❌ **Over-detailed logging tests** checking exact message format
- ❌ **Duplicate error scenarios** across multiple methods

## 📈 Migration Guide

### **Step 1: Start with New Tests**

When writing new tests, use the new architecture:

```typescript
// NEW test file structure
import { setupCommonMocks, createTestModule } from '../shared/test-helpers'
import { createMockSonarrSeries } from '../shared/factories'
import { THE_OFFICE_SERIES, API_ERROR_RESPONSES } from '../fixtures'

describe('NewFeature', () => {
  // Use shared setup
  const commonMocks = setupCommonMocks()

  it('should handle new feature using realistic data', async () => {
    // Use fixtures and factories
    const testSeries = createMockSonarrSeries({
      title: 'Custom Test Series',
      // Only specify what's unique
    })

    // Test business logic, not mocking mechanics
    expect(processedData.complexCalculation).toBe(expectedValue)
  })
})
```

### **Step 2: Gradually Migrate Existing Tests**

Refactor existing tests incrementally:

1. **Replace inline mocks** with factory functions
2. **Use realistic fixtures** instead of generic test data
3. **Consolidate duplicate setup** using shared helpers
4. **Focus on business logic** in assertions
5. **Remove low-value tests** during migration

### **Step 3: Organize by Business Functionality**

Split large test files by business concerns:

- `service.search.test.ts` - Search and discovery
- `service.monitoring.test.ts` - Monitor/unmonitor workflows
- `service.downloads.test.ts` - Download queue management
- `client.api.test.ts` - Core API operations
- `client.health.test.ts` - Health and configuration

## 🔧 Best Practices

### **1. Test Data Management**

```typescript
// ✅ GOOD: Use factories for customization
const customSeries = createMockSonarrSeries({
  monitored: false,
  ended: true,
})

// ✅ GOOD: Use fixtures for realistic scenarios
expect(result).toEqual(BREAKING_BAD_SEARCH_RESULT)

// ❌ AVOID: Inline mock data
const mockSeries = { id: 1, title: 'Mock' /* 50+ properties */ }
```

### **2. Test Organization**

```typescript
// ✅ GOOD: Organized by business functionality
describe('SeriesMonitoring', () => {
  describe('adding new series', () => {})
  describe('updating existing series', () => {})
  describe('error handling', () => {})
})

// ❌ AVOID: Organized by technical structure
describe('addSeries method', () => {})
describe('updateSeries method', () => {})
```

### **3. Error Testing**

```typescript
// ✅ GOOD: Use shared error scenarios
testErrorScenario(
  'should handle network failures',
  () => setupNetworkError(),
  async () => expectOperationToFail(),
)

// ❌ AVOID: Duplicate error handling tests
it('should throw on network error 1', () => {})
it('should throw on network error 2', () => {}) // Same test pattern
```

### **4. Performance Testing**

```typescript
// ✅ GOOD: Test actual performance concerns
it('should handle large library efficiently', async () => {
  const largeLibrary = Array.from({ length: 5000 }, createMockSeries)
  // Test actual performance with realistic data size
})

// ❌ AVOID: Performance testing that doesn't reflect real usage
it('should complete in under 1ms', () => {}) // Arbitrary timing
```

## 📋 Migration Checklist

When migrating an existing test file:

- [ ] Import shared infrastructure (`shared/`, `fixtures/`)
- [ ] Replace inline mock data with factory functions
- [ ] Use realistic fixtures for test assertions
- [ ] Consolidate setup using `setupCommonMocks()`
- [ ] Focus tests on business logic, not implementation details
- [ ] Remove constructor and simple getter tests
- [ ] Add missing edge cases and error scenarios
- [ ] Organize tests by business functionality
- [ ] Validate that all tests still pass after migration

## 🚀 Future Enhancements

The shared infrastructure enables:

1. **Cross-service consistency** (Sonarr patterns work for Radarr)
2. **Easy test extension** (add new scenarios to fixtures)
3. **Performance benchmarking** (consistent test data sizes)
4. **Integration testing** (realistic service interactions)
5. **Contract testing** (validate API response structures)

## 🔍 Examples

See working examples in:

- `examples/sonarr-client.example.test.ts` - Client testing patterns
- `examples/sonarr-service.example.test.ts` - Service testing patterns

These demonstrate the new architecture in practice with actual working code.
