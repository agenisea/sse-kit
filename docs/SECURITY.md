# Security Considerations

## Error Message Sanitization

Server error messages are passed through to consumers via `state.error`. If you display these messages to end users, sanitize them to prevent XSS:

```typescript
const { state } = useSSEStream({ ... })

// BAD: Direct HTML insertion
element.innerHTML = state.error

// GOOD: Use textContent or a sanitization library
element.textContent = state.error

// React (automatically safe)
<p>{state.error}</p>
```

## Circuit Breaker Names

Use application-defined constants for circuit breaker names, not user input:

```typescript
// GOOD: Static application-defined names
const breaker = getSharedCircuitBreaker('api-stream')
const breaker = getSharedCircuitBreaker('llm-service')

// BAD: User-provided input as names
const breaker = getSharedCircuitBreaker(userInput) // Don't do this
```

## Retry Configuration Bounds

Keep `maxRetries` within reasonable bounds (0-10 recommended) to prevent infinite retry loops:

```typescript
// GOOD: Reasonable retry limits
{ maxRetries: 3 }   // Default, recommended
{ maxRetries: 5 }   // For critical operations
{ maxRetries: 10 }  // Maximum recommended

// BAD: Unbounded retries
{ maxRetries: Infinity }  // Will retry forever
{ maxRetries: 1000 }      // Excessive, wastes resources
```
