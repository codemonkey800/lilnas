# TDR-Bot Media Test Suite Refactoring Plan

## Executive Summary

The current test suite in `packages/tdr-bot/src/media/__tests__/` contains approximately **50-60% redundant, useless, or poorly written tests** that provide minimal value while creating significant maintenance burden. This document outlines a comprehensive refactoring plan to:

- **Remove ~3,000+ lines** of redundant and useless tests
- **Add ~500 lines** of meaningful business logic and integration tests
- **Improve test reliability** by focusing on behavior over implementation
- **Reduce maintenance overhead** while increasing confidence in code quality

### Current Issues
- **Framework behavior testing** instead of application logic
- **Implementation detail testing** of private methods
- **Mock-heavy tests** that don't reflect real functionality
- **Redundant test patterns** repeated across files
- **Missing critical edge cases** and integration scenarios

### Expected Benefits
- **Faster test execution** (estimated 40% reduction in runtime)
- **Improved maintainability** with focused, meaningful tests
- **Better bug detection** through realistic test scenarios
- **Reduced cognitive load** for developers working with tests

---

## Phase 1: Test Removal (Priority: High)

### Complete File Deletions

#### 1. `__tests__/services/discord-components.module.test.ts`
**Status**: Delete entire file (301 lines)
**Reason**: Tests NestJS framework behavior, not application logic
**Details**:
- Lines 47-131: Basic NestJS module instantiation testing
- Lines 136-157: Singleton behavior testing (framework responsibility)
- Lines 159-183: Method existence checking (`typeof service.method`)
- Lines 236-258: Framework integration testing

**Business Impact**: Zero - These tests provide no application value

#### 2. `__tests__/configuration/component-config.test.ts`
**Status**: Delete entire file (308 lines)
**Reason**: Tests static configuration values and TypeScript compile-time behavior
**Details**:
- Lines 10-46: Static constant value verification
- Lines 49-93: Enum string value testing
- Lines 129-187: TypeScript interface structure testing
- Lines 248-308: Arithmetic constant relationship testing

**Business Impact**: Zero - Configuration is validated at compile time

#### 3. `__tests__/types/media-types.test.ts`
**Status**: Delete entire file (671 lines)
**Reason**: Tests TypeScript type definitions
**Details**:
- Lines 22-171: Enum value verification
- Lines 193-611: Interface property existence testing
- Lines 613-671: Type compatibility testing

**Business Impact**: Zero - TypeScript compiler validates these at build time

**Total Removal**: 1,280 lines of useless tests

### Significant Partial File Reductions

#### 4. `__tests__/services/media-logging.service.test.ts`
**Remove**: ~80% of current tests (estimated 600+ lines)
**Keep**: Business logic tests for error aggregation and performance monitoring

**Specific Removals**:
- Lines 197-276: Logging call verification tests
- Lines 354-426: Event emission infrastructure tests  
- Lines 531-563: Log level verification tests
- Lines 406-425: Circular buffer limit tests
- Lines 507-528: Buffer management implementation tests
- Lines 777-836: Trivial arithmetic calculation tests
- Lines 839-876: Private utility method tests

**Keep These Tests**:
- Error pattern recognition and aggregation logic
- Performance threshold detection business logic
- Critical error escalation workflows

#### 5. `__tests__/services/component-state.service.test.ts`
**Remove**: ~40% of current tests (estimated 400+ lines)

**Specific Removals**:
- Lines 103-143: Module lifecycle timer verification
- Lines 988-1074: Metrics tracking counter tests
- Lines 1580-1627: Legacy compatibility method tests
- Lines 1726-1787: Trivial edge case tests (empty arrays, undefined values)

**Keep These Tests**:
- Component lifecycle management logic
- Race condition prevention mechanisms
- Error recovery scenarios

#### 6. Client Test Files - Remove Redundant Patterns

##### `__tests__/clients/base-media-api.client.test.ts`
**Remove**: ~40% (estimated 400+ lines)
**Specific Removals**:
- Lines 216-264: Trivial configuration initialization tests
- Lines 343-468: 6 nearly identical error handling tests → consolidate to 1 parameterized test
- Lines 267-341: 4 identical HTTP method tests → consolidate to 1 parameterized test  
- Lines 691-708: Static retry configuration getter test

