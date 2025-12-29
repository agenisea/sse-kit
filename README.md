<p align="center">
  <img src="https://raw.githubusercontent.com/agenisea/sse-kit/main/logo.png" alt="sse-kit logo" width="200" />
</p>

# @agenisea/sse-kit

Server-Sent Events streaming for TypeScript. Zero dependencies. Works with Next.js, Express, Hono, and any runtime that supports ReadableStream.

## Features

- **Server orchestration** — heartbeat, abort signals, observability hooks
- **Client parsing** — stateful chunked and full response modes
- **Resilience** — exponential backoff, circuit breaker, timeouts
- **React hook** — full lifecycle management with retry support
- **Tree-shakeable** — import only what you need

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
  })

  ;(async () => {
    orchestrator.startHeartbeat()
    await orchestrator.sendProgress('processing', 'Working...')
    await orchestrator.sendResult({ done: true })
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
    onComplete: (result) => console.log(result),
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

*Built by [Agenisea™](https://agenisea.ai)*

---

© 2025 Patrick Peña / Agenisea™