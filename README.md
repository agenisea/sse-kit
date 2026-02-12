<p align="center">
  <img src="https://raw.githubusercontent.com/agenisea/sse-kit/main/assets/logo.png" alt="sse-kit logo" width="200" />
</p>

# @agenisea/sse-kit

Server-Sent Events streaming for TypeScript. Zero dependencies. Works with Next.js, Express, Hono, and any runtime that supports ReadableStream.

## Features

- **Server orchestration** — heartbeat, abort signals, observability hooks
- **Client parsing** — stateful chunked and full response modes
- **Resilience** — exponential backoff, circuit breaker, timeouts
- **React hook** — full lifecycle management with retry support
- **Tree-shakeable** — import only what you need

## Design Philosophy

`event:` = protocol (stream lifecycle). `data:` = application (your data, any shape).

sse-kit is a pure transport layer. The SSE `event:` line drives state transitions. The `data:` line carries your payload — no wrappers, no reshaping. What you send is what you get.

## Install

```bash
pnpm add @agenisea/sse-kit
```

## Quick Start

### Server

```typescript
import { createStreamingResponse, createSSEResponse } from '@agenisea/sse-kit/server'

export async function POST(request: Request) {
  const { stream, orchestrator } = createStreamingResponse({
    signal: request.signal,
    heartbeat: { intervalMs: 3000, enabled: true }, // default: 5000ms
  })

  ;(async () => {
    orchestrator.startHeartbeat()
    await orchestrator.sendUpdate('stage', { name: 'parsing', status: 'running' })
    await orchestrator.sendData({ sections: 12, title: 'Report' })
    await orchestrator.close()
  })()

  return createSSEResponse(stream)
}
```

### Client

```typescript
import { useSSEStream } from '@agenisea/sse-kit/client'

function App() {
  const { state, start, cancel } = useSSEStream({
    endpoint: '/api/stream',
    initialEvent: 'idle',
    completeEvent: 'complete',
    errorEvent: 'error',
    onUpdate: (event, data) => {
      if (event === 'stage') console.log('Stage:', data)
    },
    onComplete: (result) => console.log('Done:', result),
  })

  return (
    <button onClick={() => start({ query: 'test' })}>
      {state.isStreaming ? 'Streaming...' : 'Start'}
    </button>
  )
}
```

## Documentation

- [API Reference](./docs/API.md) — full API documentation
- [Security](./docs/SECURITY.md) — security considerations
- [Changelog](./CHANGELOG.md) — version history

## License

MIT

---

*Built by [Agenisea](https://agenisea.ai)*

---

&copy; 2025-2026 Patrick Pena / Agenisea