##### `__tests__/clients/emby.client.test.ts`
**Remove**: ~35% (estimated 300+ lines)
**Specific Removals**:
- Lines 213-216, 236-238: Redundant service name verification
- Lines 238-255: Trivial authentication getter tests
- Lines 698-742: Private URL building method tests
- Lines 797-814: Artificial empty response handling tests

##### `__tests__/clients/radarr.client.test.ts` & `sonarr.client.test.ts`
**Remove**: Similar patterns (~30% each, estimated 250+ lines each)
**Focus**: Remove initialization testing, empty response mocks, redundant service validation

#### 7. Component Test Files - Remove Implementation Detail Testing

##### `__tests__/components/component.factory.test.ts`
**Remove**: ~50% (estimated 600+ lines)
**Specific Removals**:
- Lines 682-1243: Redundant constraint validation tests (already tested in individual builders)
- Lines 1245-1394: Private utility method tests
- Lines 1376-1393: Trivial `getConstraints()` getter test

##### All Component Builder Tests
**Remove from each file**:
- All `getConstraints()` getter tests
- All private text truncation method tests  
- Redundant parameter variation tests (consolidate to parameterized)

**Estimated Removal per File**:
- `action-row.builder.test.ts`: ~200 lines
- `button.builder.test.ts`: ~300 lines  
- `modal.builder.test.ts`: ~250 lines
- `select-menu.builder.test.ts`: ~300 lines

**Total Phase 1 Removal**: ~3,000+ lines of redundant/useless tests

---

## Phase 2: Test Consolidation (Priority: Medium)

### Parameterized Test Conversions

#### HTTP Method Testing
**File**: `base-media-api.client.test.ts`
**Current**: 4 separate tests (lines 267-341)
**Convert To**:
```typescript
describe('HTTP methods', () => {
  it.each(['get', 'post', 'put', 'delete'])('should handle %s requests with retry logic', async (method) => {
    // Single parameterized test covering all HTTP methods
  });
});
```

#### Error Status Code Testing  
**File**: `base-media-api.client.test.ts`
**Current**: 6 separate tests (lines 343-468)
**Convert To**:
```typescript
describe('Error handling', () => {
  it.each([
    [400, 'Bad Request'],
    [401, 'Unauthorized'], 
    [404, 'Not Found'],
    [500, 'Internal Server Error'],
    [503, 'Service Unavailable']
  ])('should handle %s %s errors correctly', async (status, message) => {
    // Single parameterized test for error scenarios
  });
});
```

#### Media Type Variations
**Files**: All component builder tests
**Current**: Separate tests for each media type (movies, series)
**Convert To**:
```typescript
describe('Media type handling', () => {
  it.each(['movie', 'series'])('should create search components for %s', async (mediaType) => {
    // Single parameterized test covering both media types  
  });
});
```

#### Pagination Button States
**File**: `button.builder.test.ts`
**Current**: 4+ separate tests (lines 249-319)
**Convert To**:
```typescript
describe('Pagination button states', () => {
  it.each([
    ['first', true, false],
    ['previous', false, false],
    ['next', false, false], 
    ['last', false, true]
  ])('should set correct disabled state for %s button', async (type, isFirst, isLast) => {
    // Single parameterized test for all pagination states
  });
});
```

---

## Phase 3: Critical Test Additions (Priority: High)

### Business Logic Coverage

#### 1. Sonarr Episode Monitoring
**File**: `__tests__/clients/sonarr.client.test.ts`
**New Section**: Episode Monitoring Edge Cases
```typescript
describe('Episode Monitoring Business Logic', () => {
  describe('updateEpisodeMonitoring', () => {
    it('should handle concurrent episode monitoring updates to same series', async () => {
      // Test race condition handling when multiple users update same series
      // Business Impact: Prevents data corruption in episode monitoring state
    });

    it('should handle missing episodes gracefully', async () => {
      // Test behavior when episode IDs don't exist in series
      // Business Impact: Prevents API errors and user confusion
    });

    it('should validate episode existence before monitoring updates', async () => {
      // Test pre-validation of episode existence
      // Business Impact: Prevents silent failures
    });
  });

  describe('setExclusiveEpisodeMonitoring', () => {
    it('should handle series with 1000+ episodes efficiently', async () => {
      // Test performance with large episode collections
      // Business Impact: Prevents timeouts on large series
    });

    it('should handle episodes missing from series database', async () => {
      // Test error recovery when episodes are missing
      // Business Impact: Graceful degradation instead of crashes
    });
  });

  describe('validateEpisodeSpecification', () => {
    it('should handle series with missing seasons', async () => {
      // Test validation with incomplete season data
      // Business Impact: Prevents invalid monitoring configurations
    });

    it('should validate episode ranges against available episodes', async () => {
      // Test range validation logic
      // Business Impact: Prevents monitoring non-existent episodes
    });
  });
});
```

