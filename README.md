<p align="center">
  <img src="https://raw.githubusercontent.com/agenisea/sse-kit/main/logo.png" alt="sse-kit logo" width="200" />
</p>

# sse-kit

Server-Sent Events streaming for TypeScript. Framework-agnostic, works with Next.js, Express, Hono, and any runtime that supports ReadableStream.

## Features

- **Server-side orchestration** with heartbeat, abort signals, and observability hooks
- **Client-side parsing** for both stateful (chunked) and response parsing
- **Exponential backoff** with jitter for reconnection
- **Circuit breaker** pattern with TTL-based cleanup
- **Timeout support** for request and idle timeouts
- **Generic React hook** with full lifecycle management
- **Type-safe** with comprehensive TypeScript definitions
- **Tree-shakeable** exports for optimal bundle size

## Installation

```bash
npm install sse-kit
# or
pnpm add sse-kit
# or
yarn add sse-kit
```

## Quick Start

### Server-side (Next.js API Route)

```typescript
import { createStreamingResponse, createSSEResponse } from 'sse-kit/server'

export async function POST(request: Request) {
  const { stream, orchestrator } = createStreamingResponse({
    signal: request.signal, // Auto-abort on client disconnect
    observer: {
      onAbort: (reason) => console.log('Stream aborted:', reason),
    },
  })

  orchestrator.startHeartbeat()

  ;(async () => {
    try {
      await orchestrator.sendProgress('processing', 'Analyzing...')
      const result = await doExpensiveWork()
      await orchestrator.sendResult(result)
    } catch (error) {
      if (orchestrator.aborted) return // Client disconnected
      await orchestrator.sendError(error.message)
    } finally {
      await orchestrator.close()
    }
  })()

  return createSSEResponse(stream)
}
```

### Client-side (React Hook)

```typescript
import { useSSEStream } from 'sse-kit/client'

function StreamingComponent() {
  const { state, start, cancel, reset } = useSSEStream({
    endpoint: '/api/my-stream',
    initialPhase: 'idle',
    completePhase: 'complete',
    errorPhase: 'error',
    onComplete: (result) => console.log('Done:', result),
  })

  return (
    <div>
      <button onClick={() => start({ query: 'test' })}>Start</button>
      <button onClick={cancel} disabled={!state.isStreaming}>Cancel</button>
      <p>Phase: {state.phase}</p>
      {state.error && <p>{state.error}</p>}
    </div>
  )
}
```

## API Reference

### Server (`sse-kit/server`)

#### `createStreamingResponse(config?)`

```typescript
const { stream, orchestrator } = createStreamingResponse({
  signal: request.signal,           // AbortSignal for cancellation
  heartbeat: { intervalMs: 5000 },  // Heartbeat config
  observer: {                       // Observability hooks
    onStreamStart: () => {},
    onStreamEnd: (durationMs, success, error) => {},
    onUpdateSent: (phase, bytesSent) => {},
    onAbort: (reason) => {},        // Called on abort
  },
})
```

#### `StreamOrchestrator`

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

#### `StreamObserver`

Observability hooks for monitoring stream lifecycle:

```typescript
import type { StreamObserver } from 'sse-kit/server'

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

#### SSE Helpers

```typescript
import { createSSEEncoder } from 'sse-kit/server'

const sse = createSSEEncoder(controller)
sse.start({ version: '1.0' })
sse.delta('Hello ', { id: '1' })  // With event ID for reconnection
sse.done({ success: true })
```

### Client (`sse-kit/client`)

#### `useSSEStream(options)`

Options are composed from segregated interfaces for flexibility:

```typescript
import type {
  SSEConnectionConfig,  // endpoint, method, headers, streamQueryParam
  SSEPhaseConfig,       // initialPhase, completePhase, errorPhase, reconnectingPhase
  SSEStreamCallbacks,   // onUpdate, onComplete, onError
  SSEParseConfig,       // extractResult, extractError, isComplete, isError
  SSEResilienceConfig,  // retry
  SSEBrowserConfig,     // warnOnUnload
} from 'sse-kit/client'

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

#### `createCircuitBreaker(options)`

```typescript
const breaker = createCircuitBreaker({
  failureThreshold: 3,
  resetTimeoutMs: 30000,
})

const result = await breaker.execute(() => fetchStream())
```

#### `fetchWithTimeout(fetchFn, config, signal?)`

```typescript
const response = await fetchWithTimeout(
  (signal) => fetch('/api/stream', { signal }),
  { requestMs: 60000, idleMs: 10000 }
)
```

#### `withRetry(operation, options)`

```typescript
const response = await withRetry(() => fetch('/api/stream'), {
  config: { maxRetries: 3 },
  onRetry: (attempt, delay) => console.log(`Retry ${attempt}`),
})
```

### Types (`sse-kit/types`)

```typescript
import type {
  SSEUpdate,
  SSEMessage,
  SSEMetadata,
  RetryConfig,
  TimeoutConfig,
  HeartbeatConfig,
  CircuitBreakerConfig,
} from 'sse-kit/types'

// Hook configuration interfaces (from sse-kit/client)
import type {
  SSEConnectionConfig,
  SSEPhaseConfig,
  SSEStreamCallbacks,
  SSEParseConfig,
  SSEResilienceConfig,
  SSEBrowserConfig,
  UseSSEStreamOptions,
} from 'sse-kit/client'

// Server observer interface (from sse-kit/server)
import type { StreamObserver } from 'sse-kit/server'
```

## Default Configuration

```typescript
// Retry
{ maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2, jitter: true }

// Timeout
{ requestMs: 120000, idleMs: 30000 }

// Heartbeat
{ intervalMs: 5000, enabled: true }

// Circuit Breaker
{ failureThreshold: 3, resetTimeoutMs: 30000, successThreshold: 1 }
```

## License

MIT

---

*Built by [Agenisea™](https://agenisea.ai)*

---

© 2025 Patrick Peña / Agenisea™