/**
 * SSE Helper Functions
 *
 * Thin wrappers for emitting typed SSE events with consistent formatting.
 * These helpers use the standard SSE event: prefix for typed events.
 *
 * Supports full SSE specification including:
 * - id: Event ID for Last-Event-ID header on reconnection
 * - retry: Reconnection time hint in milliseconds
 *
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * @example
 * ```typescript
 * const stream = new ReadableStream({
 *   async start(ctrl) {
 *     const enc = new TextEncoder()
 *
 *     sseStart(ctrl, enc)
 *     sseDelta(ctrl, enc, 'Hello ')
 *     sseDelta(ctrl, enc, 'World!')
 *     sseDone(ctrl, enc, { success: true })
 *
 *     ctrl.close()
 *   }
 * })
 * ```
 */

import type { SSEMessage } from '../types/sse-events'

type Controller = ReadableStreamDefaultController<Uint8Array>

/**
 * Options for SSE message formatting.
 */
export interface SSEMessageOptions {
  /** Event ID for Last-Event-ID header on reconnection */
  id?: string

  /** Reconnection time hint in milliseconds */
  retry?: number
}

/**
 * Format an SSE message string with optional id and retry fields.
 * This is the low-level formatter used by all SSE helpers.
 */
export function formatSSEMessage<T = unknown>(
  message: SSEMessage<T>
): string {
  const lines: string[] = []

  if (message.id !== undefined) {
    lines.push(`id: ${message.id}`)
  }

  if (message.retry !== undefined) {
    lines.push(`retry: ${message.retry}`)
  }

  if (message.event !== undefined) {
    lines.push(`event: ${message.event}`)
  }

  lines.push(`data: ${JSON.stringify(message.data)}`)

  return lines.join('\n') + '\n\n'
}

/**
 * Emit SSE start event.
 * Signals the beginning of a stream.
 */
export function sseStart(
  ctrl: Controller,
  enc: TextEncoder,
  metadata?: Record<string, unknown>,
  options?: SSEMessageOptions
): void {
  const data = metadata ?? {}
  const message = formatSSEMessage({ event: 'start', data, ...options })
  ctrl.enqueue(enc.encode(message))
}

/**
 * Emit SSE delta event with text chunk.
 * Used for streaming text incrementally.
 */
export function sseDelta(
  ctrl: Controller,
  enc: TextEncoder,
  text: string,
  options?: SSEMessageOptions
): void {
  const message = formatSSEMessage({ event: 'delta', data: { text }, ...options })
  ctrl.enqueue(enc.encode(message))
}

/**
 * Emit SSE done event with final payload.
 * Signals successful completion of the stream.
 */
export function sseDone<T = unknown>(
  ctrl: Controller,
  enc: TextEncoder,
  payload: T,
  options?: SSEMessageOptions
): void {
  const message = formatSSEMessage({ event: 'done', data: payload, ...options })
  ctrl.enqueue(enc.encode(message))
}

/**
 * Emit SSE error event.
 * Signals an error occurred during streaming.
 */
export function sseError(
  ctrl: Controller,
  enc: TextEncoder,
  error: Error | string,
  extra?: Record<string, unknown>,
  options?: SSEMessageOptions
): void {
  const errorPayload = {
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  }
  const message = formatSSEMessage({ event: 'error', data: errorPayload, ...options })
  ctrl.enqueue(enc.encode(message))
}

/**
 * Emit SSE progress event.
 * Used for phase/progress updates during long operations.
 */
export function sseProgress<TPhase extends string = string>(
  ctrl: Controller,
  enc: TextEncoder,
  phase: TPhase,
  message?: string,
  options?: SSEMessageOptions
): void {
  const payload = { phase, message }
  const msg = formatSSEMessage({ event: 'progress', data: payload, ...options })
  ctrl.enqueue(enc.encode(msg))
}

/**
 * Emit SSE heartbeat comment.
 * Comments start with ':' and keep the connection alive.
 */
export function sseHeartbeat(
  ctrl: Controller,
  enc: TextEncoder,
  message = 'heartbeat'
): void {
  ctrl.enqueue(enc.encode(`: [${message}]\n\n`))
}

/**
 * Emit raw SSE data without event type.
 * This is the simplest form: just data: {json}\n\n
 */
export function sseData<T = unknown>(
  ctrl: Controller,
  enc: TextEncoder,
  data: T,
  options?: SSEMessageOptions
): void {
  const message = formatSSEMessage({ data, ...options })
  ctrl.enqueue(enc.encode(message))
}

/**
 * Emit custom event type with payload.
 * Use for application-specific event types.
 */
export function sseEvent<T = unknown>(
  ctrl: Controller,
  enc: TextEncoder,
  eventType: string,
  data: T,
  options?: SSEMessageOptions
): void {
  const message = formatSSEMessage({ event: eventType, data, ...options })
  ctrl.enqueue(enc.encode(message))
}

/**
 * Emit retry field to set reconnection time.
 * Clients will wait this long before reconnecting.
 */
export function sseRetry(
  ctrl: Controller,
  enc: TextEncoder,
  retryMs: number
): void {
  ctrl.enqueue(enc.encode(`retry: ${retryMs}\n\n`))
}

/**
 * Create an SSE encoder with bound controller.
 * Provides a cleaner API when sending many events.
 *
 * @example
 * ```typescript
 * const sse = createSSEEncoder(ctrl)
 * sse.start()
 * sse.delta('Hello')
 * sse.done({ success: true })
 *
 * // With id for reconnection support
 * sse.delta('Hello', { id: '1' })
 * sse.delta('World', { id: '2' })
 * ```
 */
export function createSSEEncoder(ctrl: Controller) {
  const enc = new TextEncoder()

  return {
    start: (metadata?: Record<string, unknown>, options?: SSEMessageOptions) =>
      sseStart(ctrl, enc, metadata, options),
    delta: (text: string, options?: SSEMessageOptions) =>
      sseDelta(ctrl, enc, text, options),
    done: <T>(payload: T, options?: SSEMessageOptions) =>
      sseDone(ctrl, enc, payload, options),
    error: (error: Error | string, extra?: Record<string, unknown>, options?: SSEMessageOptions) =>
      sseError(ctrl, enc, error, extra, options),
    progress: <TPhase extends string>(phase: TPhase, message?: string, options?: SSEMessageOptions) =>
      sseProgress(ctrl, enc, phase, message, options),
    heartbeat: (message?: string) =>
      sseHeartbeat(ctrl, enc, message),
    data: <T>(data: T, options?: SSEMessageOptions) =>
      sseData(ctrl, enc, data, options),
    event: <T>(eventType: string, data: T, options?: SSEMessageOptions) =>
      sseEvent(ctrl, enc, eventType, data, options),
    retry: (retryMs: number) =>
      sseRetry(ctrl, enc, retryMs),
    /** Format a message without sending (for testing/debugging) */
    format: <T>(message: SSEMessage<T>) =>
      formatSSEMessage(message),
  }
}

export type SSEEncoder = ReturnType<typeof createSSEEncoder>