#### 2. API Version Compatibility
**File**: `__tests__/clients/base-media-api.client.test.ts` 
**New Section**: Version Compatibility Edge Cases
```typescript
describe('API Version Compatibility', () => {
  describe('version detection', () => {
    it('should handle malformed version responses gracefully', async () => {
      // Test with invalid JSON, missing fields, wrong types
      // Business Impact: Prevents service startup failures
    });

    it('should enforce strict compatibility mode correctly', async () => {
      // Test strict mode rejection of unsupported versions
      // Business Impact: Prevents subtle compatibility issues
    });

    it('should handle version detection network failures', async () => {
      // Test timeout and network error handling
      // Business Impact: Graceful degradation when version check fails
    });
  });

  describe('HTML error page detection', () => {
    it('should detect HTML error pages and provide meaningful errors', async () => {
      // Test detection of login pages, proxy errors, 503 pages
      // Business Impact: Better error messages for configuration issues
    });

    it('should handle responses with incorrect content-type headers', async () => {
      // Test content-type validation
      // Business Impact: Prevents JSON parsing errors
    });
  });

  describe('response size limits', () => {
    it('should handle responses exceeding maxContentLength', async () => {
      // Test large response handling
      // Business Impact: Prevents memory exhaustion
    });

    it('should handle missing content-length headers', async () => {
      // Test streaming response handling
      // Business Impact: Prevents infinite memory growth
    });
  });
});
```

### Concurrency and Race Condition Testing

#### 3. Component State Service Race Conditions
**File**: `__tests__/services/component-state.service.test.ts`
**New Section**: Concurrency and Race Conditions
```typescript
describe('Concurrency and Race Conditions', () => {
  describe('state transitions', () => {
    it('should handle mutex contention during concurrent state transitions', async () => {
      // Test 50+ concurrent requests to same state ID
      // Business Impact: Prevents state corruption and deadlocks
    });

    it('should maintain state consistency when cleanup fires during transitions', async () => {
      // Test interaction between scheduled cleanup and manual operations  
      // Business Impact: Prevents orphaned states and memory leaks
    });
  });

  describe('component limits', () => {
    it('should handle race condition at global component limit', async () => {
      // Test simultaneous creation when at 9/10 limit
      // Business Impact: Prevents limit bypass and resource exhaustion
    });

    it('should handle user limit enforcement with concurrent cleanup', async () => {
      // Test cleanup failure preventing new creation
      // Business Impact: Prevents system deadlock scenarios
    });
  });

  describe('resource management', () => {
    it('should prevent memory exhaustion during rapid create/cleanup cycles', async () => {
      // Test memory usage under high-frequency operations
      // Business Impact: Prevents OOM crashes under load
    });

    it('should handle timeout handle exhaustion gracefully', async () => {
      // Test creation rate exceeding cleanup capacity
      // Business Impact: Prevents system resource exhaustion
    });
  });
});
```

#### 4. Error Service Fallback Chains  
**File**: `__tests__/services/discord-error.service.test.ts`
**New Section**: Complete Fallback Failure Scenarios
```typescript
describe('Fallback Chain Reliability', () => {
  describe('complete fallback failures', () => {
    it('should handle all fallback methods failing gracefully', async () => {
      // Test followUp, editReply, and ephemeral all failing
      // Business Impact: Prevents application crashes during Discord API issues
    });

    it('should detect interaction expiry mid-retry and abort', async () => {
      // Test time-based validity during retry attempts
      // Business Impact: Prevents wasted retry attempts and confusing errors
    });
  });

  describe('unknown error handling', () => {
    it('should handle new Discord API error codes gracefully', async () => {
      // Test forward compatibility with unknown error codes
      // Business Impact: Prevents crashes when Discord introduces new errors
    });

    it('should handle malformed Discord API error responses', async () => {
      // Test missing properties in DiscordAPIError objects
      // Business Impact: Robust error handling during Discord API changes
    });
  });
});
```

---

## Phase 4: Integration Testing (Priority: Medium)

### Cross-Component Integration Tests

