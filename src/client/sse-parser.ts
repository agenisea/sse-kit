/**
 * SSE Parser
 *
 * Client-side SSE stream parsing with support for both stateful
 * (chunked) and complete response parsing patterns.
 *
 * Manual parsing is required because native EventSource only supports GET requests.
 * This parser works with POST/PUT/PATCH requests using fetch().
 */

import type { SSEEventType } from '../types/sse-events'

/**
 * Handlers for typed SSE events.
 */
export interface SSEEventHandlers<T = unknown> {
  onStart?: (data?: Record<string, unknown>) => void
  onDelta?: (text: string) => void
  onDone?: (data: T) => void
  onError?: (error: string) => void
  onProgress?: (phase: string, message?: string) => void
}

/**
 * Options for the stateful SSE parser.
 */
export interface SSEParserOptions<T = unknown> {
  /** Called for each parsed message (raw data: lines) */
  onMessage: (data: T) => void

  /** Called when JSON parsing fails */
  onError?: (error: Error, rawLine: string) => void
}

/**
 * Creates a stateful SSE parser that handles chunked data.
 * Call the returned function with each chunk from the stream.
 *
 * @example
 * ```typescript
 * const parser = createSSEParser<MyUpdateType>({
 *   onMessage: (update) => {
 *     console.log('Update:', update)
 *   },
 *   onError: (err, raw) => {
 *     console.warn('Parse error:', err, raw)
 *   }
 * })
 *
 * const reader = response.body.getReader()
 * const decoder = new TextDecoder()
 *
 * while (true) {
 *   const { done, value } = await reader.read()
 *   if (done) break
 *   parser(decoder.decode(value, { stream: true }))
 * }
 * ```
 */
export function createSSEParser<T = unknown>(options: SSEParserOptions<T>) {
  const { onMessage, onError } = options
  let buffer = ''

  return function parse(chunk: string): void {
    buffer += chunk
    const messages = buffer.split('\n\n')
    buffer = messages.pop() || '' // Keep incomplete message for next chunk

    for (const message of messages) {
      const trimmed = message.trim()
      if (!trimmed) continue // Skip empty

      for (const line of trimmed.split('\n')) {
        // Skip SSE comments (heartbeats use `: message`)
        if (line.startsWith(':')) continue

        if (line.startsWith('data: ')) {
          const payload = line.slice(6)
          try {
            const data = JSON.parse(payload) as T
            onMessage(data)
          } catch (err) {
            onError?.(
              err instanceof Error ? err : new Error('JSON parse error'),
              payload.slice(0, 120)
            )
          }
        }
      }
    }
  }
}

/**
 * Parse an SSE stream from a fetch Response with typed event handlers.
 *
 * This is a higher-level API that handles the full response lifecycle
 * and routes events to typed handlers (start, delta, done, error).
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/stream', { method: 'POST', ... })
 * const result = await parseSSEStream(response, {
 *   onStart: () => setLoading(true),
 *   onDelta: (text) => appendText(text),
 *   onDone: (data) => handleComplete(data),
 *   onError: (error) => showError(error)
 * })
 * ```
 */
export async function parseSSEStream<T = unknown>(
  response: Response,
  handlers: SSEEventHandlers<T>
): Promise<T | null> {
  if (!response.body) {
    throw new Error('No response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent: SSEEventType | '' = ''
  let finalData: T | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        // Parse event type
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim() as SSEEventType
          continue
        }

        // Skip comments (heartbeats)
        if (line.startsWith(':')) continue

        // Parse event data
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6)
        if (!data.trim()) continue

        try {
          const parsed = JSON.parse(data)

          // Route to typed handlers based on event type
          switch (currentEvent) {
            case 'start':
              handlers.onStart?.(parsed)
              break

            case 'delta':
              if (parsed.text) {
                handlers.onDelta?.(parsed.text)
              }
              break

            case 'done':
              finalData = parsed as T
              handlers.onDone?.(parsed)
              break

            case 'error': {
              const errorMessage = parsed.error || 'Unknown error'
              handlers.onError?.(errorMessage)
              throw new SSEStreamError(errorMessage, parsed)
            }

            default:
              // Handle progress events or raw data: updates
              if (parsed.phase && handlers.onProgress) {
                handlers.onProgress(parsed.phase, parsed.message)
              }
          }

          currentEvent = ''
        } catch (parseError) {
          // Re-throw stream errors
          if (parseError instanceof SSEStreamError) {
            throw parseError
          }
          // Skip JSON parse errors silently (incomplete chunks)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return finalData
}

/**
 * Error thrown when the server sends an error event.
 */
export class SSEStreamError extends Error {
  public readonly payload: Record<string, unknown>
  public readonly code?: string
  public readonly retryable?: boolean

  constructor(message: string, payload: Record<string, unknown> = {}) {
    super(message)
    this.name = 'SSEStreamError'
    this.payload = payload
    this.code = payload.code as string | undefined
    this.retryable = payload.retryable as boolean | undefined
  }
}

/**
 * Error thrown when the stream is cancelled by the user.
 */
export class StreamCancelledError extends Error {
  constructor(message = 'Stream cancelled') {
    super(message)
    this.name = 'StreamCancelledError'
  }
}
