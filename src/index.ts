/**
 * @sse-lib - Shared SSE Streaming Library
 *
 * Server-Sent Events streaming infrastructure for TypeScript projects.
 * Framework-agnostic, works with Next.js, Express, Hono, and any runtime
 * that supports ReadableStream.
 *
 * @example Server-side
 * ```typescript
 * import { createStreamingResponse, createSSEResponse } from '@sse-lib/server'
 *
 * export async function POST(request: Request) {
 *   const { stream, orchestrator } = createStreamingResponse()
 *
 *   orchestrator.startHeartbeat()
 *   await orchestrator.sendProgress('processing')
 *   await orchestrator.sendResult({ data: 'complete' })
 *
 *   return createSSEResponse(stream)
 * }
 * ```
 *
 * @example Client-side
 * ```typescript
 * import { useSSEStream } from '@sse-lib/client'
 *
 * function MyComponent() {
 *   const { state, start, cancel } = useSSEStream({
 *     endpoint: '/api/stream',
 *     initialPhase: 'idle',
 *     completePhase: 'complete',
 *     errorPhase: 'error',
 *   })
 *
 *   return <button onClick={() => start({ query: 'test' })}>Start</button>
 * }
 * ```
 */

// Types
export * from './types/sse-events'
export * from './types/stream-config'

// Server
export * from './server/stream-orchestrator'
export * from './server/sse-helpers'

// Client
export * from './client/sse-parser'
export * from './client/reconnect-strategy'
export * from './client/use-sse-stream'
export * from './client/circuit-breaker'
export * from './client/timeout'