#### 5. Component Workflow Integration
**New File**: `__tests__/integration/component-workflows.integration.test.ts`
```typescript
describe('End-to-End Component Workflows', () => {
  describe('search-to-request workflow', () => {
    it('should handle complete movie search and request workflow', async () => {
      // Test: Search buttons → Modal → Result selection → Request confirmation
      // Business Impact: Ensures primary user workflow functions correctly
    });

    it('should handle workflow interruption and recovery', async () => {
      // Test: Component expiry mid-workflow
      // Business Impact: Graceful handling of expired interactions
    });
  });

  describe('state management across components', () => {
    it('should maintain state consistency across component transitions', async () => {
      // Test: State transitions between different component types
      // Business Impact: Prevents state corruption in complex workflows
    });

    it('should cleanup expired components without affecting active ones', async () => {
      // Test: Selective cleanup during multi-component workflows
      // Business Impact: Prevents interference between user sessions
    });
  });

  describe('constraint validation integration', () => {
    it('should handle compound constraint violations gracefully', async () => {
      // Test: Multiple constraints violated simultaneously
      // Business Impact: Prevents Discord API errors from complex UIs
    });

    it('should respect action row limits in complex UI builds', async () => {
      // Test: Component distribution across multiple action rows
      // Business Impact: Ensures Discord limits are respected
    });
  });
});
```

#### 6. Service Integration Tests
**New File**: `__tests__/integration/service-integration.test.ts`
```typescript
describe('Cross-Service Error Propagation', () => {
  describe('error service + state service', () => {
    it('should handle Discord errors during component state updates', async () => {
      // Test: Discord API failure during state transition
      // Business Impact: Proper cleanup and error reporting
    });

    it('should recover from partial component creation failures', async () => {
      // Test: Some components succeed, others fail
      // Business Impact: Graceful partial failure handling
    });
  });

  describe('logging service integration', () => {
    it('should handle logging service failure during critical errors', async () => {
      // Test: MediaLoggingService throws during error handling
      // Business Impact: Error handling continues despite logging failures
    });

    it('should maintain performance metrics during service failures', async () => {
      // Test: Performance tracking resilience
      // Business Impact: Observability maintained during incidents
    });
  });
});
```

---

## Phase 5: Edge Cases and Hardening (Priority: Low)

### Input Validation Edge Cases

#### 7. Request Validation Hardening
**New File**: `__tests__/schemas/request-validation.edge-cases.test.ts`
```typescript
describe('Input Validation Edge Cases', () => {
  describe('boundary value testing', () => {
    it('should reject years outside valid range (1900-2100)', async () => {
      // Test: Year validation boundaries
      // Business Impact: Prevents invalid requests to media services
    });

    it('should handle Unicode characters and emoji in titles', async () => {
      // Test: Non-ASCII character handling
      // Business Impact: Proper internationalization support
    });
  });

  describe('security validation', () => {
    it('should prevent path traversal in rootFolderPath', async () => {
      // Test: Path traversal attack prevention
      // Business Impact: Security hardening
    });

    it('should sanitize special characters in search terms', async () => {
      // Test: SQL injection and XSS prevention
      // Business Impact: Security hardening
    });
  });
});
```

### Resource Management Testing

#### 8. Performance and Memory Testing
**File**: `__tests__/services/media-logging.service.test.ts`
**New Section**: Resource Management
```typescript
describe('Resource Management', () => {
  describe('memory leak prevention', () => {
    it('should prevent memory exhaustion during metric flood', async () => {
      // Test: 10,000 rapid metrics without unbounded growth
      // Business Impact: Prevents OOM crashes under load
    });

    it('should handle large context objects safely', async () => {
      // Test: Context sanitization with 100MB objects
      // Business Impact: Memory usage control
    });
  });

  describe('logging infrastructure resilience', () => {
    it('should continue functioning when underlying logger fails', async () => {
      // Test: Logger.prototype.error throws exception
      // Business Impact: Service resilience during infrastructure failures
    });

    it('should handle event emitter backpressure', async () => {
      // Test: EventEmitter2 saturation scenarios
      // Business Impact: Prevents event system lockup
    });
  });
});
```

---

## Implementation Timeline

### Week 1: Test Removal (Phase 1)
**Effort**: 2-3 days
**Tasks**:
- Delete 3 complete test files
- Remove redundant sections from client tests
- Remove implementation detail tests from component tests
- Remove infrastructure tests from service tests

**Deliverable**: ~3,000 lines removed, test suite runs 40% faster

