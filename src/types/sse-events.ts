/**
 * SSE Event Types
 *
 * Framework-agnostic type definitions for Server-Sent Events.
 * These types are used by both server (orchestrator) and client (parser).
 *
 * Follows the SSE specification:
 * @see https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

/**
 * Standard SSE event types following the SSE specification.
 * These are the event: field values in the SSE protocol.
 */
export type SSEEventType = 'start' | 'delta' | 'done' | 'error'

/**
 * SSE message fields per the specification.
 * All fields are optional except data.
 */
export interface SSEMessage<T = unknown> {
  /** Event ID for Last-Event-ID header on reconnection */
  id?: string

  /** Event type (maps to event: field) */
  event?: string

  /** JSON-serializable payload */
  data: T

  /** Reconnection time hint in milliseconds */
  retry?: number
}

/**
 * Base interface for all SSE update messages.
 * Extend this with your application-specific fields.
 */
export interface BaseSSEUpdate<TPhase extends string = string> {
  phase: TPhase
  message?: string
  error?: string
}

/**
 * Generic SSE update with extensible payload.
 * The TResult generic allows type-safe result handling.
 */
export interface SSEUpdate<TPhase extends string = string, TResult = unknown> extends BaseSSEUpdate<TPhase> {
  result?: TResult

  // Reconnection metadata (client-side)
  reconnectAttempt?: number
  maxAttempts?: number
  retryDelayMs?: number
}

/**
 * Generic metadata type for custom SSE payloads.
 * Consumers can extend this for their own needs.
 */
export interface SSEMetadata {
  [key: string]: unknown
}

/**
 * Extended SSE update with generic metadata support.
 * Use this when you need to attach arbitrary data to updates.
 */
export interface SSEUpdateWithMetadata<
  TPhase extends string = string,
  TResult = unknown,
  TMeta extends SSEMetadata = SSEMetadata
> extends SSEUpdate<TPhase, TResult> {
  metadata?: TMeta
}

/**
 * Delta event payload for streaming text chunks.
 */
export interface SSEDeltaPayload {
  text: string
}

/**
 * Error event payload.
 */
export interface SSEErrorPayload {
  error: string
  code?: string
  retryable?: boolean
}

/**
 * Done event payload wrapper.
 */
export interface SSEDonePayload<T = unknown> {
  result: T
}

/**
 * Type guard to check if an update is a completion event.
 */
export function isCompleteUpdate<TPhase extends string>(
  update: SSEUpdate<TPhase>,
  completePhase: TPhase
): update is SSEUpdate<TPhase> & { result: NonNullable<unknown> } {
  return update.phase === completePhase && update.result !== undefined
}

/**
 * Type guard to check if an update is an error event.
 */
export function isErrorUpdate<TPhase extends string>(
  update: SSEUpdate<TPhase>,
  errorPhase: TPhase
): update is SSEUpdate<TPhase> & { error: string } {
  return update.phase === errorPhase && typeof update.error === 'string'
}
