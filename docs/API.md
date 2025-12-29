# API Reference

## Server (`@agenisea/sse-kit/server`)

### `createStreamingResponse(config?)`

Creates a streaming response with an orchestrator for managing SSE updates.

```typescript
import { createStreamingResponse, createSSEResponse } from '@agenisea/sse-kit/server'

const { stream, orchestrator } = createStreamingResponse({
  signal: request.signal,           // AbortSignal for cancellation
  heartbeat: { intervalMs: 5000 },  // Heartbeat config
  observer: {                       // Observability hooks
    onStreamStart: () => {},
    onStreamEnd: (durationMs, success, error) => {},
    onUpdateSent: (phase, bytesSent) => {},
    onAbort: (reason) => {},
  },
})

return createSSEResponse(stream)
```

### `StreamOrchestrator`

| Method | Description |
|--------|-------------|
| `sendUpdate(update)` | Send a generic update |
| `sendProgress(phase, message?)` | Send phase progress |
| `sendResult(result)` | Send final result |
| `sendError(error, extra?)` | Send error |
| `sendEvent(type, data)` | Send typed SSE event |
| `startHeartbeat()` | Start periodic heartbeat |
| `stopHeartbeat()` | Stop heartbeat interval |
| `abort(reason?)` | Abort the stream |
| `close()` | Close the stream |
| `getMetrics()` | Get stream metrics |

| Property | Description |
|----------|-------------|
| `closed` | Whether stream is closed |
| `aborted` | Whether stream was aborted |

### `StreamObserver`

Observability hooks for monitoring stream lifecycle:

```typescript
import type { StreamObserver } from '@agenisea/sse-kit/server'

const observer: StreamObserver = {
  onStreamStart: () => {
    // Called when stream is created
  },
  onStreamEnd: (durationMs, success, error) => {
    // Called when stream closes (success or error)
  },
  onUpdateSent: (phase, bytesSent) => {
    // Called on each update sent
  },
  onHeartbeat: () => {
    // Called when heartbeat is sent
  },
  onError: (error) => {
    // Called when an error occurs
  },
  onAbort: (reason) => {
    // Called when stream is aborted (via signal or abort())
  },
}
```

### `createSSEEncoder(controller)`

Low-level SSE encoder for custom streaming needs:

```typescript
import { createSSEEncoder } from '@agenisea/sse-kit/server'

const sse = createSSEEncoder(controller)
sse.start({ version: '1.0' })
sse.delta('Hello ', { id: '1' })  // With event ID for reconnection
sse.done({ success: true })
```

---

## Client (`@agenisea/sse-kit/client`)

### `useSSEStream(options)`

React hook for consuming SSE streams with full lifecycle management.

```typescript
import { useSSEStream } from '@agenisea/sse-kit/client'

const { state, start, cancel, reset, isStreaming } = useSSEStream({
  // Connection
  endpoint: '/api/stream',
  method: 'POST',
  headers: { 'X-Custom': 'value' },

  // Phase lifecycle
  initialPhase: 'idle',
  completePhase: 'complete',
  errorPhase: 'error',

  // Callbacks
  onUpdate: (update) => {},
  onComplete: (result) => {},
  onError: (error) => {},

  // Resilience
  retry: { maxRetries: 3 },
})
```

#### Options interfaces

```typescript
import type {
  SSEConnectionConfig,  // endpoint, method, headers, streamQueryParam
  SSEPhaseConfig,       // initialPhase, completePhase, errorPhase, reconnectingPhase
  SSEStreamCallbacks,   // onUpdate, onComplete, onError
  SSEParseConfig,       // extractResult, extractError, isComplete, isError
  SSEResilienceConfig,  // retry
  SSEBrowserConfig,     // warnOnUnload
} from '@agenisea/sse-kit/client'
```

### `createCircuitBreaker(options)`

Circuit breaker pattern implementation:

```typescript
import { createCircuitBreaker } from '@agenisea/sse-kit/client'

const breaker = createCircuitBreaker({
  failureThreshold: 3,
  resetTimeoutMs: 30000,
})

const result = await breaker.execute(() => fetchStream())
```

### `fetchWithTimeout(fetchFn, config, signal?)`

Fetch wrapper with request and idle timeouts:

```typescript
import { fetchWithTimeout } from '@agenisea/sse-kit/client'

const response = await fetchWithTimeout(
  (signal) => fetch('/api/stream', { signal }),
  { requestMs: 60000, idleMs: 10000 }
)
```

### `withRetry(operation, options)`

Retry wrapper with exponential backoff:

```typescript
import { withRetry } from '@agenisea/sse-kit/client'

const response = await withRetry(() => fetch('/api/stream'), {
  config: { maxRetries: 3 },
  onRetry: (attempt, delay) => console.log(`Retry ${attempt}`),
})
```

---

## Types (`@agenisea/sse-kit/types`)

```typescript
import type {
  SSEUpdate,
  SSEMessage,
  SSEMetadata,
  RetryConfig,
  TimeoutConfig,
  HeartbeatConfig,
  CircuitBreakerConfig,
} from '@agenisea/sse-kit/types'
```

---

## Default Configuration

```typescript
// Retry
{
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true
}

// Timeout
{
  requestMs: 120000,
  idleMs: 30000
}

// Heartbeat
{
  intervalMs: 5000,
  enabled: true
}

// Circuit Breaker
{
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  successThreshold: 1
}
```