### Week 2: Critical Business Logic (Phase 3)
**Effort**: 3-4 days  
**Tasks**:
- Add Sonarr episode monitoring edge cases
- Add API version compatibility tests
- Add component state race condition tests
- Add error service fallback chain tests

**Deliverable**: Critical production scenarios covered

### Week 3: Test Consolidation (Phase 2)  
**Effort**: 2 days
**Tasks**:
- Convert redundant tests to parameterized versions
- Consolidate similar test patterns
- Reduce code duplication

**Deliverable**: More maintainable test structure

### Week 4: Integration Testing (Phase 4)
**Effort**: 3 days
**Tasks**:
- Create component workflow integration tests  
- Add cross-service integration tests
- Verify end-to-end scenarios

**Deliverable**: System-level confidence

### Week 5: Edge Cases (Phase 5)
**Effort**: 2 days
**Tasks**:
- Add input validation edge cases
- Add resource management tests
- Performance and security hardening

**Deliverable**: Robust production readiness

---

## Success Metrics

### Quantitative Measures
- **Test Count Reduction**: ~50% fewer total tests
- **Test Execution Time**: ~40% faster test runs  
- **Code Coverage**: Maintain >85% coverage while removing redundant tests
- **Test Maintenance**: ~60% fewer test updates needed per feature change

### Qualitative Measures  
- **Developer Confidence**: Tests catch real bugs instead of false positives
- **Maintainability**: Easier to understand what each test validates
- **Production Reliability**: Better coverage of actual failure scenarios  
- **Documentation Value**: Tests serve as executable specification

### Measurement Plan
1. **Baseline Metrics** (Before): Test count, execution time, coverage percentages
2. **Weekly Progress**: Track removals, additions, and consolidations
3. **Post-Implementation Review**: Compare metrics and gather developer feedback
4. **Long-term Monitoring**: Track test maintenance burden over 3 months

---

## Risk Mitigation

### Potential Risks
1. **Coverage Regression**: Removing tests might reduce coverage
2. **Hidden Dependencies**: Removed tests might catch edge cases we missed
3. **Team Disruption**: Developers familiar with current test structure

### Mitigation Strategies
1. **Coverage Monitoring**: Run coverage reports before/after each phase
2. **Gradual Implementation**: Phased approach allows rollback if issues arise
3. **Code Review**: All changes reviewed by multiple team members
4. **Documentation**: Clear documentation of what each new test validates

### Rollback Plan
- Each phase is a separate branch that can be reverted independently
- Keep original test files as `.backup` files for first month
- Maintain detailed change log for quick issue identification

---

## File Structure After Refactoring

```
packages/tdr-bot/src/media/__tests__/
├── clients/
│   ├── base-media-api.client.test.ts          # Reduced by ~40%
│   ├── emby.client.test.ts                    # Reduced by ~35%  
│   ├── radarr.client.test.ts                  # Reduced by ~30%
│   └── sonarr.client.test.ts                  # Reduced by ~30%, enhanced with episode monitoring
├── components/
│   ├── action-row.builder.test.ts             # Reduced by ~30%
│   ├── button.builder.test.ts                 # Reduced by ~40%
│   ├── component.factory.test.ts              # Reduced by ~50%
│   ├── modal.builder.test.ts                  # Reduced by ~35%
│   └── select-menu.builder.test.ts            # Reduced by ~40%
├── configuration/                             # DELETED
├── e2e/                                       # Keep as-is
├── integration/                               # NEW
│   ├── component-workflows.integration.test.ts
│   ├── service-integration.test.ts
│   └── README.md
├── schemas/                                   # NEW
│   └── request-validation.edge-cases.test.ts
├── services/
│   ├── component-state.service.test.ts        # Reduced by ~40%, enhanced with race conditions
│   ├── discord-error.service.test.ts          # Enhanced with fallback scenarios  
│   └── media-logging.service.test.ts          # Reduced by ~80%
└── types/                                     # DELETED
```

**Total Impact**:
- **Files Deleted**: 3 (1,280 lines)
- **Lines Removed**: ~3,000 across remaining files
- **Lines Added**: ~500 new meaningful tests  
- **Net Reduction**: ~2,500 lines (~50% of test code)
- **New Integration Coverage**: 2 new test suites
- **Enhanced Business Logic**: 4 critical areas improved

---

This refactoring plan transforms the test suite from a maintenance burden into a valuable development asset that provides real confidence in code quality and system reliability.