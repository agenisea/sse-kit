# API Reference

## Wire Format

sse-kit follows the SSE specification. All messages use `event:` + `data:` format on the wire:

```
event: stage
data: {"name":"parsing","status":"running"}

event: complete
data: {"sections":12,"title":"Report"}

event: error
data: {"error":"Something went wrong"}
```

`event:` drives the protocol layer (stream lifecycle). `data:` carries application data (any shape).

---

## Server (`@agenisea/sse-kit/server`)

### `createStreamingResponse(config?)`

Creates a streaming response with an orchestrator for managing SSE updates.

```typescript
import { createStreamingResponse, createSSEResponse } from '@agenisea/sse-kit/server'

const { stream, orchestrator } = createStreamingResponse({
  signal: request.signal,           // AbortSignal for cancellation
  completeEvent: 'complete',        // Event type for completion (default: 'complete')
  errorEvent: 'error',              // Event type for errors (default: 'error')
  heartbeat: { intervalMs: 5000 },  // Heartbeat config
  observer: {                       // Observability hooks
    onStreamStart: () => {},
    onStreamEnd: (durationMs, success, error) => {},
    onUpdateSent: (event, bytesSent) => {},
    onAbort: (reason) => {},
  },
})

return createSSEResponse(stream)
```

### `StreamOrchestrator<TData = unknown>`

| Method | Description |
|--------|-------------|
| `sendUpdate(eventType, data)` | Send an SSE message: `event: <eventType>\ndata: <JSON>\n\n` |
| `sendData(data)` | Send data with the configured complete event type |
| `sendError(error, extra?)` | Send error with the configured error event type |
| `startHeartbeat()` | Start periodic heartbeat comments |
| `stopHeartbeat()` | Stop heartbeat interval |
| `abort(reason?)` | Abort the stream programmatically |
| `close()` | Close the stream safely |
| `getMetrics()` | Get stream metrics (durationMs, bytesSent, closed, aborted) |

| Property | Description |
|----------|-------------|
| `closed` | Whether stream is closed |
| `aborted` | Whether stream was aborted |

The `TData` generic is unconstrained with opt-in type safety:

```typescript
// Dynamic — data is unknown
const { orchestrator } = createStreamingResponse()
await orchestrator.sendUpdate('stage', { anything: true })

// Typed — compile-time checking
const { orchestrator } = createStreamingResponse<StagePayload>()
await orchestrator.sendUpdate('stage', { name: 'parsing' }) // type-checked
```

### Heartbeat Configuration

Heartbeats send SSE comment lines (`: [heartbeat]\n\n`) to keep connections alive against browser/proxy timeouts. The consumer controls the interval and when heartbeats start:

```typescript
const { stream, orchestrator } = createStreamingResponse({
  heartbeat: {
    intervalMs: 3000,    // default: 5000
    enabled: true,       // default: true
    message: 'heartbeat' // default: 'heartbeat'
  },
})

orchestrator.startHeartbeat()  // begins sending at configured interval
// ... long-running work ...
orchestrator.stopHeartbeat()   // manual stop (also stops on close/abort)
```

Setting `enabled: false` makes `startHeartbeat()` a no-op. If your pipeline is fast (< 5s), you can skip calling `startHeartbeat()` entirely.

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
  onUpdateSent: (event, bytesSent) => {
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

  // Event lifecycle
  initialEvent: 'idle',
  completeEvent: 'complete',
  errorEvent: 'error',

  // Callbacks
  onUpdate: (event, data) => {},
  onComplete: (result) => {},
  onError: (error) => {},

  // Custom extraction (optional — smart defaults provided)
  extractResult: (data) => data,
  extractError: (data) => data.error,

  // Resilience
  retry: { maxRetries: 3 },
})
```

#### Returns

| Method | Description |
|--------|-------------|
| `start(input)` | Start streaming. Returns `Promise<TResult \| undefined>`. Always resolves — errors are reported via `onError` callback and `state.error`, not promise rejection. |
| `cancel()` | Abort the current stream |
| `reset()` | Reset state to initial |
| `isStreaming` | Whether a stream is active |

#### State

```typescript
interface SSEStreamState<TEvent, TResult> {
  event: TEvent          // Current event (from event: line)
  result: TResult | null // Final result (set on completeEvent)
  error: string | null   // Error message (set on errorEvent or HTTP error)
  isStreaming: boolean    // Whether stream is active
  reconnectionInfo: ReconnectionInfo | null
}
```

#### Options interfaces

```typescript
import type {
  SSEConnectionConfig,  // endpoint, method, headers
  SSEEventConfig,       // initialEvent, completeEvent, errorEvent, reconnectingEvent
  SSEStreamCallbacks,   // onUpdate, onComplete, onError
  SSEParseConfig,       // extractResult, extractError
  SSEResilienceConfig,  // retry
  SSEBrowserConfig,     // warnOnUnload
} from '@agenisea/sse-kit/client'
```

### `createSSEParser(options)`

Low-level stateful SSE parser for chunked streams.

```typescript
import { createSSEParser } from '@agenisea/sse-kit/client'

const parser = createSSEParser({
  onMessage: (event, data) => {
    // event: string | undefined — from event: line
    // data: T — parsed JSON from data: line
  },
  onComment: (text) => {
    // Optional — called for : comment lines
  },
  onError: (error, rawLine) => {
    // Optional — called on JSON parse errors (not onMessage callback errors)
  },
})

// Feed chunks as they arrive
parser(chunk)
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
  SSEMessage,           // { id?, event?, data, retry? }
  SSEUpdate,            // Optional convenience type (not enforced)
  SSEMetadata,          // Record<string, unknown>
  RetryConfig,
  TimeoutConfig,
  HeartbeatConfig,
  CircuitBreakerConfig,
} from '@agenisea/sse-kit/types'
```

`BaseSSEUpdate` and `SSEUpdate` are optional convenience types for consumers who want a structured data shape. They are **not enforced** by `useSSEStream` or `StreamOrchestrator`.

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
