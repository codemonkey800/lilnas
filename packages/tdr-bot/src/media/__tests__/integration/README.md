# Integration Test Suite

This directory contains comprehensive integration tests that validate system-level behavior and cross-service interactions in the TDR-Bot media management system.

## Purpose

Integration tests differ from unit tests by testing how multiple components work together in realistic scenarios. They focus on:

- **End-to-end user workflows** from initial interaction to final result
- **Cross-service communication** and error propagation
- **State management** across component boundaries
- **System behavior** under various failure conditions
- **Service isolation** and graceful degradation

## Test Structure

### Component Workflow Integration (`component-workflows.integration.test.ts`)

Tests complete user interaction workflows:

- **Search-to-Request Workflows**: Full user journeys from search initiation through result selection to final media requests
- **State Management**: How component state persists and transitions across different interaction types (buttons → modals → select menus)
- **Constraint Handling**: Discord API limits and component validation during complex workflows
- **Session Management**: User isolation and concurrent workflow handling

### Service Integration (`service-integration.test.ts`)

Tests how different services interact:

- **Error Propagation**: How failures in one service affect others
- **Service Resilience**: System behavior when individual services are unavailable
- **State Consistency**: Data integrity during service failures and recovery
- **Authentication**: Cross-service auth failure handling and recovery

## Test Patterns

### Realistic Workflow Testing

```typescript
// Test complete user workflows with multiple phases
it('should handle complete movie search and request workflow', async () => {
  // Phase 1: Initial search button interaction
  const searchButton = componentFactory.createButton(searchButtonConfig)
  const initialState = await componentState.createComponentState(
    message,
    context,
  )

  // Phase 2: Modal form interaction
  const modal = componentFactory.createModal(modalConfig)
  await componentState.updateComponentState(initialState.id, formData)

  // Phase 3: Results selection
  const resultsSelect = componentFactory.createSelectMenu(resultsConfig)
  await componentState.updateComponentState(initialState.id, selectionData)

  // Phase 4: Confirmation and final request
  const confirmButton = componentFactory.createButton(confirmConfig)

  // Verify complete workflow state
  expect(finalState.data).toContain(allWorkflowData)
})
```

### Service Failure Simulation

```typescript
// Test graceful handling of service failures
it('should handle media service unavailability', async () => {
  // Configure service to fail
  mockAxios.get.mockRejectedValue(new Error('ECONNREFUSED'))

  // Attempt operation that requires service
  await expect(sonarrClient.searchSeries('query')).rejects.toThrow()

  // Verify system remains functional
  expect(componentState.getComponentState(stateId)).toBeDefined()

  // Verify error is handled gracefully
  expect(loggingService.logError).toHaveBeenCalled()
})
```

### State Consistency Validation

```typescript
// Test state integrity across service boundaries
it('should maintain state consistency during API failures', async () => {
  // Set initial valid state
  await componentState.updateComponentState(stateId, validData)

  // Simulate API failure
  mockAxios.get.mockRejectedValue(new Error('API timeout'))

  // Verify state remains intact after failure
  const stateAfterFailure = componentState.getComponentState(stateId)
  expect(stateAfterFailure.data).toEqual(validData)
  expect(stateAfterFailure.state).toBe(ComponentLifecycleState.ACTIVE)
})
```

## Mock Strategy for Integration Tests

### Discord API Mocking

- **Mock Message class** with configurable collector creation
- **Simulate Discord errors** through mock configuration
- **Test interaction patterns** with realistic Discord.js behavior

### Service Client Mocking

- **Mock Axios instances** for HTTP API calls
- **Configurable response/error scenarios** for different test conditions
- **Realistic response data** that matches actual API schemas

### State Management Mocking

- **Real ComponentStateService** to test actual state transitions
- **Mock external dependencies** (logging, error handling)
- **Isolated test environments** with proper cleanup

## Business Impact

These integration tests ensure:

1. **User Experience Quality**: Complete workflows function correctly without unexpected failures
2. **System Reliability**: Services handle failures gracefully without cascading errors
3. **Data Integrity**: User state and workflow data remain consistent during service disruptions
4. **Operational Resilience**: System remains functional during partial service outages
5. **Error Recovery**: Users can retry operations after service recovery

## Running Integration Tests

```bash
# Run all integration tests
pnpm test integration/

# Run specific integration test files
pnpm test component-workflows.integration.test.ts
pnpm test service-integration.test.ts

# Run with coverage for integration scenarios
pnpm test integration/ --coverage

# Watch mode for development
pnpm test:watch integration/
```

## Adding New Integration Tests

When adding new integration tests, consider:

### Test Scope

- Focus on **cross-component** or **cross-service** interactions
- Test **realistic user scenarios** rather than isolated functionality
- Include **failure scenarios** and recovery paths

### Test Data

- Use **realistic payloads** that match production API responses
- Include **edge cases** like large datasets or complex nested data
- Test with **multiple concurrent users** to validate isolation

### Error Scenarios

- Test **partial failures** where some services succeed and others fail
- Validate **error propagation** between service layers
- Ensure **graceful degradation** when dependencies are unavailable

### Performance Considerations

- Test with **realistic data sizes** to validate memory usage
- Include **timeout scenarios** for long-running operations
- Verify **cleanup behavior** to prevent resource leaks

## Integration vs Unit Test Guidelines

**Use Integration Tests When:**

- Testing complete user workflows (search → select → request)
- Validating cross-service error handling
- Testing state management across component boundaries
- Verifying system behavior under service failures

**Use Unit Tests When:**

- Testing individual service methods or components
- Validating specific error conditions in isolation
- Testing edge cases for single functions or classes
- Ensuring code coverage for individual modules

## Maintenance

### Regular Updates

- Update mock data when API schemas change
- Add new integration scenarios for new features
- Review and update failure scenarios based on production incidents

### Performance Monitoring

- Monitor test execution time and optimize slow tests
- Use appropriate timeout values for async operations
- Clean up resources properly to prevent test interference

### Documentation

- Keep README.md current with new test patterns
- Document business impact of new integration scenarios
- Include examples of common integration test patterns
